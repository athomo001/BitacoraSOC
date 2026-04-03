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
const validate = require('../middleware/validate');
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rate-limiter');
const { audit } = require('../utils/audit');
const { buildFrontendResetUrl } = require('../utils/frontend-url');
const { logger } = require('../utils/logger');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
        const easterEgg = await getLoginEasterEggSignal(username, password);
        audit(req, {
          event: 'auth.login.fail',
          level: 'warn',
          result: { success: false, reason: 'Invalid password' },
          metadata: { username }
        }).catch(err => logger.error({ err }, 'Audit error'));

        return res.status(401).json({
          message: 'Credenciales inválidas',
          ...(easterEgg ? { easterEgg } : {})
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Usuario no válido' });
    }

    if (user.role === 'guest' && user.isGuestExpired()) {
      return res.status(401).json({ message: 'Sesión de invitado expirada' });
    }

    const newToken = generateToken(user._id, user.role);
    setAuthCookie(req, res, newToken);

    res.json({ token: newToken });
  } catch (error) {
    res.status(401).json({ message: 'Token inválido' });
  }
});

router.post('/logout', (req, res) => {
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

      // Intentar enviar email si SMTP está configurado
      const SmtpConfig = require('../models/SmtpConfig');
      const nodemailer = require('nodemailer');
      const { decrypt } = require('../utils/encryption');

      let emailSent = false;
      const smtpConfig = await SmtpConfig.findOne({ isActive: true });

      if (smtpConfig) {
        try {
          const secure = smtpConfig.port === 465;
          const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: secure,
            auth: {
              user: smtpConfig.username,
              pass: decrypt(smtpConfig.password)
            }
          });

          await transporter.sendMail({
            from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
            to: email,
            subject: 'Recuperación de Contraseña - Bitácora SOC',
            text: `Hola,\n\nHemos recibido una solicitud para resetear tu contraseña.\n\nHaz click en el siguiente enlace para crear una nueva contraseña:\n${resetUrl}\n\nEste enlace expirará en 5 minutos.\n\nSi no solicitaste este cambio, ignora este email.\n\nSaludos,\nEquipo Bitácora SOC`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1976d2;">Recuperación de Contraseña</h2>
                <p>Hola,</p>
                <p>Hemos recibido una solicitud para resetear tu contraseña.</p>
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
                <p style="color: #666; font-size: 12px;">Saludos,<br>Equipo Bitácora SOC</p>
              </div>
            `
          });

          emailSent = true;
        } catch (emailError) {
          console.error('Error enviando email de recuperación:', emailError);
          // Continuar aunque falle el email
        }
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

module.exports = router;
