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
const User = require('../models/User');

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
    
    // 🔒 Clock skew tolerance: acepta tokens con diferencia ±60s
    // Previene errores por desincronización de relojes entre servidor/cliente
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      clockTolerance: 60
    });
    
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

    req.user = user;
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

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tienes permisos para realizar esta acción' });
    }

    next();
  };
};

// Middleware para verificar que NO sea guest
const notGuest = (req, res, next) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ message: 'Los invitados no tienen acceso a esta funcionalidad' });
  }
  next();
};

module.exports = {
  authenticate,
  authorize,
  notGuest
};
