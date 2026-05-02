/**
 * File Purpose: backend/src/middleware/complement-auth.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const { auditSystem } = require('../utils/audit');
const { hashComplementToken, verifyComplementToken } = require('../utils/complement-token');
const Complement = require('../models/Complement');
const { getCircuitState } = require('../utils/complement-circuit-breaker');

const requestWindows = new Map();

/*
 * QA — complementos (apps embebidas con token propio):
 * - Bearer verificado contra hash en BD (revocación por rotación de token).
 * - Circuit breaker OPEN → 503 (degradación controlada).
 * - Rate limit en memoria por slug (reinicio de proceso resetea ventanas; entorno multi-instancia: revisar).
 * - Scopes y colecciones: probar 403 con token válido pero scope insuficiente.
 */

const recordRequestAndCheckLimit = (slug, limit = 200, windowMs = 15 * 60 * 1000) => {
  const now = Date.now();
  const existing = requestWindows.get(slug) || [];
  const validEntries = existing.filter((timestamp) => now - timestamp < windowMs);
  validEntries.push(now);
  requestWindows.set(slug, validEntries);
  return validEntries.length <= limit;
};

const denyComplementAccess = async (complement, reason, metadata = {}, statusCode = 403) => {
  await auditSystem({
    event: 'complement.api.denied',
    level: 'warn',
    source: 'complement',
    sourceId: complement?.slug || metadata.slug,
    result: { success: false, reason, statusCode },
    metadata,
    actor: {
      username: complement?.slug ? `complement:${complement.slug}` : 'complement:unknown',
      role: 'complement'
    }
  });
};

const authenticateComplement = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Application token requerido' });
    }

    const token = authHeader.slice(7).trim();
    const decoded = verifyComplementToken(token);
    const complement = await Complement.findOne({ slug: decoded.slug });

    if (!complement || complement.status === 'disabled') {
      await denyComplementAccess(complement, 'Complemento inexistente o inactivo', { slug: decoded.slug }, 401);
      return res.status(401).json({ message: 'Complemento inactivo o inexistente' });
    }

    if (!complement.tokenHash || complement.tokenHash !== hashComplementToken(token)) {
      await denyComplementAccess(complement, 'Token revocado', { slug: complement.slug }, 401);
      return res.status(401).json({ message: 'Token revocado' });
    }

    const circuit = getCircuitState(complement.slug);
    if (circuit.state === 'OPEN') {
      await denyComplementAccess(complement, 'Circuit breaker abierto', { slug: complement.slug, circuit }, 503);
      return res.status(503).json({ message: 'Complemento en mantenimiento', circuit });
    }

    if (!recordRequestAndCheckLimit(complement.slug)) {
      await denyComplementAccess(complement, 'Rate limit por token excedido', { slug: complement.slug }, 429);
      return res.status(429).json({ message: 'Rate limit excedido para el complemento' });
    }

    req.complement = complement;
    req.complementToken = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Application token inválido o expirado' });
  }
};

const requireScope = (...requiredScopes) => async (req, res, next) => {
  const grantedScopes = new Set(req.complementToken?.scopes || []);
  const missing = requiredScopes.filter((scope) => !grantedScopes.has(scope));
  if (missing.length > 0) {
    await denyComplementAccess(req.complement, 'Scope no autorizado', {
      slug: req.complement.slug,
      requiredScopes,
      missing,
      path: req.originalUrl
    }, 403);
    return res.status(403).json({ message: 'Scope no autorizado', missing });
  }

  next();
};

const requireAllowedCollection = (collectionName) => async (req, res, next) => {
  const allowedCollections = new Set(req.complementToken?.allowedCollections || []);
  if (!allowedCollections.has(collectionName)) {
    await denyComplementAccess(req.complement, 'Colección no autorizada', {
      slug: req.complement.slug,
      collectionName,
      path: req.originalUrl
    }, 403);
    return res.status(403).json({ message: 'Colección no autorizada' });
  }

  next();
};

module.exports = {
  authenticateComplement,
  requireAllowedCollection,
  requireScope
};