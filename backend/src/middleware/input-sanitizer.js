/**
 * File Purpose: backend/src/middleware/input-sanitizer.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const { logger } = require('../utils/logger');

/*
 * QA — mitigación de operadores peligrosos en payloads (NoSQL / MongoDB):
 * Se eliminan claves que empiezan por `$` o contienen `.` en body/query/params recursivamente.
 * Comportamiento esperado: cualquier coincidencia → 400 (fallo cerrado), no solo “strip silencioso”.
 * Probar: enviar `{"$gt": ""}` anidado y verificar 400 + log `request.blocked.suspicious_input`.
 */

const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
);

const isDangerousKey = (key) => key.startsWith('$') || key.includes('.');

const sanitizeValue = (value, path = '') => {
  if (Array.isArray(value)) {
    const removedPaths = [];
    const sanitized = value.map((item, index) => {
      const itemPath = `${path}[${index}]`;
      const result = sanitizeValue(item, itemPath);
      removedPaths.push(...result.removedPaths);
      return result.sanitized;
    });
    return { sanitized, removedPaths };
  }

  if (isPlainObject(value)) {
    const sanitized = {};
    const removedPaths = [];

    for (const [key, nestedValue] of Object.entries(value)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (isDangerousKey(key)) {
        removedPaths.push(currentPath);
        continue;
      }

      const result = sanitizeValue(nestedValue, currentPath);
      removedPaths.push(...result.removedPaths);
      sanitized[key] = result.sanitized;
    }

    return { sanitized, removedPaths };
  }

  return { sanitized: value, removedPaths: [] };
};

const inputSanitizer = (req, res, next) => {
  const targets = ['body', 'query', 'params'];
  const removedByTarget = {};

  for (const target of targets) {
    const source = req[target];
    if (!source || typeof source !== 'object') {
      continue;
    }

    const { sanitized, removedPaths } = sanitizeValue(source);
    req[target] = sanitized;

    if (removedPaths.length > 0) {
      removedByTarget[target] = removedPaths;
    }
  }

  const removedCount = Object.values(removedByTarget).reduce((sum, paths) => sum + paths.length, 0);
  if (removedCount > 0) {
    logger.warn({
      event: 'request.blocked.suspicious_input',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      removedByTarget
    }, 'Request blocked due to suspicious input keys');

    return res.status(400).json({
      message: 'Entrada inválida detectada',
      details: 'Se detectaron campos no permitidos en la solicitud.'
    });
  }

  next();
};

module.exports = inputSanitizer;
