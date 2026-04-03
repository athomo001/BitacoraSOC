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
 */
const rateLimit = require('express-rate-limit');
const isProduction = process.env.NODE_ENV === 'production';

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

const hasBearerToken = (req) => {
  const authorization = req.headers?.authorization;
  return typeof authorization === 'string' && authorization.startsWith('Bearer ') && authorization.length > 16;
};

const getApiLimiterKey = (req) => {
  if (hasBearerToken(req)) {
    return `auth:${req.headers.authorization.slice(7)}`;
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
  skipSuccessfulRequests: true
});

// Rate limiter general para API
const apiLimiter = rateLimit({
  windowMs: apiWindowMs,
  max: (req) => (hasBearerToken(req) ? apiAuthenticatedMax : apiPublicMax),
  keyGenerator: getApiLimiterKey,
  message: 'Demasiadas peticiones desde esta IP, intenta de nuevo más tarde',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isProduction || req.method === 'OPTIONS' || hasBearerToken(req)
});

// Rate limiter para recuperación de contraseña (máx 3/15min)
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Demasiados intentos de recuperación. Intenta de nuevo en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter para reseteo de contraseña (máx 5/15min)
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiados intentos de reseteo. Solicita un nuevo enlace.',
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  loginLimiter,
  apiLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter
};
