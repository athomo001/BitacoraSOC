/**
 * File Purpose: backend/src/middleware/rate-limiter.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rate Limiters de Seguridad
 * 
 * Funcionalidad:
 *   - Prevenir brute force en login (5 intentos/15min)
 *   - Limitar abuso general de API (100 req/15min por IP)
 * 
 * Configuración:
 *   - loginLimiter: aplicado solo en POST /api/auth/login
 *   - apiLimiter: aplicado globalmente en app.use('/api/', apiLimiter)
 * 
 * Comportamiento:
 *   - Bloquea por IP (X-Forwarded-For aware si hay proxy)
 *   - Responde 429 Too Many Requests al superar límite
 *   - skipSuccessfulRequests=false: logins exitosos también cuentan
 * 
 * Reglas SOC:
 *   - 5 intentos login: previene credential stuffing
 *   - 100 req/15min: permite operación normal pero bloquea scraping
 *
 * Store dedicado en memoria para `apiLimiter` (MemoryStore) permite
 * `resetAll` / `resetKey` sin reiniciar el proceso (vía POST /api/system/rate-limit-reset + secreto).
 *
 * QA adicional: contadores en memoria no se comparten entre réplicas; bajo varias instancias,
 * el límite “efectivo” se multiplica. Validar arquitectura de despliegue antes de asumir 100% cobertura anti-abuso.
 */
const rateLimit = require('express-rate-limit');
let MongoStore = null;
try {
  MongoStore = require('rate-limit-mongo');
} catch (error) {
  console.warn('⚠️ rate-limit-mongo no está disponible. Se usará MemoryStore temporal.');
}

const isProduction = process.env.NODE_ENV === 'production';

const createMongoStore = (collectionName) => {
  if (!MongoStore || !process.env.MONGODB_URI) {
    return undefined;
  }

  return new MongoStore({
    uri: process.env.MONGODB_URI,
    collectionName,
    expireTimeMs: 15 * 60 * 1000,
    errorHandler: console.error.bind(null, 'rate-limit-mongo')
  });
};

/** Store exclusivo del limiter global API (no compartir con otros limiters). */
const apiRateLimitStore = createMongoStore('rate_limits_api');

const parseEnvInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const defaultWindowMs = 15 * 60 * 1000;
const defaultPublicMax = 300;
const defaultAuthenticatedMax = 1200;

const apiWindowMs = parseEnvInt(process.env.RATE_LIMIT_WINDOW_MS, defaultWindowMs);
const apiPublicMax = parseEnvInt(process.env.RATE_LIMIT_MAX_REQUESTS, defaultPublicMax);
const apiAuthenticatedMax = parseEnvInt(process.env.RATE_LIMIT_MAX_AUTH_REQUESTS, defaultAuthenticatedMax);
const loginMax = parseEnvInt(process.env.RATE_LIMIT_LOGIN_MAX, 5);

const hasAuthToken = (req) => {
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ') && authorization.length > 16) {
    return true;
  }
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const authCookie = cookieHeader
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('auth_token='));
    if (authCookie && authCookie.length > 20) {
      return true;
    }
  }
  return false;
};

const getAuthTokenValue = (req) => {
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ') && authorization.length > 16) {
    return authorization.substring(7);
  }
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const authCookie = cookieHeader
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('auth_token='));
    if (authCookie && authCookie.length > 20) {
      const tokenValue = authCookie.substring('auth_token='.length);
      return decodeURIComponent(tokenValue);
    }
  }
  return null;
};

const getApiLimiterKey = (req) => {
  const token = getAuthTokenValue(req);
  if (token) {
    return `auth:${token.substring(token.length - 24)}`;
  }
  return req.ip;
};

const getLoginLimiterKey = (req) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  return username ? `${req.ip}:${username}` : req.ip;
};

// Rate limiter para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: loginMax,
  keyGenerator: getLoginLimiterKey,
  message: {
    message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  store: createMongoStore('rate_limits_login')
});

// Rate limiter general para API
const apiLimiter = rateLimit({
  windowMs: apiWindowMs,
  max: (req) => (hasAuthToken(req) ? apiAuthenticatedMax : apiPublicMax),
  keyGenerator: getApiLimiterKey,
  message: {
    message: 'Demasiadas peticiones desde esta IP, intenta de nuevo más tarde',
    rate_limit_scope: 'api_global'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (!isProduction || req.method === 'OPTIONS') return true;
    // Omitir límite agresivo en rutas pre-login de bajo riesgo visual
    const path = req.path || '';
    if (path === '/config/logo' || path.startsWith('/config/')) return true;
    return false;
  },
  store: apiRateLimitStore
});

/**
 * Vacía el bucket global del apiLimiter (todas las IPs / claves).
 * @returns {Promise<void>}
 */
async function resetApiRateLimitAll() {
  try {
    if (!apiRateLimitStore) {
      return;
    }

    if (typeof apiRateLimitStore.resetAll === 'function') {
      await apiRateLimitStore.resetAll();
    } else if (apiRateLimitStore.collection) {
      await apiRateLimitStore.collection.deleteMany({});
    }
  } catch (err) {
    console.error('Error in resetApiRateLimitAll:', err);
  }
}

/**
 * Vacía el bucket del apiLimiter para una clave concreta (p. ej. IP pública del cliente).
 * @param {string} key
 * @returns {Promise<void>}
 */
async function resetApiRateLimitKey(key) {
  try {
    if (typeof apiRateLimitStore.resetKey === 'function') {
      await apiRateLimitStore.resetKey(key);
    } else if (apiRateLimitStore.collection) {
      await apiRateLimitStore.collection.deleteOne({ _id: key });
    }
  } catch (err) {
    console.error('Error in resetApiRateLimitKey:', err);
  }
}

/**
 * Limpia contadores de login para una IP (y opcionalmente ip:usuario).
 * @param {string} ip
 * @param {string} [username]
 * @returns {Promise<void>}
 */
async function resetLoginRateLimitForIp(ip, username) {
  await loginLimiter.resetKey(ip);
  const u = String(username || '').trim().toLowerCase();
  if (u) {
    await loginLimiter.resetKey(`${ip}:${u}`);
  }
}

module.exports.resetApiRateLimitAll = resetApiRateLimitAll;
module.exports.resetApiRateLimitKey = resetApiRateLimitKey;
module.exports.resetLoginRateLimitForIp = resetLoginRateLimitForIp;

// Rate limiter para recuperación de contraseña (máx 3/15min)
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Demasiados intentos de recuperación. Intenta de nuevo en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createMongoStore('rate_limits_forgot_pw')
});

// Rate limiter para reseteo de contraseña (máx 5/15min)
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiados intentos de reseteo. Solicita un nuevo enlace.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createMongoStore('rate_limits_reset_pw')
});

/**
 * Rate limiter para páginas públicas con token (montadas en `/p`, fuera de `/api/`).
 * Una TV refrescando cada ~10 min consume ~1 req/10min; 120/10min deja margen para varios
 * visores legítimos y frena el escaneo/fuerza bruta de tokens.
 */
const publicShareLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createMongoStore('rate_limits_public_share')
});

module.exports.loginLimiter = loginLimiter;
module.exports.apiLimiter = apiLimiter;
module.exports.forgotPasswordLimiter = forgotPasswordLimiter;
module.exports.resetPasswordLimiter = resetPasswordLimiter;
module.exports.publicShareLimiter = publicShareLimiter;
