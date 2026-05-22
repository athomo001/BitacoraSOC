/**
 * File Purpose: backend/src/middleware/auth.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Middleware de Autenticación y Autorización
 * 
 * Funciones:
 *   - authenticate: Verifica JWT y carga usuario en req.user
 *   - authorize(...roles): Bloquea acceso si rol no coincide
 *   - notGuest: Bloquea acceso a invitados
 * 
 * Validaciones especiales:
 *   - Guest expiration: Desactiva cuenta si guestExpiresAt < now
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const TokenDenylist = require('../models/TokenDenylist');

const READ_ONLY_ROLES = new Set(['guest', 'auditor']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const canEditOwnProfile = (req) => {
  if (!req) {
    return false;
  }

  const method = (req.method || '').toUpperCase();
  if (method !== 'PUT' && method !== 'PATCH') {
    return false;
  }

  const baseUrl = req.baseUrl || '';
  const path = req.path || '';
  return baseUrl.endsWith('/users') && path === '/me';
};

const sessionIpTracker = new Map();

/*
 * QA — superficie de autenticación:
 * - Token aceptado desde `Authorization: Bearer` o cookie `auth_token` (compatibilidad browser/API).
 * - Guest expirado: se desactiva cuenta y 401 (coherente con login).
 * - Sesión: hash del token en tracker (no almacena JWT completo); cambio de IP → auditoría warn, no bloquea.
 * - Roles solo lectura: guest/auditor bloquean métodos mutadores salvo PATCH/PUT `/users/me`.
 */

const getTokenFromCookie = (req) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const authCookie = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('auth_token='));

  if (!authCookie) {
    return null;
  }

  const tokenValue = authCookie.substring('auth_token='.length);
  return tokenValue ? decodeURIComponent(tokenValue) : null;
};

// 🔐 Middleware para verificar JWT y cargar usuario
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    const headerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;
    const cookieToken = getTokenFromCookie(req);
    const token = headerToken || cookieToken;

    if (!token) {
      return res.status(401).json({ message: 'No se proporcionó token de autenticación' });
    }
    
    // Validar en Denylist
    const isDenylisted = await TokenDenylist.exists({ token });
    if (isDenylisted) {
      return res.status(401).json({ message: 'Sesión terminada. Token inválido o revocado.' });
    }
    
    // 🔒 Clock skew tolerance: acepta tokens con diferencia ±60s
    // Previene errores por desincronización de relojes entre servidor/cliente
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      clockTolerance: 60
    });

    const authSessionKey = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex')
      .slice(0, 24);
    
    // Buscar usuario
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Usuario no encontrado o inactivo' });
    }

    // 🕐 Verificar si es guest y está expirado (regla SOC: guests expiran a 48h)
    //
    // Si un guest expiró, se desactiva automáticamente para prevenir acceso.
    // Esto complementa la validación en /login, pero también bloquea tokens
    // JWT válidos de guests cuya cuenta ya expiró.
    if (user.role === 'guest' && user.isGuestExpired()) {
      await User.findByIdAndUpdate(user._id, { isActive: false });
      return res.status(401).json({ message: 'Sesión de invitado expirada' });
    }

    const currentIp = req.clientIp || req.headers['x-forwarded-for'] || req.ip;
    const trackerKey = `${decoded.userId}:${authSessionKey}`;
    const previousSession = sessionIpTracker.get(trackerKey);

    req.authSessionKey = authSessionKey;
    req.securitySignals = {
      ipChanged: false,
      previousIp: null,
      previousSeenAt: null
    };

    if (previousSession && previousSession.ip && previousSession.ip !== currentIp) {
      req.securitySignals = {
        ipChanged: true,
        previousIp: previousSession.ip,
        previousSeenAt: previousSession.seenAt
      };

      const { audit } = require('../utils/audit');
      audit(req, {
        event: 'auth.session.ip_change',
        level: 'warn',
        result: { success: false, reason: 'IP change detected in active session' },
        metadata: {
          userId: user._id,
          username: user.username,
          sessionKey: authSessionKey,
          previousIp: previousSession.ip,
          currentIp,
          previousSeenAt: previousSession.seenAt,
          detectedAt: new Date().toISOString(),
          deviceFingerprint: req.clientMetadata?.device?.fingerprint,
          isLikelyVpnOrProxy: req.clientMetadata?.network?.isLikelyVpnOrProxy,
          vpnSignals: req.clientMetadata?.network?.vpnSignals || []
        }
      });
    }

    sessionIpTracker.set(trackerKey, {
      ip: currentIp,
      seenAt: new Date().toISOString()
    });

    req.user = user;

    if (READ_ONLY_ROLES.has(user.role) && !SAFE_METHODS.has(req.method) && !canEditOwnProfile(req)) {
      return res.status(403).json({ message: 'Este rol es de solo lectura y no puede modificar información' });
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expirado' });
    }
    return res.status(500).json({ message: 'Error de autenticación' });
  }
};

// Middleware para verificar roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autenticado' });
    }

    const hasRole = roles.includes(req.user.role);
    const auditorReadOnlyAdmin =
      req.user.role === 'auditor' &&
      roles.includes('admin') &&
      SAFE_METHODS.has(req.method);

    if (!hasRole && !auditorReadOnlyAdmin) {
      const { audit } = require('../utils/audit');
      audit(req, {
        event: 'auth.authorize.fail',
        level: 'warn',
        result: { success: false, reason: 'Forbidden: Insufficient privileges' },
        metadata: {
          requiredRoles: roles,
          userRole: req.user.role,
          method: req.method,
          path: req.originalUrl || req.path
        }
      }).catch(err => console.error('Audit error:', err));
      
      return res.status(403).json({ message: 'No tienes permisos para realizar esta acción' });
    }

    next();
  };
};

// Middleware para verificar que NO sea rol de solo lectura (guest/auditor)
const notGuest = (req, res, next) => {
  if (req.user.role === 'guest' || req.user.role === 'auditor') {
    return res.status(403).json({ message: 'Este rol es de solo lectura y no puede modificar información' });
  }
  next();
};

module.exports = {
  authenticate,
  authorize,
  notGuest
};
