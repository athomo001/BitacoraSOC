/**
 * File Purpose: backend/src/routes/logging.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de configuración de log forwarding
 * 
 * Solo admin puede:
 *   - Ver/actualizar config de SIEM
 *   - Probar conexión al colector externo
 * 
 * Endpoints:
 *   GET  /api/logging/config      - Obtener configuración actual
 *   PUT  /api/logging/config      - Actualizar configuración
 *   POST /api/logging/test        - Probar conexión al colector
 * 
 * Seguridad:
 *   - authenticate middleware (JWT válido)
 *   - authorize('admin') middleware (solo admin)
 *   - Validación de host/port
 *   - clientKey NO se expone en GET (solo en env)
 */
const express = require('express');
const router = express.Router();
const LogForwardingConfig = require('../models/LogForwardingConfig');
const logForwarder = require('../utils/logForwarder');
const { authenticate, authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const { assertOutboundUrlSafe } = require('../utils/outbound-url-guard');

const ALLOWED_TRANSPORTS = ['udp', 'tcp', 'tls', 'http'];
const ALLOWED_MODES = ['plain', 'tls'];
const ALLOWED_FORMATS = ['json', 'rfc5424'];
const ALLOWED_LEVELS = ['audit-only', 'info', 'warn', 'error'];

function sanitizeConfig(configDoc) {
  const safeConfig = configDoc.toObject();
  if (safeConfig.tls && safeConfig.tls._clientKeyNote) {
    delete safeConfig.tls._clientKeyNote;
  }
  return safeConfig;
}

function normalizePayload(body = {}) {
  const {
    name,
    enabled,
    host,
    port,
    transport,
    mode,
    format,
    tls,
    http,
    retry,
    forwardLevel
  } = body;

  const finalTransport = transport || (mode === 'plain' ? 'tcp' : 'tls');

  return {
    name,
    enabled,
    host,
    port,
    transport: finalTransport,
    mode,
    format,
    tls,
    http,
    retry,
    forwardLevel
  };
}

function validatePayload(payload) {
  if (payload.transport && !ALLOWED_TRANSPORTS.includes(payload.transport)) {
    return 'Transport debe ser udp, tcp, tls o http';
  }

  if (payload.mode && !ALLOWED_MODES.includes(payload.mode)) {
    return 'Mode debe ser "plain" o "tls"';
  }

  if (payload.format && !ALLOWED_FORMATS.includes(payload.format)) {
    return 'Format debe ser json o rfc5424';
  }

  if (payload.forwardLevel && !ALLOWED_LEVELS.includes(payload.forwardLevel)) {
    return 'forwardLevel debe ser audit-only, info, warn o error';
  }

  if (payload.enabled && payload.transport !== 'http' && (!payload.host || !payload.port)) {
    return 'Host y port son requeridos cuando forwarding está habilitado';
  }

  if (payload.enabled && payload.transport === 'http' && !payload.http?.url) {
    return 'http.url es requerido cuando transport=http';
  }

  if (payload.port && (payload.port < 1 || payload.port > 65535)) {
    return 'Puerto debe estar entre 1 y 65535';
  }

  return null;
}

function applyPayload(config, payload, userId) {
  if (payload.name !== undefined) config.name = (payload.name || '').trim() || 'Integración SIEM/SOAR/NDR';
  if (payload.enabled !== undefined) config.enabled = payload.enabled;
  if (payload.host !== undefined) config.host = payload.host;
  if (payload.port !== undefined) config.port = payload.port;
  if (payload.transport !== undefined) config.transport = payload.transport;
  if (payload.mode !== undefined) config.mode = payload.mode;
  if (payload.format !== undefined) config.format = payload.format;

  if (payload.tls) {
    config.tls = {
      ...config.tls,
      ...payload.tls
    };
  }

  if (payload.http) {
    config.http = {
      ...config.http,
      ...payload.http
    };
  }

  if (payload.retry) {
    config.retry = {
      ...config.retry,
      ...payload.retry
    };
  }

  if (payload.forwardLevel !== undefined) config.forwardLevel = payload.forwardLevel;
  config.lastUpdatedBy = userId;
}

/**
 * GET /api/logging/config
 * 
 * Obtener configuración actual de log forwarding
 * 
 * Respuesta:
 *   200: Configuración actual (sin secretos)
 *   404: No existe configuración
 */
router.get('/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    let config = await LogForwardingConfig.findOne().sort({ createdAt: 1 });
    
    if (!config) {
      // Crear config por defecto si no existe
      config = new LogForwardingConfig({
        name: 'Integración SIEM/SOAR/NDR #1',
        enabled: false,
        host: 'localhost',
        port: 514,
        transport: 'udp',
        mode: 'plain',
        format: 'json',
        forwardLevel: 'audit-only'
      });
      await config.save();
    }
    
    // NO exponer clientKey (está en env, no DB)
    const safeConfig = sanitizeConfig(config);
    
    await audit(req, {
      event: 'admin.logging.view',
      level: 'info',
      result: { success: true },
      metadata: { enabled: config.enabled }
    });
    
    res.json(safeConfig);
    
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error fetching log config');
    
    await audit(req, {
      event: 'admin.logging.view',
      level: 'error',
      result: { success: false, reason: error.message }
    });
    
    res.status(500).json({ error: 'Error al obtener configuración de logs' });
  }
});

