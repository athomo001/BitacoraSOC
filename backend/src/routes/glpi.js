const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { audit } = require('../utils/audit');
const { encrypt, decrypt } = require('../utils/encryption');
const { isConfigured, sendEmail } = require('../utils/email');
const GlpiConfig = require('../models/GlpiConfig');

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

const withDefaultPath = (baseUrl) => {
  const parsed = new URL(baseUrl);
  const path = parsed.pathname || '/';
  if (!path.endsWith('/apirest.php')) {
    parsed.pathname = path.replace(/\/$/, '') + '/apirest.php';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed;
};

const glpiRequest = ({ method = 'GET', url, headers = {}, timeoutMs = 8000, verifyTls = true }) => {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search || ''}`,
      headers,
      timeout: timeoutMs,
      rejectUnauthorized: verifyTls
    }, (res) => {
      let raw = '';
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_) {
          parsed = null;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data: parsed || raw });
          return;
        }

        const message = parsed?.[0] || parsed?.message || raw || `HTTP ${res.statusCode}`;
        reject(new Error(`GLPI ${method} ${url.pathname} falló: ${message}`));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout conectando a GLPI'));
    });
    req.end();
  });
};

const sanitizeConfig = (doc) => ({
  _id: doc._id,
  enabled: doc.enabled,
  mode: doc.mode,
  dispatchMode: doc.dispatchMode,
  api: {
    baseUrl: doc.api?.baseUrl || '',
    verifyTls: doc.api?.verifyTls ?? true,
    timeoutMs: doc.api?.timeoutMs || 8000,
    appTokenConfigured: Boolean(doc.api?.appToken),
    userTokenConfigured: Boolean(doc.api?.userToken)
  },
  email: {
    collectorAddress: doc.email?.collectorAddress || '',
    subjectTemplate: doc.email?.subjectTemplate || '[SOC] Cierre de turno {{date}}'
  },
  lastTestDate: doc.lastTestDate,
  lastTestSuccess: doc.lastTestSuccess,
  lastTestMessage: doc.lastTestMessage,
  updatedAt: doc.updatedAt
});

const getOrCreateConfig = async () => {
  let config = await GlpiConfig.findOne();
  if (!config) {
    config = await GlpiConfig.create({});
  }
  return config;
};

router.get('/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    res.json(sanitizeConfig(config));
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo configuración GLPI', error: error.message });
  }
});

router.put('/config', authenticate, authorize('admin'), validators, validate, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    const payload = req.body || {};
    const incomingAppToken = String(payload.api?.appToken || '').trim();
    const incomingUserToken = String(payload.api?.userToken || '').trim();

    if (payload.enabled !== undefined) config.enabled = !!payload.enabled;
    if (payload.mode) config.mode = payload.mode;
    if (payload.dispatchMode) config.dispatchMode = payload.dispatchMode;

    if (payload.api) {
      if (payload.api.baseUrl !== undefined) config.api.baseUrl = String(payload.api.baseUrl || '').trim();
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
        config.email.subjectTemplate = String(payload.email.subjectTemplate || '').trim() || '[SOC] Cierre de turno {{date}}';
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

    res.json({ message: 'Configuración GLPI guardada', config: sanitizeConfig(config) });
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
  try {
    const config = await getOrCreateConfig();

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
        metadata: { baseUrl: config.api.baseUrl }
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

    const subject = (config.email?.subjectTemplate || '[SOC] Cierre de turno {{date}}').replace('{{date}}', new Date().toISOString().slice(0, 10));

    await sendEmail({
      to: collectorAddress,
      subject,
      text: 'Prueba de integración GLPI por correo desde Bitácora SOC.'
    });

    config.lastTestDate = new Date();
    config.lastTestSuccess = true;
    config.lastTestMessage = 'Correo de prueba GLPI enviado correctamente';
    await config.save();

    await audit(req, {
      event: 'admin.glpi.test.email.success',
      level: 'info',
      result: { success: true },
      metadata: { collectorAddress }
    });

    return res.json({ message: config.lastTestMessage });
  } catch (error) {
    const config = await getOrCreateConfig();
    config.lastTestDate = new Date();
    config.lastTestSuccess = false;
    config.lastTestMessage = error.message;
    await config.save();

    await audit(req, {
      event: 'admin.glpi.test.fail',
      level: 'warn',
      result: { success: false, reason: error.message }
    });

    res.status(500).json({ message: 'Prueba GLPI fallida', error: error.message });
  }
});

module.exports = router;
