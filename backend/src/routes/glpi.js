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
  withDefaultPath,
  withGlpiSession
} = require('../utils/glpi-dispatch');
const { runGlpiInboundSync } = require('../utils/glpi-inbound-sync');
const { ENTRY_TYPES, mergeEntityMappings } = require('../utils/glpi-entity-mappings');
const { getBrandingSnapshot, getAppTitleForText } = require('../utils/branding');
const { assertOutboundUrlSafe } = require('../utils/outbound-url-guard');

const router = express.Router();

const validators = [
  body('enabled').optional().isBoolean(),
  body('manualLinkFieldEnabled').optional().isBoolean(),
  body('mode').optional().isIn(['api', 'email']),
  body('dispatchMode').optional().isIn(['daily-summary', 'immediate']),
  body('api.baseUrl').optional().isString(),
  body('api.appToken').optional().isString(),
  body('api.userToken').optional().isString(),
  body('api.verifyTls').optional().isBoolean(),
  body('api.timeoutMs').optional().isInt({ min: 1000, max: 30000 }),
  body('email.collectorAddress').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('email.subjectTemplate').optional().isString(),
  body('entityMappings').optional().isArray(),
  body('entityMappings.*.entitiesId').optional().isInt(),
  body('entityMappings.*.label').optional().isString(),
  body('entityMappings.*.clientId').optional({ nullable: true }).isString(),
  body('entityMappings.*.defaultEntryType').optional().isIn(ENTRY_TYPES),
  body('entityMappings.*.enabled').optional().isBoolean(),
  body('entityMappings.*.categoryOverrides').optional().isArray(),
  body('entityMappings.*.categoryOverrides.*.itilCategoriesId').optional().isInt(),
  body('entityMappings.*.categoryOverrides.*.entryType').optional().isIn(ENTRY_TYPES),
  body('inbound.enabled').optional().isBoolean(),
  body('inbound.pollingIntervalMinutes').optional().isInt({ min: 1, max: 1440 }),
  body('inbound.importUserId').optional({ nullable: true }).isString()
];

const applyGlpiConfigPayload = async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    const payload = req.body || {};
    const incomingAppToken = String(payload.api?.appToken || '').trim();
    const incomingUserToken = String(payload.api?.userToken || '').trim();

    if (payload.enabled !== undefined) config.enabled = !!payload.enabled;
    if (payload.manualLinkFieldEnabled !== undefined) config.manualLinkFieldEnabled = !!payload.manualLinkFieldEnabled;
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

    // Solo exige tokens cuando GLPI está realmente habilitado en modo API — si "enabled"
    // está apagado, permite guardar el resto de la configuración (p. ej. manualLinkFieldEnabled)
    // sin forzar la conexión.
    const requiresApiTokens = config.enabled && config.mode === 'api';
    if (requiresApiTokens) {
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

    if (payload.entityMappings !== undefined) {
      if (!Array.isArray(payload.entityMappings)) {
        return res.status(400).json({ message: 'entityMappings debe ser un arreglo' });
      }
      config.entityMappings = mergeEntityMappings(config.entityMappings, payload.entityMappings);
      config.markModified('entityMappings');
    }

    if (payload.inbound) {
      if (payload.inbound.enabled !== undefined) config.inbound.enabled = !!payload.inbound.enabled;
      if (payload.inbound.pollingIntervalMinutes !== undefined) {
        config.inbound.pollingIntervalMinutes = Number(payload.inbound.pollingIntervalMinutes);
      }
      if (payload.inbound.importUserId !== undefined) {
        config.inbound.importUserId = payload.inbound.importUserId || null;
      }
    }

    if (config.inbound?.enabled) {
      if (config.mode !== 'api') {
        return res.status(400).json({ message: 'La importación entrante requiere el modo "API REST GLPI"' });
      }
      if (!config.inbound.importUserId) {
        return res.status(400).json({ message: 'Selecciona un usuario para registrar las entradas importadas antes de habilitar la importación entrante' });
      }
      const hasEnabledMapping = (config.entityMappings || []).some((mapping) => mapping.enabled && mapping.clientId);
      if (!hasEnabledMapping) {
        return res.status(400).json({ message: 'Agrega al menos un mapeo de entidad habilitado y con cliente asignado antes de habilitar la importación entrante' });
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
        hasCollectorAddress: Boolean(config.email?.collectorAddress),
        entityMappingsCount: (config.entityMappings || []).length,
        inboundEnabled: Boolean(config.inbound?.enabled)
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
};

// Rutas montadas dos veces (/api/glpi y /api/integrations/glpi, ver server.js) — se aceptan
// ambos paths raíz ('/', '/config') en cada handler para no duplicar la lógica.
router.get(['/', '/config'], authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    res.json(sanitizeGlpiConfig(config));
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo configuración GLPI', error: error.message });
  }
});