/**
 * PUT /api/logging/config
 * 
 * Actualizar configuración de log forwarding
 * 
 * Body:
 *   {
 *     enabled: boolean,
 *     host: string (IP o hostname),
 *     port: number (1-65535),
 *     mode: 'plain' | 'tls',
 *     tls: { rejectUnauthorized, caCert, clientCert },
 *     retry: { enabled, maxRetries, backoffMs },
 *     forwardLevel: 'audit-only' | 'info' | 'warn' | 'error'
 *   }
 * 
 * Respuesta:
 *   200: Config actualizada
 *   400: Validación fallida
 */
router.put('/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (payload.enabled && payload.transport === 'http' && payload.http?.url) {
      try {
        await assertOutboundUrlSafe(payload.http.url, { requireHttps: true });
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }
    
    // Actualizar config (upsert)
    let config = await LogForwardingConfig.findOne().sort({ createdAt: 1 });
    
    if (!config) {
      config = new LogForwardingConfig();
    }
    
    applyPayload(config, payload, req.user._id);
    
    await config.save();
    
    // Recargar config en logForwarder
    await logForwarder.reloadConfig();
    
    logger.info({
      event: 'admin.logging.update',
      userId: req.user._id,
      enabled: config.enabled,
      host: config.host,
      port: config.port,
      transport: config.transport,
      format: config.format
    }, 'Log forwarding config updated');
    
    await audit(req, {
      event: 'admin.logging.update',
      level: 'info',
      result: { success: true },
      metadata: {
        enabled: config.enabled,
        host: config.host,
        port: config.port,
        transport: config.transport,
        format: config.format,
        mode: config.mode,
        forwardLevel: config.forwardLevel
      }
    });
    
    res.json({ message: 'Configuración actualizada', config });
    
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error updating log config');
    
    await audit(req, {
      event: 'admin.logging.update',
      level: 'error',
      result: { success: false, reason: error.message }
    });
    
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

/**
 * POST /api/logging/test
 * 
 * Probar conexión al colector externo
 * 
 * Envía un log de prueba y retorna resultado
 * 
 * Respuesta:
 *   200: { success: true, message: 'Connection successful' }
 *   400: { success: false, error: 'Connection timeout' }
 */
router.post('/test', authenticate, authorize('admin'), async (req, res) => {
  try {
    // Test de conexión
    const config = await LogForwardingConfig.findOne({ enabled: true }).sort({ updatedAt: -1 })
      || await LogForwardingConfig.findOne().sort({ updatedAt: -1 });

    if (!config) {
      return res.status(400).json({
        success: false,
        error: 'No hay integración configurada para probar'
      });
    }

    const result = await logForwarder.testConnection(config._id.toString());
    
    // Guardar resultado en config
    config.lastTestedAt = new Date();
    config.lastTestResult = {
      success: result.success,
      message: result.message,
      timestamp: new Date()
    };
    await config.save();
    
    logger.info({
      event: 'admin.logging.test',
      userId: req.user._id,
      success: result.success
    }, 'Log forwarding test executed');
    
    await audit(req, {
      event: 'admin.logging.test',
      level: 'info',
      result: { success: result.success, reason: result.message }
    });
    
    res.json(result);
    
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error testing log connection');
    
    // Guardar resultado fallido en config
    const config = await LogForwardingConfig.findOne();
    if (config) {
      config.lastTestedAt = new Date();
      config.lastTestResult = {
        success: false,
        message: error.message,
        timestamp: new Date()
      };
      await config.save();
    }
    
    await audit(req, {
      event: 'admin.logging.test',
      level: 'warn',
      result: { success: false, reason: error.message }
    });
    
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/configs', authenticate, authorize('admin'), async (req, res) => {
  try {
    const configs = await LogForwardingConfig.find().sort({ createdAt: 1 });

    await audit(req, {
      event: 'admin.logging.list',
      level: 'info',
      result: { success: true },
      metadata: { count: configs.length }
    });

    res.json(configs.map(sanitizeConfig));
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error listing log configs');
    res.status(500).json({ error: 'Error al listar integraciones' });
  }
});

router.post('/configs', authenticate, authorize('admin'), async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const config = new LogForwardingConfig();
    applyPayload(config, payload, req.user._id);
    await config.save();

    await logForwarder.reloadConfig();

    await audit(req, {
      event: 'admin.logging.create',
      level: 'info',
      result: { success: true },
      metadata: { configId: config._id, name: config.name, transport: config.transport, enabled: config.enabled }
    });

    res.status(201).json({ message: 'Integración creada', config: sanitizeConfig(config) });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error creating integration');
    res.status(500).json({ error: 'Error al crear integración' });
  }
});

