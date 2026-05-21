/**
 * File Purpose: backend/src/routes/glpi.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const { URL } = require('url');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { audit } = require('../utils/audit');
const { encrypt, decrypt } = require('../utils/encryption');
const { isConfigured, sendEmail } = require('../utils/email');
const {
  DEFAULT_EMAIL_SUBJECT,
  ensureGlpiConfig,
  fillTemplate,
  glpiRequest,
  sanitizeGlpiConfig,
  withDefaultPath
} = require('../utils/glpi-dispatch');
const { getBrandingSnapshot, getAppTitleForText } = require('../utils/branding');
const { assertOutboundUrlSafe } = require('../utils/outbound-url-guard');

const router = express.Router();

const validators = [
  body('enabled').optional().isBoolean(),
  body('mode').optional().isIn(['api', 'email']),
  body('dispatchMode').optional().isIn(['daily-summary', 'immediate']),
  body('api.baseUrl').optional().isString(),
  body('api.appToken').optional().isString(),
  body('api.userToken').optional().isString(),
  body('api.verifyTls').optional().isBoolean(),
  body('api.timeoutMs').optional().isInt({ min: 1000, max: 30000 }),
  body('email.collectorAddress').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('email.subjectTemplate').optional().isString()
];

router.get('/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    res.json(sanitizeGlpiConfig(config));
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo configuración GLPI', error: error.message });
  }
});

router.put('/config', authenticate, authorize('admin'), validators, validate, async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    const payload = req.body || {};
    const incomingAppToken = String(payload.api?.appToken || '').trim();
    const incomingUserToken = String(payload.api?.userToken || '').trim();

    if (payload.enabled !== undefined) config.enabled = !!payload.enabled;
    if (payload.mode) config.mode = payload.mode;
    if (payload.dispatchMode) config.dispatchMode = payload.dispatchMode;

    if (payload.api) {
      if (payload.api.baseUrl !== undefined) {
        const candidateBaseUrl = String(payload.api.baseUrl || '').trim();
        if (candidateBaseUrl) {
          try {
            await assertOutboundUrlSafe(candidateBaseUrl, { requireHttps: true });
          } catch (validationError) {
            return res.status(400).json({ message: validationError.message });
          }
        }
        config.api.baseUrl = candidateBaseUrl;
      }
      if (payload.api.verifyTls !== undefined) config.api.verifyTls = !!payload.api.verifyTls;
      if (payload.api.timeoutMs !== undefined) config.api.timeoutMs = Number(payload.api.timeoutMs);
      if (incomingAppToken) config.api.appToken = encrypt(incomingAppToken);
      if (incomingUserToken) config.api.userToken = encrypt(incomingUserToken);
    }

    const apiMode = config.mode === 'api';
    if (apiMode) {
      const hasAppToken = Boolean(incomingAppToken) || Boolean(config.api?.appToken);
      const hasUserToken = Boolean(incomingUserToken) || Boolean(config.api?.userToken);
      if (!hasAppToken || !hasUserToken) {
        return res.status(400).json({
          message: 'Para guardar en modo API debes tener App-Token y User Token configurados'
        });
      }
    }

    if (payload.email) {
      if (payload.email.collectorAddress !== undefined) {
        config.email.collectorAddress = String(payload.email.collectorAddress || '').trim().toLowerCase();
      }
      if (payload.email.subjectTemplate !== undefined) {
        config.email.subjectTemplate = String(payload.email.subjectTemplate || '').trim() || DEFAULT_EMAIL_SUBJECT;
      }
    }

    config.lastUpdatedBy = req.user._id;
    await config.save();

    await audit(req, {
      event: 'admin.glpi.config.update',
      level: 'info',
      result: { success: true },
      metadata: {
        enabled: config.enabled,
        mode: config.mode,
        dispatchMode: config.dispatchMode,
        hasApiTokens: Boolean(config.api?.appToken) && Boolean(config.api?.userToken),
        hasCollectorAddress: Boolean(config.email?.collectorAddress)
      }
    });

    res.json({ message: 'Configuración GLPI guardada', config: sanitizeGlpiConfig(config) });
  } catch (error) {
    await audit(req, {
      event: 'admin.glpi.config.update',
      level: 'warn',
      result: { success: false, reason: error.message }
    });
    res.status(500).json({ message: 'Error guardando configuración GLPI', error: error.message });
  }
});

router.post('/test', authenticate, authorize('admin'), async (req, res) => {
  const retryAttempt = req.body?.retryAttempt === true || req.body?.retryAttempt === 'true';
  const retryCountParsed = Number.parseInt(String(req.body?.retryCount ?? ''), 10);
  const retryCount = Number.isFinite(retryCountParsed) && retryCountParsed > 0 ? retryCountParsed : null;
  try {
    const config = await ensureGlpiConfig();

    if (!config.enabled) {
      return res.status(400).json({ message: 'Habilita GLPI antes de probar' });
    }

    if (config.mode === 'api') {
      const baseUrl = String(config.api?.baseUrl || '').trim();
      const appToken = decrypt(config.api?.appToken || '');
      const userToken = decrypt(config.api?.userToken || '');

      if (!baseUrl || !appToken || !userToken) {
        return res.status(400).json({ message: 'Faltan baseUrl/appToken/userToken para modo API' });
      }

      const apiBase = withDefaultPath(baseUrl);
      await assertOutboundUrlSafe(apiBase.toString(), { requireHttps: true });
      const initSessionUrl = new URL(`${apiBase.toString().replace(/\/$/, '')}/initSession`);

      const initResult = await glpiRequest({
        method: 'GET',
        url: initSessionUrl,
        timeoutMs: config.api.timeoutMs,
        verifyTls: config.api.verifyTls,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `user_token ${userToken}`,
          'App-Token': appToken
        }
      });

      const sessionToken = initResult?.data?.session_token;
      if (!sessionToken) {
        throw new Error('GLPI no devolvió session_token en initSession');
      }

      const killSessionUrl = new URL(`${apiBase.toString().replace(/\/$/, '')}/killSession`);
      await glpiRequest({
        method: 'GET',
        url: killSessionUrl,
        timeoutMs: config.api.timeoutMs,
        verifyTls: config.api.verifyTls,
        headers: {
          'Content-Type': 'application/json',
          'Session-Token': sessionToken,
          'App-Token': appToken
        }
      });

      config.lastTestDate = new Date();
      config.lastTestSuccess = true;
      config.lastTestMessage = 'Conexión API GLPI exitosa (initSession/killSession)';
      await config.save();

      await audit(req, {
        event: 'admin.glpi.test.api.success',
        level: 'info',
        result: { success: true },
        metadata: { baseUrl: config.api.baseUrl, retryAttempt, retryCount }
      });

      return res.json({ message: config.lastTestMessage });
    }

    const collectorAddress = String(config.email?.collectorAddress || '').trim();
    if (!collectorAddress) {
      return res.status(400).json({ message: 'Falta email collector para modo correo' });
    }

    const smtpReady = await isConfigured();
    if (!smtpReady) {
      return res.status(400).json({ message: 'SMTP no configurado para prueba por correo' });
    }

    const subject = fillTemplate(config.email?.subjectTemplate || DEFAULT_EMAIL_SUBJECT, {
      date: new Date().toISOString().slice(0, 10)
    });
    const { appTitle } = await getBrandingSnapshot();
    const systemName = getAppTitleForText(appTitle, 'el sistema');

    await sendEmail({
      to: collectorAddress,
      subject,
      text: `Prueba de integración GLPI por correo desde ${systemName}.`,
      auditContext: {
        sourceModule: 'glpi-route',
        triggerType: 'admin-glpi-test-email',
        triggerContext: 'admin.glpi.test',
        extra: {
          collectorAddress,
          mode: config.mode,
          dispatchMode: config.dispatchMode
        }
      }
    });

    config.lastTestDate = new Date();
    config.lastTestSuccess = true;
    config.lastTestMessage = 'Correo de prueba GLPI enviado correctamente';
    await config.save();

    await audit(req, {
      event: 'admin.glpi.test.email.success',
      level: 'info',
      result: { success: true },
      metadata: { collectorAddress, retryAttempt, retryCount }
    });

    return res.json({ message: config.lastTestMessage });
  } catch (error) {
    const config = await ensureGlpiConfig();
    config.lastTestDate = new Date();
    config.lastTestSuccess = false;
    config.lastTestMessage = error.message;
    await config.save();

    await audit(req, {
      event: 'admin.glpi.test.fail',
      level: 'warn',
      result: { success: false, reason: error.message },
      metadata: { retryAttempt, retryCount }
    });

    res.status(500).json({ message: 'Prueba GLPI fallida', error: error.message });
  }
});

// Aliases para rutas raíz (cuando el router se monta en /api/integrations/glpi)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    res.json(sanitizeGlpiConfig(config));
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo configuración GLPI', error: error.message });
  }
});

router.put('/', authenticate, authorize('admin'), validators, validate, async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    const payload = req.body || {};
    const incomingAppToken = String(payload.api?.appToken || '').trim();
    const incomingUserToken = String(payload.api?.userToken || '').trim();

    if (payload.enabled !== undefined) config.enabled = !!payload.enabled;
    if (payload.mode) config.mode = payload.mode;
    if (payload.dispatchMode) config.dispatchMode = payload.dispatchMode;

    if (payload.api) {
      if (payload.api.baseUrl !== undefined) {
        const candidateBaseUrl = String(payload.api.baseUrl || '').trim();
        if (candidateBaseUrl) {
          try {
            await assertOutboundUrlSafe(candidateBaseUrl, { requireHttps: true });
          } catch (validationError) {
            return res.status(400).json({ message: validationError.message });
          }
        }
        config.api.baseUrl = candidateBaseUrl;
      }
      if (payload.api.verifyTls !== undefined) config.api.verifyTls = !!payload.api.verifyTls;
      if (payload.api.timeoutMs !== undefined) config.api.timeoutMs = Number(payload.api.timeoutMs);
      if (incomingAppToken) config.api.appToken = encrypt(incomingAppToken);
      if (incomingUserToken) config.api.userToken = encrypt(incomingUserToken);
    }

    const apiMode = config.mode === 'api';
    if (apiMode) {
      const hasAppToken = Boolean(incomingAppToken) || Boolean(config.api?.appToken);
      const hasUserToken = Boolean(incomingUserToken) || Boolean(config.api?.userToken);
      if (!hasAppToken || !hasUserToken) {
        return res.status(400).json({
          message: 'Para guardar en modo API debes tener App-Token y User Token configurados'
        });
      }
    }

    if (payload.email) {
      if (payload.email.collectorAddress !== undefined) {
        config.email.collectorAddress = String(payload.email.collectorAddress || '').trim().toLowerCase();
      }
      if (payload.email.subjectTemplate !== undefined) {
        config.email.subjectTemplate = String(payload.email.subjectTemplate || '').trim() || DEFAULT_EMAIL_SUBJECT;
      }
    }

    config.lastUpdatedBy = req.user._id;
    await config.save();

    await audit(req, {
      event: 'admin.glpi.config.update',
      level: 'info',
      result: { success: true },
      metadata: {
        enabled: config.enabled,
        mode: config.mode,
        dispatchMode: config.dispatchMode,
        hasApiTokens: Boolean(config.api?.appToken) && Boolean(config.api?.userToken),
        hasCollectorAddress: Boolean(config.email?.collectorAddress)
      }
    });

    res.json({ message: 'Configuración GLPI guardada', config: sanitizeGlpiConfig(config) });
  } catch (error) {
    await audit(req, {
      event: 'admin.glpi.config.update',
      level: 'warn',
      result: { success: false, reason: error.message }
    });
    res.status(500).json({ message: 'Error guardando configuración GLPI', error: error.message });
  }
});

module.exports = router;
