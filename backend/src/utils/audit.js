/**
 * File Purpose: backend/src/utils/audit.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Helper de Auditoría Centralizada
 * 
 * Funcionalidad:
 *   - Persiste eventos críticos en MongoDB (AuditLog)
 *   - Emite logs estructurados (pino logger)
 *   - Dispara forwarding a colector externo (si enabled)
 * 
 * Uso:
 *   await audit(req, {
 *     event: 'shiftcheck.submit',
 *     level: 'info',
 *     result: { success: true },
 *     metadata: { type: 'inicio', redCount: 2 }
 *   });
 * 
 * Sanitización automática:
 *   - Filtra secrets (password, token, jwt)
 *   - Limita tamaño de metadata (max 10KB)
 */
const AuditLog = require('../models/AuditLog');
const { logger, sanitize } = require('./logger');

/**
 * Registrar evento de auditoría
 * 
 * @param {Object} req - Express request (para contexto)
 * @param {Object} data - Datos del evento
 * @param {string} data.event - Evento (namespace.action)
 * @param {string} data.level - Nivel (info/warn/error)
 * @param {Object} data.result - { success, reason, statusCode }
 * @param {Object} data.metadata - Datos adicionales del evento
 * @returns {Promise<Object>} AuditLog document
 */
async function audit(req, data) {
  try {
    const {
      event,
      level = 'info',
      result,
      metadata = {},
      actor: actorOverride = null,
      source = 'core',
      sourceId = null
    } = data;
    
    // Validar campos requeridos
    if (!event || !result) {
      throw new Error('audit() requires event and result');
    }
    
    // Extraer actor de req.user (si existe)
    const actor = actorOverride || (req.user ? {
      userId: req.user._id,
      username: req.user.username,
      role: req.user.role,
      isGuest: req.user.role === 'guest'
    } : null);
    
    // Extraer request context
    const request = {
      requestId: req.requestId,
      ip: req.clientIp || req.ip,
      userAgent: req.clientUserAgent || req.get('user-agent'),
      method: req.method,
      path: req.path,
      deviceFingerprint: req.clientMetadata?.device?.fingerprint,
      devicePlatform: req.clientMetadata?.device?.platform,
      deviceLanguage: req.clientMetadata?.device?.language,
      forwardedFor: req.clientMetadata?.network?.forwardedFor,
      isLikelyVpnOrProxy: req.clientMetadata?.network?.isLikelyVpnOrProxy,
      vpnSignals: req.clientMetadata?.network?.vpnSignals || [],
      sessionKey: req.authSessionKey,
      ipChanged: req.securitySignals?.ipChanged === true,
      previousIp: req.securitySignals?.previousIp || null
    };
    
    // Sanitizar metadata (sin secrets, max 10KB)
    const sanitizedMetadata = sanitize(metadata);
    const metadataStr = JSON.stringify(sanitizedMetadata);
    if (metadataStr.length > 10240) {
      sanitizedMetadata._truncated = true;
      sanitizedMetadata._originalSize = metadataStr.length;
    }
    
    // Crear registro en MongoDB
    const auditRecord = await AuditLog.create({
      timestamp: new Date(),
      event,
      level,
      actor,
      request,
      result,
      metadata: sanitizedMetadata,
      source,
      sourceId
    });
    
    // Log estructurado (pino)
    const logData = {
      auditId: auditRecord._id.toString(),
      event,
      requestId: request.requestId,
      source,
      sourceId,
      actor,
      result,
      metadata: sanitizedMetadata
    };
    
    if (result.success) {
      logger.info(logData, `Audit: ${event}`);
    } else {
      logger.warn(logData, `Audit: ${event} - ${result.reason}`);
    }
    
    // Emitir evento para logForwarder (async, no bloquea)
    // El forwarder escucha eventos 'audit' y los envía si está enabled
    process.nextTick(() => {
      const logForwarder = require('./logForwarder');
      logForwarder.forward(auditRecord).catch(err => {
        logger.error({ err, auditId: auditRecord._id }, 'Error forwarding audit log');
      });
    });
    
    return auditRecord;
    
  } catch (error) {
    // Si falla audit, loguear pero NO bloquear el request
    logger.error({ err: error, event: data.event }, 'Error creating audit log');
    // No lanzar error para evitar romper flujo principal
    return null;
  }
}

/**
 * Helper: audit simplificado para casos sin req (scripts, jobs)
 * 
 * @param {Object} data - Datos del evento (sin request context)
 * @returns {Promise<Object>} AuditLog document
 */
async function auditSystem(data) {
  const fakeReq = {
    requestId: 'system',
    ip: '127.0.0.1',
    method: 'SYSTEM',
    path: '/internal',
    get: () => 'system'
  };
  
  return audit(fakeReq, data);
}

module.exports = {
  audit,
  auditSystem
};
