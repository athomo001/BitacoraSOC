/**
 * File Purpose: backend/src/middleware/request-id.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Middleware de Correlation ID (Request Tracing)
 * 
 * Funcionalidad:
 *   - Asigna UUID único a cada request (req.requestId)
 *   - Reutiliza X-Request-Id si viene del cliente (idempotencia)
 *   - Agrega X-Request-Id a response headers (trazabilidad cliente)
 * 
 * Uso en logs:
 *   logger.info({ requestId: req.requestId, ... }, 'Evento')
 * 
 * Uso en debugging:
 *   Cliente puede enviar X-Request-Id para rastrear request end-to-end
 */
const { v4: uuidv4 } = require('uuid');

const requestIdMiddleware = (req, res, next) => {
  // Reutilizar X-Request-Id del cliente (si existe y es válido UUID)
  const clientRequestId = req.get('X-Request-Id');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (clientRequestId && uuidRegex.test(clientRequestId)) {
    req.requestId = clientRequestId;
  } else {
    // Generar nuevo UUID v4
    req.requestId = uuidv4();
  }
  
  // Agregar X-Request-Id a response (trazabilidad cliente)
  res.setHeader('X-Request-Id', req.requestId);
  
  next();
};

module.exports = requestIdMiddleware;
