/**
 * File Purpose: backend/src/routes/auth.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de Autenticación
 * 
 * Endpoints:
 *   POST /api/auth/login   - Iniciar sesión
 *   POST /api/auth/refresh - Renovar token JWT
 *   POST /api/auth/forgot-password - Solicitar token de reseteo
 *   POST /api/auth/reset-password - Resetear contraseña
 * 
 * Roles: admin, user, guest
 * 
 * Tokens JWT (C6 - Reducido por seguridad):
 *   - Admin/User: 4h de duración (reducido de 24h)
 *   - Guest: 2h de duración (cuentas guest expiran a 48h)
 *   - Verificación de expiración guest en login y refresh
 * 
 * Token de Recuperación (C5 - Reducido por seguridad):
 *   - Duración: 5 minutos (reducido de 1 hora)
 *   - Hasheado con SHA256 antes de almacenar
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const User = require('../models/User');
const AppConfig = require('../models/AppConfig');
const TokenDenylist = require('../models/TokenDenylist');
const validate = require('../middleware/validate');
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rate-limiter');
const { audit } = require('../utils/audit');
const { getBrandingSnapshot, getAppTitleForText } = require('../utils/branding');
const { buildFrontendResetUrl } = require('../utils/frontend-url');
const { logger } = require('../utils/logger');
const { getTokenFromCookie } = require('../utils/cookie-helper');
const { sendEmail } = require('../utils/email');
const qrcode = require('qrcode');
const { generateSecret, verifyTOTP } = require('../utils/totp');
const { authenticate, authorize } = require('../middleware/auth');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * QA — rutas /api/auth:
 * - Login: mismo mensaje genérico ante usuario inexistente / password incorrecta (reduce enumeración).
 * - Easter egg: solo en fallo de credenciales; no filtra existencia de usuario.
 * - Cookies: opciones dependen de entorno y localhost (SameSite); probar redirect tras login.
 * - Refresh: guests pueden renovar JWT; documentado riesgo en comentario TODO del endpoint.
 */

const resolveCookieSecure = (req) => {
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }

  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }

  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim() === 'https';
  }

  return process.env.NODE_ENV === 'production';
};

const getAuthCookieOptions = (req) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || req.hostname === '::1';

  // En desarrollo local (localhost), Chrome corta las cookies (401) si hay redirección cruzada HTTP -> HTTPS por SameSite=strict.
  // Permitiendo SameSite=None (con Secure=true) arregla el traspaso de credenciales por redirección 308/307 en caché local.
  const bypassSameSite = isDev && isLocalhost;

  return {
    httpOnly: true,
    secure: bypassSameSite ? true : resolveCookieSecure(req),
    sameSite: bypassSameSite ? 'none' : 'strict',
    path: '/'
  };
};

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

const resolveLoginEasterEgg = (rules, username, password) => {
  if (!Array.isArray(rules) || !rules.length) {
    return null;
  }

  const normalizedUsername = normalizeValue(username);
  const normalizedPassword = normalizeValue(password);
  const normalizedPair = `${normalizedUsername}/${normalizedPassword}`;

  const rule = rules.find((candidate) => {
    if (!candidate?.enabled || candidate?.scope !== 'login' || candidate?.triggerType !== 'credentials') {
      return false;
    }

    const hasUserPass = candidate.username || candidate.password;
    if (hasUserPass) {
      return normalizeValue(candidate.username) === normalizedUsername
        && normalizeValue(candidate.password) === normalizedPassword;
    }

    if (candidate.pattern) {
      return normalizeValue(candidate.pattern) === normalizedPair;
    }

    return false;
  });

  if (!rule) {
    return null;
  }

  return {
    scope: 'login',
    payload: {
      blackout: rule.payload?.blackout !== false,
      imageUrl: rule.payload?.imageUrl || '/scripts/Bender.png',
      durationMs: Number(rule.payload?.durationMs) > 0 ? Number(rule.payload.durationMs) : 3000
    }
  };
};

