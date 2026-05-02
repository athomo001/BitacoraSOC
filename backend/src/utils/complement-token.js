/**
 * File Purpose: backend/src/utils/complement-token.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const MAX_TTL_SECONDS = 24 * 60 * 60;

const getComplementTokenSecret = () => {
  const secret = String(process.env.COMPLEMENT_TOKEN_SECRET || '').trim();
  if (!secret) {
    throw new Error('COMPLEMENT_TOKEN_SECRET no configurado');
  }
  return secret;
};

const hashComplementToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

const issueComplementToken = (complement, options = {}) => {
  const ttlSeconds = Math.min(Math.max(Number(options.ttlSeconds) || 8 * 60 * 60, 60), MAX_TTL_SECONDS);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'bitacora-core',
    sub: `complement:${complement.slug}`,
    slug: complement.slug,
    scopes: Array.isArray(complement.permissions?.scopes) ? complement.permissions.scopes : [],
    allowedCollections: Array.isArray(complement.permissions?.allowedCollections)
      ? complement.permissions.allowedCollections
      : []
  };

  const token = jwt.sign(payload, getComplementTokenSecret(), {
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
    notBefore: 0
  });

  return {
    token,
    tokenHash: hashComplementToken(token),
    expiresAt: new Date((nowSeconds + ttlSeconds) * 1000)
  };
};

const verifyComplementToken = (token) => jwt.verify(token, getComplementTokenSecret(), {
  algorithms: ['HS256'],
  clockTolerance: 30
});

module.exports = {
  getComplementTokenSecret,
  hashComplementToken,
  issueComplementToken,
  verifyComplementToken
};