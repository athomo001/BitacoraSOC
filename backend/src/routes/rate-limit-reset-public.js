/**
 * POST /api/system/rate-limit-reset
 *
 * Montado ANTES de apiLimiter en server.js: permite a operaciones desbloquear
 * contadores en memoria sin reiniciar el contenedor (falsos positivos 429).
 *
 * Seguridad: requiere RATE_LIMIT_RESET_SECRET (env) y cabecera
 * X-Rate-Limit-Reset-Secret con el mismo valor. Si el secret no está definido
 * o es demasiado corto, el endpoint responde 404 (oculto).
 */
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const {
  resetApiRateLimitAll,
  resetApiRateLimitKey,
  resetLoginRateLimitForIp
} = require('../middleware/rate-limiter');

const MIN_SECRET_LEN = 24;

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

async function rateLimitResetPublic(req, res) {
  const secret = process.env.RATE_LIMIT_RESET_SECRET;
  if (!secret || secret.length < MIN_SECRET_LEN) {
    return res.status(404).json({ message: 'Not found' });
  }

  const provided = req.get('X-Rate-Limit-Reset-Secret');
  if (!provided || !timingSafeEqualStrings(provided, secret)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const all = req.body?.all === true;
  const rawIp = typeof req.body?.ip === 'string' ? req.body.ip.trim() : '';
  const username = typeof req.body?.username === 'string' ? req.body.username : '';

  if (!all && (!rawIp || !isIP(rawIp))) {
    return res.status(400).json({
      message: 'Envía body.all=true o body.ip con una IPv4/IPv6 válida.'
    });
  }

  const details = [];

  try {
    if (all) {
      await resetApiRateLimitAll();
      details.push({ store: 'api', action: 'resetAll' });
    } else {
      await resetApiRateLimitKey(rawIp);
      details.push({ store: 'api', action: 'resetKey', ip: rawIp });
      await resetLoginRateLimitForIp(rawIp, username);
      details.push({
        store: 'login',
        action: 'resetKey',
        ip: rawIp,
        username: username ? String(username).trim().toLowerCase() : null
      });
    }

    try {
      await audit(req, {
        event: 'system.rate_limit.reset',
        level: 'warn',
        result: { success: true },
        metadata: { details, resetAll: all },
        actor: {
          userId: null,
          username: 'rate-limit-reset',
          role: 'system',
          isGuest: false
        }
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr }, 'Auditoría falló tras reset de rate limit (reset aplicado)');
    }

    return res.json({ ok: true, reset: details });
  } catch (err) {
    await audit(req, {
      event: 'system.rate_limit.reset',
      level: 'error',
      result: { success: false, reason: err.message },
      metadata: { details },
      actor: {
        userId: null,
        username: 'rate-limit-reset',
        role: 'system',
        isGuest: false
      }
    });
    return res.status(500).json({ message: 'No se pudo reiniciar el rate limit' });
  }
}

module.exports = rateLimitResetPublic;