const getLoginEasterEggSignal = async (username, password) => {
  try {
    const config = await AppConfig.findOne().select('easterEggRules');
    return resolveLoginEasterEgg(config?.easterEggRules, username, password);
  } catch (error) {
    logger.warn({ err: error }, 'Unable to resolve login easter egg rules');
    return null;
  }
};

const setAuthCookie = (req, res, token) => {
  res.cookie('auth_token', token, {
    ...getAuthCookieOptions(req),
    maxAge: 4 * 60 * 60 * 1000
  });
};

// 🎫 Generar token JWT con expiración diferenciada por rol
// Guest: 2h (sesión corta), Admin/User: 4h (reducido de 24h por seguridad)
const generateToken = (userId, role) => {
  // Guest: tokens más cortos (2 horas)
  // Admin/User: 4 horas (reducido por seguridad - C6)
  const expiresIn = role === 'guest' ? '2h' : '4h';
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

// POST /api/auth/login
router.post('/login',
  loginLimiter,
  [
    body('username').trim().notEmpty().withMessage('El usuario o email es requerido'),
    body('password').notEmpty().withMessage('La contraseña es requerida')
  ],
  validate,
  async (req, res) => {
    try {
      const { username, password } = req.body;

      // Buscar por username O email
      const normalized = (username || '').trim();
      const exactMatch = new RegExp(`^${escapeRegex(normalized)}$`, 'i');

      const user = await User.findOne({
        $or: [{ username: exactMatch }, { email: exactMatch }]
      });

      if (user && user.lockedUntil && user.lockedUntil > Date.now()) {
        audit(req, {
          event: 'auth.login.fail',
          level: 'warn',
          result: { success: false, reason: 'Account locked due to brute force' },
          metadata: { username }
        }).catch(err => logger.error({ err }, 'Audit error'));
        return res.status(401).json({ message: 'Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intente en 15 minutos.' });
      }

      if (!user || !user.isActive) {
        const easterEgg = await getLoginEasterEggSignal(username, password);
        audit(req, {
          event: 'auth.login.fail',
          level: 'warn',
          result: { success: false, reason: 'Invalid credentials' },
          metadata: { username }
        }).catch(err => logger.error({ err }, 'Audit error'));

        return res.status(401).json({
          message: 'Credenciales inválidas',
          ...(easterEgg ? { easterEgg } : {})
        });
      }

      // Verificar si es guest expirado
      if (user.role === 'guest' && user.isGuestExpired()) {
        audit(req, {
          event: 'auth.login.fail',
          level: 'warn',
          result: { success: false, reason: 'Guest expired' },
          metadata: { username, guestExpiresAt: user.guestExpiresAt }
        }).catch(err => logger.error({ err }, 'Audit error'));

        return res.status(401).json({ message: 'Cuenta de invitado expirada' });
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        user.failedAttempts = (user.failedAttempts || 0) + 1;
        if (user.failedAttempts >= 5) {
          user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
        }
        await user.save();

        const easterEgg = await getLoginEasterEggSignal(username, password);
        audit(req, {
          event: 'auth.login.fail',
          level: 'warn',
          result: { success: false, reason: 'Invalid password' },
          metadata: { username, failedAttempts: user.failedAttempts }
        }).catch(err => logger.error({ err }, 'Audit error'));

        return res.status(401).json({
          message: 'Credenciales inválidas',
          ...(easterEgg ? { easterEgg } : {})
        });
      }

      // Resetear contadores de intentos fallidos si el login es exitoso
      if (user.failedAttempts > 0 || user.lockedUntil) {
        user.failedAttempts = 0;
        user.lockedUntil = null;
        await user.save();
      }

      // Interceptar login si MFA está activo
      if (user.mfaEnabled) {
        const mfaToken = jwt.sign(
          { userId: user._id, isMfaPending: true },
          process.env.JWT_SECRET,
          { expiresIn: '5m' }
        );

        await audit(req, {
          event: 'auth.login.mfa_required',
          level: 'info',
          actor: {
            userId: user._id,
            username: user.username,
            role: user.role
          },
          result: { success: true, reason: 'MFA verification required' },
          metadata: { userId: user._id }
        }).catch(err => logger.error({ err }, 'Audit error'));

        return res.json({
          requireMFA: true,
          mfaToken,
          needsSetup: !user.mfaSecret
        });
      }

      const token = generateToken(user._id, user.role);
      setAuthCookie(req, res, token);

      audit(req, {
        event: 'auth.login.success',
        level: 'info',
        actor: {
          userId: user._id,
          username: user.username,
          role: user.role,
          isGuest: user.role === 'guest'
        },
        result: { success: true, reason: 'Login successful' },
        metadata: {
          userId: user._id,
          username: user.username,
          role: user.role,
          isGuest: user.role === 'guest'
        }
      }).catch(err => logger.error({ err }, 'Audit error'));

      res.json({
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          cargoLabel: user.cargoLabel,
          role: user.role,
          theme: user.theme,
          avatar: user.avatar,
          guestExpiresAt: user.guestExpiresAt
        }
      });
    } catch (error) {
      logger.error({
        err: error,
        requestId: req.requestId,
        method: req.method,
        path: req.path
      }, 'Error in login');

      res.status(500).json({ message: 'Error al iniciar sesión' });
    }
  }
);

