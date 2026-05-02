/**
 * File Purpose: backend/src/utils/logger.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Logger Estructurado con Pino
 * 
 * Características:
 *   - JSON structured logging (compatible SIEM)
 *   - Niveles: trace, debug, info, warn, error, fatal
 *   - Timestamps ISO8601 con timezone Chile
 *   - Pretty print en desarrollo (pino-pretty)
 *   - Producción: JSON puro para forwarding
 * 
 * Uso:
 *   logger.info({ event: 'user.login', userId: '123' }, 'Usuario autenticado')
 *   logger.error({ event: 'smtp.fail', err }, 'Error SMTP')
 * 
 * Contexto estándar:
 *   - timestamp: ISO8601
 *   - level: number (30=info, 40=warn, 50=error)
 *   - event: string (namespace.action)
 *   - requestId: UUID (desde middleware)
 *   - actor: { userId, role, isGuest }
 */
const pino = require('pino');

// Configuración timezone Chile
const timestamp = () => `,"timestamp":"${new Date().toISOString()}"`;

// Logger principal
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  // Desarrollo: pretty print colorizado
  // Producción: JSON puro (NODE_ENV=production)
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  })
});

/**
 * Helper: crear child logger con contexto de request
 * 
 * @param {Object} req - Express request
 * @returns {Object} child logger con requestId, method, path
 */
function requestLogger(req) {
  return logger.child({
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.clientIp || req.ip,
    userAgent: req.clientUserAgent || req.get('user-agent')
  });
}

/**
 * Helper: crear child logger con contexto de actor
 * 
 * @param {Object} user - req.user (desde auth middleware)
 * @returns {Object} child logger con actor
 */
function actorLogger(user) {
  if (!user) return logger;
  
  return logger.child({
    actor: {
      userId: user._id.toString(),
      username: user.username,
      role: user.role,
      isGuest: user.role === 'guest'
    }
  });
}

/**
 * Helper: sanitizar datos sensibles antes de loguear
 * 
 * @param {Object} obj - objeto a sanitizar
 * @returns {Object} objeto sin secrets
 */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = { ...obj };
  const sensitiveKeys = ['password', 'pass', 'token', 'secret', 'key', 'authorization', 'jwt'];
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitize(sanitized[key]);
    }
  }
  
  return sanitized;
}

module.exports = {
  logger,
  requestLogger,
  actorLogger,
  sanitize
};