router.put('/configs/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const config = await LogForwardingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ error: 'Integración no encontrada' });
    }

    applyPayload(config, payload, req.user._id);
    await config.save();

    await logForwarder.reloadConfig();

    await audit(req, {
      event: 'admin.logging.update',
      level: 'info',
      result: { success: true },
      metadata: { configId: config._id, name: config.name, transport: config.transport, enabled: config.enabled }
    });

    res.json({ message: 'Integración actualizada', config: sanitizeConfig(config) });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error updating integration');
    res.status(500).json({ error: 'Error al actualizar integración' });
  }
});

router.delete('/configs/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await LogForwardingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ error: 'Integración no encontrada' });
    }

    await LogForwardingConfig.deleteOne({ _id: config._id });
    await logForwarder.reloadConfig();

    await audit(req, {
      event: 'admin.logging.delete',
      level: 'info',
      result: { success: true },
      metadata: { configId: config._id, name: config.name }
    });

    res.json({ message: 'Integración eliminada' });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error deleting integration');
    res.status(500).json({ error: 'Error al eliminar integración' });
  }
});

router.post('/configs/:id/test', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await LogForwardingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ error: 'Integración no encontrada' });
    }

    const result = await logForwarder.testConnection(config._id.toString());

    config.lastTestedAt = new Date();
    config.lastTestResult = {
      success: result.success,
      message: result.message,
      timestamp: new Date()
    };
    await config.save();

    await audit(req, {
      event: 'admin.logging.test',
      level: 'info',
      result: { success: result.success, reason: result.message },
      metadata: { configId: config._id, name: config.name }
    });

    res.json(result);
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'Error testing integration');
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