// POST /api/auth/refresh (opcional)
// ⚠️ NOTA: Guests pueden renovar tokens, lo que podría extender su sesión indefinidamente
// si renuevan cada hora antes de que expire su cuenta (48h).
// 
// TODO: Considerar bloquear refresh para guests o limitar ventana de renovación
// a las últimas X horas antes de expiración.
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;
    const bodyToken = req.body?.token;
    const cookieToken = getTokenFromCookie(req);
    const token = bodyToken || cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({ message: 'Token requerido' });
    }

    // 🔒 Verificar firma del token ignorando expiración para permitir silent-refresh transparente
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });

    // 🛡️ Prevenir ataques de replay verificando si el token ya está en la denylist
    const isDenylisted = await TokenDenylist.exists({ token });
    if (isDenylisted) {
      return res.status(401).json({ message: 'Sesión terminada. Token ya utilizado o revocado.' });
    }

    // ⏳ Ventana de gracia de 30 minutos para renovar tokens que ya expiraron
    const nowSecs = Math.floor(Date.now() / 1000);
    if (decoded.exp && (nowSecs - decoded.exp > 30 * 60)) {
      return res.status(401).json({ message: 'Sesión expirada permanentemente. Por favor inicie sesión de nuevo.' });
    }

    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Usuario no válido o inactivo' });
    }

    if (user.role === 'guest') {
      return res.status(403).json({ message: 'Los invitados no pueden renovar su sesión' });
    }

    // 🔄 Rotación de tokens: Invalidar el token anterior agregándolo a la denylist
    const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : new Date();
    const denylistExpiresAt = expiresAt > new Date() ? expiresAt : new Date(Date.now() + 5 * 60 * 1000);
    
    await TokenDenylist.create({
      token,
      expiresAt: denylistExpiresAt
    }).catch(err => {
      if (err.code !== 11000) {
        logger.error({ err }, 'Error registrando token revocado en denylist durante refresh');
      }
    });

    const newToken = generateToken(user._id, user.role);
    setAuthCookie(req, res, newToken);

    res.json({ token: newToken });
  } catch (error) {
    res.status(401).json({ message: 'Token inválido' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const cookieToken = getTokenFromCookie(req);
    const token = headerToken || cookieToken;

    if (token) {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        await TokenDenylist.create({
          token,
          expiresAt: new Date(decoded.exp * 1000)
        }).catch(err => {
          if (err.code !== 11000) {
            logger.error({ err }, 'Error guardando token en denylist');
          }
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error procesando token en logout');
  }

  res.clearCookie('auth_token', getAuthCookieOptions(req));
  return res.json({ message: 'Sesión cerrada' });
});

// POST /api/auth/forgot-password - Solicitar reseteo de contraseña
router.post('/forgot-password',
  forgotPasswordLimiter,
  [
    body('email').isEmail().withMessage('Email inválido').normalizeEmail()
  ],
  validate,
  async (req, res) => {
    try {
      const { email } = req.body;

      const user = await User.findOne({ email, isActive: true });

      // Por seguridad, siempre retornamos éxito (no revelar si el email existe)
      if (!user) {
        return res.json({ message: 'Si el email existe, recibirás instrucciones para resetear tu contraseña' });
      }

      // Generar token de reseteo (6 caracteres aleatorios)
      const crypto = require('crypto');
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // Guardar token hasheado + expiración (5 minutos por seguridad - C5)
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos
      await user.save();

      const resetUrl = buildFrontendResetUrl(req, resetToken);

      // Intentar enviar email utilizando el servicio común sendEmail (QA-CODE-SMTP-001)
      const { appTitle } = await getBrandingSnapshot();
      const systemName = getAppTitleForText(appTitle, 'el sistema');
      const teamName = appTitle ? `Equipo ${appTitle}` : 'Equipo de soporte';
      const subject = appTitle ? `Recuperación de Contraseña - ${appTitle}` : 'Recuperación de Contraseña';
      const text = `Hola,\n\nHemos recibido una solicitud para resetear tu contraseña en ${systemName}.\n\nHaz click en el siguiente enlace para crear una nueva contraseña:\n${resetUrl}\n\nEste enlace expirará en 5 minutos.\n\nSi no solicitaste este cambio, ignora este email.\n\nSaludos,\n${teamName}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">Recuperación de Contraseña</h2>
          <p>Hola,</p>
          <p>Hemos recibido una solicitud para resetear tu contraseña en ${systemName}.</p>
          <p>Haz click en el siguiente botón para crear una nueva contraseña:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #1976d2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Resetear Contraseña
            </a>
          </div>
          <p><small>O copia y pega este enlace en tu navegador:<br>${resetUrl}</small></p>
          <p style="color: #f44336;"><strong>⏰ Este enlace expirará en 5 minutos.</strong></p>
          <p>Si no solicitaste este cambio, ignora este email.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Saludos,<br>${teamName}</p>
        </div>
      `;

      let emailSent = false;
      try {
        await sendEmail({
          to: email,
          subject,
          text,
          html,
          auditContext: {
            sourceModule: 'auth',
            triggerType: 'forgot-password'
          }
        });
        emailSent = true;
      } catch (emailError) {
        logger.error({ err: emailError }, 'Error al enviar email de recuperación con sendEmail centralizado');
      }

      // Si está en desarrollo Y el email no se envió, solo hacemos log
      if (process.env.NODE_ENV === 'development' && !emailSent) {
        logger.warn({ requestId: req.requestId }, '[DEV ONLY] Reset link generado pero no enviado (SMTP sin configurar)');
        return res.json({
          message: 'Si el email existe, recibirás instrucciones para resetear tu contraseña'
        });
      }

      // Si se envió el email o estamos en producción
      res.json({
        message: emailSent
          ? 'Email de recuperación enviado. Revisa tu bandeja de entrada.'
          : 'Si el email existe, recibirás instrucciones para resetear tu contraseña'
      });
    } catch (error) {
      logger.error({ err: error }, 'Error in forgot-password');
      res.status(500).json({ message: 'Error al procesar solicitud' });
    }
  }
);

// POST /api/auth/reset-password - Resetear contraseña con token
router.post('/reset-password',
  resetPasswordLimiter,
  [
    body('token').notEmpty().withMessage('Token requerido'),
    body('newPassword').isLength({ min: 6 }).withMessage('Contraseña debe tener al menos 6 caracteres')
  ],
  validate,
  async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      // Hashear el token recibido para comparar con el almacenado
      const crypto = require('crypto');
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Buscar usuario con token válido y no expirado
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
        isActive: true
      });

      if (!user) {
        return res.status(400).json({ message: 'Token inválido o expirado' });
      }

      // Actualizar contraseña (el pre-save hook se encarga de hashearla)
      user.password = newPassword;
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();

      // Auditar el reseteo
      await audit(req, {
        event: 'auth.password_reset',
        level: 'info',
        result: { success: true },
        metadata: {
          userId: user._id,
          username: user.username,
          email: user.email
        }
      });

      res.json({ message: 'Contraseña actualizada exitosamente' });
    } catch (error) {
      logger.error({ err: error }, 'Error in reset-password');
      res.status(500).json({ message: 'Error al resetear contraseña' });
    }
  }
);