router.put(['/', '/config'], authenticate, authorize('admin'), validators, validate, applyGlpiConfigPayload);

// GET /api/integrations/glpi/manual-link-field - Indica si el formulario de Nueva Entrada
// debe mostrar el campo opcional de ticket GLPI. Accesible a cualquier usuario autenticado
// (no solo admin) porque el formulario de creación lo usa cualquier analista.
// Nota: independiente del switch maestro "enabled" a propósito — el admin puede querer
// este campo activo sin prender el resto de la integración (despacho automático, etc.).
router.get('/manual-link-field', authenticate, async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    res.json({ enabled: Boolean(config.manualLinkFieldEnabled) });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo configuración GLPI', error: error.message });
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

// Lista las entidades del GLPI configurado (id + nombre) para poblar el mapeo entidad -> cliente.
router.get('/entities', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await ensureGlpiConfig();
    if (!config.enabled || config.mode !== 'api') {
      return res.status(400).json({ message: 'Habilita GLPI en modo "API REST GLPI" para listar entidades' });
    }

    const entities = await withGlpiSession(config, async (session) => {
      const entityUrl = new URL(`${session.apiBase.toString().replace(/\/$/, '')}/Entity?range=0-299`);
      const result = await glpiRequest({
        method: 'GET',
        url: entityUrl,
        timeoutMs: session.timeoutMs,
        verifyTls: session.verifyTls,
        headers: {
          'Content-Type': 'application/json',
          'Session-Token': session.sessionToken,
          'App-Token': session.appToken
        }
      });
      const rows = Array.isArray(result.data) ? result.data : [];
      return rows
        .map((row) => ({ id: row.id, name: row.completename || row.name || `Entidad #${row.id}` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    res.json({ entities });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo entidades desde GLPI', error: error.message });
  }
});

// Ejecuta un ciclo de importación entrante de inmediato (sin esperar al próximo tick del scheduler).
router.post('/inbound/run-now', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await runGlpiInboundSync();
    const config = await ensureGlpiConfig();

    if (result.skipped) {
      const reasons = {
        disabled: 'GLPI o la importación entrante están deshabilitados',
        'no-mappings': 'No hay entidades mapeadas y habilitadas con cliente asignado',
        'no-import-user': 'Falta seleccionar el usuario para registrar las importaciones',
        'import-user-not-found': 'El usuario configurado para importar ya no existe'
      };
      return res.status(400).json({ message: reasons[result.reason] || 'No se ejecutó la importación' });
    }

    await audit(req, {
      event: 'admin.glpi.inbound.run-now',
      level: 'info',
      result: { success: result.success, reason: config.inbound.lastPollMessage },
      metadata: { importedCount: result.importedCount }
    });

    res.json({ message: config.inbound.lastPollMessage, config: sanitizeGlpiConfig(config) });
  } catch (error) {
    res.status(500).json({ message: 'Error ejecutando importación GLPI', error: error.message });
  }
});

module.exports = router;