// Middleware auxiliar para validar setup/verify de MFA (desde perfil o login con token temporal)
const mfaSetupVerifyAuth = async (req, res, next) => {
  try {
    // 1. Intentar con usuario ya autenticado (desde el perfil)
    const cookieToken = getTokenFromCookie(req);
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const token = headerToken || cookieToken;

    if (token) {
      const isDenylisted = await TokenDenylist.exists({ token });
      if (!isDenylisted) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const user = await User.findById(decoded.userId);
          if (user && user.isActive) {
            req.user = user;
            return next();
          }
        } catch (e) {
          // Token inválido o expirado, continuar al paso 2
        }
      }
    }

    // 2. Intentar con token temporal de MFA (desde el login)
    const mfaToken = req.body.mfaToken || req.headers['x-mfa-token'];
    if (mfaToken) {
      const decoded = jwt.verify(mfaToken, process.env.JWT_SECRET);
      if (decoded.isMfaPending) {
        const user = await User.findById(decoded.userId);
        if (user && user.isActive) {
          req.user = user;
          req.isMfaPending = true;
          return next();
        }
      }
    }

    return res.status(401).json({ message: 'No autorizado para configurar MFA' });
  } catch (error) {
    return res.status(401).json({ message: 'Sesión expirada o token de MFA inválido' });
  }
};

// POST /api/auth/mfa/setup - Obtener código QR y secreto para enrolamiento
router.post('/mfa/setup', mfaSetupVerifyAuth, async (req, res) => {
  try {
    const user = req.user;

    if (user.mfaEnabled && user.mfaSecret && req.isMfaPending) {
      return res.status(400).json({ message: 'MFA ya configurado y activo' });
    }

    const secret = generateSecret();
    user.mfaTempSecret = secret;
    await user.save();

    const appTitle = 'BitacoraSOC';
    const label = `${appTitle}:${user.username}`;
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(appTitle)}`;

    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    res.json({
      secret,
      qrCode: qrCodeDataUrl
    });
  } catch (error) {
    logger.error('Error en MFA setup:', error);
    res.status(500).json({ message: 'Error al iniciar configuración de MFA' });
  }
});

// POST /api/auth/mfa/verify - Validar token inicial para activar MFA
router.post('/mfa/verify', mfaSetupVerifyAuth, async (req, res) => {
  try {
    const { code } = req.body;
    const user = req.user;

    if (!user.mfaTempSecret) {
      return res.status(400).json({ message: 'No hay configuración de MFA en curso' });
    }

    const isValid = verifyTOTP(code, user.mfaTempSecret);
    if (!isValid) {
      return res.status(400).json({ message: 'Código de verificación incorrecto o expirado' });
    }

    user.mfaSecret = user.mfaTempSecret;
    user.mfaEnabled = true;
    user.mfaTempSecret = null;
    await user.save();

    await audit(req, {
      event: 'auth.mfa.enabled',
      level: 'info',
      actor: {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      result: { success: true, reason: 'MFA enabled successfully' },
      metadata: { userId: user._id }
    }).catch(err => logger.error({ err }, 'Audit error'));

    let sessionResponse = { success: true, mfaEnabled: true };
    if (req.isMfaPending) {
      const token = generateToken(user._id, user.role);
      setAuthCookie(req, res, token);
      sessionResponse.token = token;
      sessionResponse.user = {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        cargoLabel: user.cargoLabel,
        role: user.role,
        theme: user.theme,
        avatar: user.avatar,
        guestExpiresAt: user.guestExpiresAt
      };
    }

    res.json(sessionResponse);
  } catch (error) {
    logger.error('Error en MFA verify:', error);
    res.status(500).json({ message: 'Error al verificar código de MFA' });
  }
});

// POST /api/auth/mfa/disable - Desactivar MFA propio (requiere contraseña)
router.post('/mfa/disable', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    const user = req.user;

    if (!password) {
      return res.status(400).json({ message: 'Contraseña requerida para desactivar MFA' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Contraseña incorrecta' });
    }

    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaTempSecret = null;
    await user.save();

    await audit(req, {
      event: 'auth.mfa.disabled',
      level: 'warn',
      actor: {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      result: { success: true, reason: 'MFA disabled by user' },
      metadata: { userId: user._id }
    }).catch(err => logger.error({ err }, 'Audit error'));

    res.json({ success: true, message: 'MFA desactivado correctamente' });
  } catch (error) {
    logger.error('Error en MFA disable:', error);
    res.status(500).json({ message: 'Error al desactivar MFA' });
  }
});

// POST /api/auth/mfa/authenticate - Validar token MFA para login final
router.post('/mfa/authenticate', async (req, res) => {
  try {
    const { code, mfaToken } = req.body;
    if (!code || !mfaToken) {
      return res.status(400).json({ message: 'Código y token de autenticación requeridos' });
    }

    const decoded = jwt.verify(mfaToken, process.env.JWT_SECRET);
    if (!decoded.isMfaPending) {
      return res.status(401).json({ message: 'Token de MFA inválido' });
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Usuario no encontrado o inactivo' });
    }

    if (!user.mfaEnabled || !user.mfaSecret) {
      return res.status(400).json({ message: 'MFA no está habilitado para este usuario' });
    }

    const isValid = verifyTOTP(code, user.mfaSecret);
    if (!isValid) {
      return res.status(401).json({ message: 'Código TOTP incorrecto o expirado' });
    }

    const token = generateToken(user._id, user.role);
    setAuthCookie(req, res, token);

    await audit(req, {
      event: 'auth.login.success',
      level: 'info',
      actor: {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      result: { success: true, reason: 'Login successful via MFA' },
      metadata: {
        userId: user._id,
        username: user.username,
        role: user.role,
        mfaVerified: true
      }
    }).catch(err => logger.error({ err }, 'Audit error'));

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        cargoLabel: user.cargoLabel,
        role: user.role,
        theme: user.theme,
        avatar: user.avatar,
        guestExpiresAt: user.guestExpiresAt
      }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'El tiempo límite de MFA ha expirado. Vuelve a iniciar sesión.' });
    }
    logger.error('Error en MFA authenticate:', error);
    res.status(401).json({ message: 'Token de MFA inválido o expirado' });
  }
});

// POST /api/auth/sso/google - Autenticación con Google SSO
router.post('/sso/google', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Token de Google requerido' });
    }

    // Obtener la configuración global para verificar que Google SSO está activo
    const config = await AppConfig.findOne().select('googleSsoEnabled googleClientId');
    if (!config || !config.googleSsoEnabled) {
      return res.status(400).json({ message: 'Google SSO no está habilitado en el sistema' });
    }

    // Validar el ID Token con el endpoint de Google
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
    const response = await fetch(verifyUrl);
    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ errorText }, 'Error al validar ID Token de Google');
      return res.status(401).json({ message: 'Token de Google inválido' });
    }

    const tokenInfo = await response.json();
    
    // Validar el client_id y que el correo esté verificado
    if (tokenInfo.aud !== config.googleClientId) {
      logger.warn({ aud: tokenInfo.aud, expected: config.googleClientId }, 'El Client ID de Google no coincide');
      return res.status(401).json({ message: 'Audience del token incorrecto' });
    }

    const emailVerified = tokenInfo.email_verified === 'true' || tokenInfo.email_verified === true;
    if (!emailVerified || !tokenInfo.email) {
      return res.status(401).json({ message: 'El correo electrónico de Google no está verificado' });
    }

    const userEmail = tokenInfo.email.toLowerCase();
    const user = await User.findOne({ email: userEmail, isActive: true });

    if (!user) {
      await audit(req, {
        event: 'auth.sso_login.fail',
        level: 'warn',
        result: { success: false, reason: 'Usuario de Google SSO no encontrado en el sistema' },
        metadata: { email: userEmail, provider: 'google' }
      });
      return res.status(401).json({ message: 'Usuario no registrado en BitacoraSOC' });
    }

    // Generar sesión JWT
    const sessionToken = generateToken(user._id, user.role);
    setAuthCookie(req, res, sessionToken);

    await audit(req, {
      event: 'auth.login.success',
      level: 'info',
      actor: {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      result: { success: true, reason: 'Login successful via Google SSO' },
      metadata: { userId: user._id, sso: 'google' }
    });

    return res.json({
      token: sessionToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        cargoLabel: user.cargoLabel,
        role: user.role,
        theme: user.theme,
        avatar: user.avatar,
        guestExpiresAt: user.guestExpiresAt
      }
    });
  } catch (error) {
    logger.error('Error en Google SSO login:', error);
    return res.status(500).json({ message: 'Error interno en Google SSO' });
  }
});

// POST /api/auth/sso/microsoft - Autenticación con Microsoft SSO
router.post('/sso/microsoft', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Access Token de Microsoft requerido' });
    }

    // Obtener la configuración global para verificar que Microsoft SSO está activo
    const config = await AppConfig.findOne().select('microsoftSsoEnabled');
    if (!config || !config.microsoftSsoEnabled) {
      return res.status(400).json({ message: 'Microsoft SSO no está habilitado en el sistema' });
    }

    // Consultar el perfil del usuario mediante Microsoft Graph API
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ errorText }, 'Error al validar Access Token con Microsoft Graph');
      return res.status(401).json({ message: 'Token de Microsoft inválido' });
    }

    const profile = await response.json();
    const microsoftEmail = (profile.mail || profile.userPrincipalName || '').toLowerCase();

    if (!microsoftEmail) {
      return res.status(401).json({ message: 'No se pudo resolver el correo desde Microsoft Graph' });
    }

    const user = await User.findOne({ email: microsoftEmail, isActive: true });

    if (!user) {
      await audit(req, {
        event: 'auth.sso_login.fail',
        level: 'warn',
        result: { success: false, reason: 'Usuario de Microsoft SSO no encontrado en el sistema' },
        metadata: { email: microsoftEmail, provider: 'microsoft' }
      });
      return res.status(401).json({ message: 'Usuario no registrado en BitacoraSOC' });
    }

    // Generar sesión JWT
    const sessionToken = generateToken(user._id, user.role);
    setAuthCookie(req, res, sessionToken);

    await audit(req, {
      event: 'auth.login.success',
      level: 'info',
      actor: {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      result: { success: true, reason: 'Login successful via Microsoft SSO' },
      metadata: { userId: user._id, sso: 'microsoft' }
    });

    return res.json({
      token: sessionToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        cargoLabel: user.cargoLabel,
        role: user.role,
        theme: user.theme,
        avatar: user.avatar,
        guestExpiresAt: user.guestExpiresAt
      }
    });
  } catch (error) {
    logger.error('Error en Microsoft SSO login:', error);
    return res.status(500).json({ message: 'Error interno en Microsoft SSO' });
  }
});

module.exports = router;
