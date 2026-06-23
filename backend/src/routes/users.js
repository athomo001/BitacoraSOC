/**
 * File Purpose: backend/src/routes/users.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de Gestion de Usuarios
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const User = require('../models/User');
const AppConfig = require('../models/AppConfig');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { getBrandingSnapshot, getAppTitleForText } = require('../utils/branding');
const { syncDirectoryContact } = require('../utils/directory-sync');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

// Verificación de integridad de imagen mediante sharp
const verifyImageFile = async (filePath, mimetype) => {
  try {
    const metadata = await sharp(filePath).metadata();
    return ['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format);
  } catch (err) {
    return false;
  }
};

// Configuración del storage multer para avatares en uploads/avatars
const avatarStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/avatars');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar-${req.user._id}-${Date.now()}${ext || '.png'}`);
  }
});

// Límite de tamaño de avatar a 2MB
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const mimeType = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimeType && extname) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (jpg, jpeg, png, webp) de hasta 2MB'));
  }
});

const MAX_CARGO_LENGTH = 120;

const normalizeCargoLabel = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
};

const syncUserAsDirectoryInternal = (userDoc) => {
  if (!userDoc) {
    return Promise.resolve();
  }
  const isOperationalRole = ['admin', 'user', 'auditor'].includes(String(userDoc.role || ''));
  if (!isOperationalRole || userDoc.isActive === false) {
    return Promise.resolve();
  }
  return syncDirectoryContact({
    name: userDoc.fullName,
    email: userDoc.email,
    phone: userDoc.phone,
    position: userDoc.cargoLabel || userDoc.role,
    type: 'Internal',
    scope: 'Internal',
    source: 'User'
  }).then(() => undefined);
};

// GET /api/users/list - Listar usuarios básicos (cualquier usuario autenticado)
// Para uso en dropdowns y asignaciones
router.get('/list', authenticate, async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select('_id username email fullName role phone cargoLabel')
      .sort({ fullName: 1 });

    // Restricción de seguridad: invitados y auditores no deben ver datos de contacto sensibles
    const isRestrictedRole = req.user && (req.user.role === 'guest' || req.user.role === 'auditor');

    // Mapear a formato simple con "name" para compatibilidad
    const usersSimple = users.map(u => ({
      _id: u._id,
      name: u.fullName,
      username: u.username,
      email: isRestrictedRole ? undefined : u.email,
      role: u.role,
      phone: isRestrictedRole ? undefined : u.phone,
      cargoLabel: u.cargoLabel || null
    }));

    res.json(usersSimple);
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

// GET /api/users - Listar usuarios (solo admin)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

// GET /api/users/me - Perfil del usuario autenticado
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ message: 'Error al obtener perfil' });
  }
});

// PUT /api/users/me - Actualizar perfil propio (incluye cambio de contrasena)
router.put('/me',
  authenticate,
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('fullName').optional().trim().notEmpty(),
    body('theme').optional().isIn(['light', 'dark', 'sepia', 'pastel', 'cyberpunk']),
    body('phone').optional({ nullable: true }).trim().isLength({ min: 6, max: 20 }).withMessage('Teléfono inválido'),
    body('birthday').optional().isISO8601().toDate().withMessage('Fecha de nacimiento inválida'),
    body('currentPassword').optional().notEmpty(),
    body('newPassword').optional().isLength({ min: 6 })
  ],
  validate,
  async (req, res) => {
    try {
      const { email, fullName, theme, phone, currentPassword, newPassword, birthday } = req.body;

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      const before = {
        email: user.email,
        fullName: user.fullName,
        theme: user.theme,
        phone: user.phone,
        birthday: user.birthday
      };

      if (email) user.email = email;
      if (fullName) user.fullName = fullName;
      if (theme) user.theme = theme;
      if (phone !== undefined) user.phone = phone || null;
      if (birthday !== undefined) user.birthday = birthday || null;

      if (currentPassword || newPassword) {
        if (!currentPassword || !newPassword) {
          return res.status(400).json({ message: 'Debes enviar la contrasena actual y la nueva' });
        }

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
          return res.status(400).json({ message: 'Contrasena actual incorrecta' });
        }

        user.password = newPassword;
      }

      await user.save();
      
      // Sincronizar los cambios con el directorio centralizado
      await syncUserAsDirectoryInternal(user);

      await audit(req, {
        event: 'user.profile.update',
        level: 'info',
        result: { success: true },
        metadata: {
          before,
          after: {
            email: user.email,
            fullName: user.fullName,
            theme: user.theme,
            phone: user.phone,
            birthday: user.birthday,
            passwordChanged: !!newPassword
          }
        }
      });

      res.json({ message: 'Perfil actualizado', user: user.toJSON() });
    } catch (error) {
      console.error('Error al actualizar perfil:', error);
      res.status(500).json({ message: 'Error al actualizar perfil' });
    }
  }
);

// PUT /api/users/me/force-setup - Configuración obligatoria de contraseña y cumpleaños al inicio
router.put('/me/force-setup',
  authenticate,
  [
    body('newPassword').isLength({ min: 6 }).withMessage('La nueva contraseña debe tener al menos 6 caracteres'),
    body('birthday').isISO8601().toDate().withMessage('Fecha de nacimiento inválida')
  ],
  validate,
  async (req, res) => {
    try {
      const { newPassword, birthday } = req.body;
      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      // Guardar nueva contraseña y cumpleaños, y limpiar flag mustChangePassword
      user.password = newPassword;
      user.birthday = birthday;
      user.mustChangePassword = false;

      await user.save();
      await syncUserAsDirectoryInternal(user);

      await audit(req, {
        event: 'user.force_setup.success',
        level: 'info',
        result: { success: true },
        metadata: {
          userId: user._id,
          username: user.username,
          birthdaySet: true,
          passwordChanged: true
        }
      });

      res.json({
        message: 'Contraseña y fecha de nacimiento actualizadas correctamente.',
        user: user.toJSON()
      });
    } catch (error) {
      console.error('Error en force-setup:', error);
      res.status(500).json({ message: 'Error al completar la configuración obligatoria' });
    }
  }
);

// POST /api/users/force-password-change-all - Forzar cambio de contraseña a todos los usuarios (solo admin)
router.post('/force-password-change-all',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const internalUserFilter = {
        _id: { $ne: req.user._id },
        isActive: true,
        role: { $in: ['admin', 'user', 'auditor'] }
      };

      // Obtener destinatarios (usuarios internos con email) antes de ejecutar la actualización masiva.
      const internalUsersToNotify = await User.find({
        ...internalUserFilter,
        email: { $exists: true, $ne: '' }
      })
        .select('_id username fullName email')
        .lean();

      // Forzar cambio de contraseña para usuarios internos activos (excepto el admin actual).
      const result = await User.updateMany(
        internalUserFilter,
        { $set: { mustChangePassword: true } }
      );

      const { appTitle } = await getBrandingSnapshot();
      const systemName = getAppTitleForText(appTitle, 'la plataforma');
      const teamName = appTitle ? `Equipo ${appTitle}` : 'Equipo SOC';
      const subject = appTitle
        ? `[${appTitle}] Cambio obligatorio de contraseña`
        : 'Cambio obligatorio de contraseña';

      let emailedCount = 0;
      let emailErrorCount = 0;

      for (const user of internalUsersToNotify) {
        const recipientName = user.fullName || user.username || 'usuario';
        const text = [
          `Hola ${recipientName},`,
          '',
          `Se ha aplicado una política de seguridad en ${systemName}.`,
          'En tu próximo ingreso deberás cambiar tu contraseña obligatoriamente.',
          '',
          'Si tienes dudas, contacta al administrador del sistema.',
          '',
          `Saludos,`,
          teamName
        ].join('\n');

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #1f2937;">
            <h2 style="margin: 0 0 12px; color: #b91c1c;">Cambio obligatorio de contraseña</h2>
            <p>Hola <strong>${recipientName}</strong>,</p>
            <p>
              Se ha aplicado una política de seguridad en <strong>${systemName}</strong>.
              En tu próximo ingreso deberás cambiar tu contraseña obligatoriamente.
            </p>
            <p>Si tienes dudas, contacta al administrador del sistema.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="font-size: 12px; color: #6b7280; margin: 0;">Mensaje automático de ${teamName}.</p>
          </div>
        `;

        try {
          await sendEmail({
            to: user.email,
            subject,
            text,
            html,
            auditContext: {
              sourceModule: 'users',
              triggerType: 'admin-force-password-reset-all',
              triggerContext: 'internal-users-password-rotation',
              extra: {
                targetUserId: String(user._id),
                targetUsername: user.username
              }
            }
          });
          emailedCount += 1;
        } catch (emailError) {
          emailErrorCount += 1;
          logger.error({ err: emailError, targetUserId: user._id, targetEmail: user.email }, 'Error enviando notificación de cambio obligatorio de contraseña');
        }
      }

      await audit(req, {
        event: 'admin.users.force_reset_all',
        level: 'warn',
        result: { success: true },
        metadata: {
          modifiedCount: result.modifiedCount,
          matchedCount: result.matchedCount,
          notifiedCount: internalUsersToNotify.length,
          emailedCount,
          emailErrorCount
        }
      });

      const emailSummary = emailErrorCount > 0
        ? ` Correos enviados: ${emailedCount}. Fallidos: ${emailErrorCount}.`
        : ` Correos enviados: ${emailedCount}.`;

      res.json({
        message: `Se ha forzado el cambio de contraseña a ${result.modifiedCount} usuarios internos activos.${emailSummary}`
      });
    } catch (error) {
      console.error('Error al forzar cambio de contraseña masivo:', error);
      res.status(500).json({ message: 'Error al forzar cambio de contraseña masivo' });
    }
  }
);

// PUT /api/users/me/avatar - Actualizar avatar propio (cualquier usuario autenticado)
router.put('/me/avatar', authenticate, async (req, res) => {
  uploadAvatar.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Error al procesar archivo' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No se proporcionó archivo de avatar' });
      }

      const isValidImg = await verifyImageFile(req.file.path, req.file.mimetype);
      if (!isValidImg) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ message: 'El archivo no es una imagen válida o está corrompido' });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      const oldAvatar = user.avatar;
      const newAvatarUrl = `/uploads/avatars/${req.file.filename}`;

      user.avatar = newAvatarUrl;
      await user.save();

      // Sincronizar en el directorio centralizado
      await syncUserAsDirectoryInternal(user);

      // Limpiar avatar antiguo si existía
      if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
        const oldPath = path.join(__dirname, '../..', oldAvatar);
        await fs.unlink(oldPath).catch(() => {});
      }

      await audit(req, {
        event: 'user.profile.avatar',
        level: 'info',
        result: { success: true },
        metadata: {
          targetUserId: user._id,
          before: oldAvatar,
          after: newAvatarUrl
        }
      });

      res.json({
        message: 'Avatar actualizado con éxito',
        avatarUrl: newAvatarUrl,
        user: user.toJSON()
      });
    } catch (error) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      console.error('Error al actualizar avatar:', error);
      res.status(500).json({ message: 'Error al actualizar avatar' });
    }
  });
});

// POST /api/users - Crear usuario (solo admin)
router.post('/',
  authenticate,
  authorize('admin'),
  [
    body('username').trim().isLength({ min: 3 }).withMessage('El usuario debe tener al menos 3 caracteres'),
    body('email').isEmail().normalizeEmail().withMessage('Email invalido'),
    // Permite al administrador definir contraseñas de cualquier longitud
    body('password').notEmpty().withMessage('La contraseña es requerida'),
    body('fullName').trim().notEmpty().withMessage('El nombre completo es requerido'),
    body('role').isIn(['admin', 'user', 'auditor', 'guest']).withMessage('Rol inválido'),
    body('phone').optional({ nullable: true }).trim().isLength({ min: 6, max: 20 }).withMessage('Teléfono inválido'),
    body('cargoLabel').optional({ nullable: true }).isString().trim().isLength({ max: MAX_CARGO_LENGTH })
      .withMessage(`Cargo inválido (máx ${MAX_CARGO_LENGTH} caracteres)`),
    body('mfaEnabled').optional().isBoolean().withMessage('MFAEnabled debe ser booleano')
  ],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, role, phone, mfaEnabled } = req.body;
      const cargoLabel = normalizeCargoLabel(req.body?.cargoLabel);

      const matchingUsers = await User.find({ $or: [{ username }, { email }] })
        .select('_id username email isActive role guestExpiresAt');

      const activeMatch = matchingUsers.find((u) => u.isActive);
      if (activeMatch) {
        return res.status(400).json({ message: 'El usuario o email ya existe' });
      }

      // Si el usuario fue desactivado previamente, reutilizamos ese registro.
      // Esto evita bloquear la creación cuando en UI se "eliminó" pero realmente se desactivó.
      let reusableUser = null;
      const usernameMatch = matchingUsers.find((u) => u.username === username);
      const emailMatch = matchingUsers.find((u) => u.email === email);

      if (usernameMatch && emailMatch && String(usernameMatch._id) !== String(emailMatch._id)) {
        return res.status(400).json({
          message: 'Conflicto de cuentas inactivas: el usuario y email pertenecen a cuentas distintas. Revisa usuarios inactivos.'
        });
      }

      reusableUser = usernameMatch || emailMatch || null;

      if (role !== 'guest' && !cargoLabel) {
        return res.status(400).json({ message: 'El cargo es requerido para usuarios operativos' });
      }

      let guestExpiresAt = null;
      if (role === 'guest') {
        const config = await AppConfig.findOne();
        const days = config?.guestMaxDurationDays || 2;
        guestExpiresAt = new Date();
        guestExpiresAt.setDate(guestExpiresAt.getDate() + days);
      }

      let user;
      let auditEvent = 'admin.users.create';

      if (reusableUser) {
        user = await User.findById(reusableUser._id);
        if (!user) {
          return res.status(404).json({ message: 'Usuario reutilizable no encontrado' });
        }

        user.username = username;
        user.email = email;
        user.password = password;
        user.fullName = fullName;
        user.phone = phone || null;
        user.role = role;
        user.cargoLabel = role === 'guest' ? null : cargoLabel;
        user.guestExpiresAt = guestExpiresAt;
        user.isActive = true;
        user.mfaEnabled = mfaEnabled === true;
        user.mustChangePassword = true; // Obligar a cambiar contraseña en la reactivación
        if (mfaEnabled === false) {
          user.mfaSecret = null;
          user.mfaTempSecret = null;
        }
        await user.save();
        await syncUserAsDirectoryInternal(user);
        auditEvent = 'admin.users.reactivate';
      } else {
        user = new User({
          username,
          email,
          password,
          fullName,
          phone,
          role,
          cargoLabel: role === 'guest' ? null : cargoLabel,
          guestExpiresAt,
          mfaEnabled: mfaEnabled === true,
          mustChangePassword: true // Por defecto obligar a cambiar la contraseña en creación
        });

        await user.save();
        await syncUserAsDirectoryInternal(user);
      }

      await audit(req, {
        event: auditEvent,
        level: 'info',
        result: { success: true },
        metadata: {
          targetUserId: user._id,
          targetUsername: user.username,
          targetRole: user.role,
          cargoLabel: user.cargoLabel,
          isGuest: user.role === 'guest',
          guestExpiresAt: user.guestExpiresAt,
          reusedInactiveAccount: !!reusableUser
        }
      });

      res.status(201).json({
        message: reusableUser ? 'Usuario reactivado exitosamente' : 'Usuario creado exitosamente',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          role: user.role,
          cargoLabel: user.cargoLabel,
          guestExpiresAt: user.guestExpiresAt
        }
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(400).json({ message: 'El usuario o email ya existe' });
      }
      logger.error({
        err: error,
        requestId: req.requestId,
        adminId: req.user._id
      }, 'Error creando usuario');

      res.status(500).json({ message: 'Error al crear usuario' });
    }
  }
);

// PUT /api/users/:id - Actualizar usuario (solo admin)
router.put('/:id',
  authenticate,
  authorize('admin'),
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('fullName').optional().trim().notEmpty(),
    body('role').optional().isIn(['admin', 'user', 'auditor', 'guest']),
    body('isActive').optional().isBoolean(),
    body('phone').optional({ nullable: true }).trim().isLength({ min: 6, max: 20 }),
    body('cargoLabel').optional({ nullable: true }).isString().trim().isLength({ max: MAX_CARGO_LENGTH })
      .withMessage(`Cargo inválido (máx ${MAX_CARGO_LENGTH} caracteres)`),
    // Permite al administrador establecer una nueva contraseña de cualquier longitud
    body('newPassword').optional(),
    body('mfaEnabled').optional().isBoolean().withMessage('MFAEnabled debe ser booleano'),
    body('mustChangePassword').optional().isBoolean().withMessage('mustChangePassword debe ser booleano')
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Extraer newPassword antes de limpiar updates
      const newPasswordToSet = (updates.newPassword && String(updates.newPassword).length > 0)
        ? String(updates.newPassword)
        : null;
      delete updates.newPassword;
      delete updates.password;
      delete updates.username;

      if (updates.mfaEnabled === false) {
        updates.mfaSecret = null;
        updates.mfaTempSecret = null;
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'cargoLabel')) {
        updates.cargoLabel = normalizeCargoLabel(updates.cargoLabel);
      }

      const targetRole = updates.role;
      if (targetRole === 'guest') {
        updates.cargoLabel = null;
      }

      const beforeUserForValidation = await User.findById(id).select('role cargoLabel').lean();
      const effectiveRole = targetRole || beforeUserForValidation?.role;
      const effectiveCargoLabel = Object.prototype.hasOwnProperty.call(updates, 'cargoLabel')
        ? updates.cargoLabel
        : beforeUserForValidation?.cargoLabel;

      if (effectiveRole !== 'guest' && !effectiveCargoLabel) {
        return res.status(400).json({ message: 'El cargo es requerido para usuarios operativos' });
      }

      const beforeUser = await User.findById(id).select('-password').lean();

      // Cambio de contraseña por admin: pasa por el pre-save hook de bcrypt
      if (newPasswordToSet) {
        const userToSetPwd = await User.findById(id);
        if (!userToSetPwd) {
          return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        userToSetPwd.password = newPasswordToSet;
        await userToSetPwd.save();
      }

      const user = await User.findByIdAndUpdate(id, updates, { new: true }).select('-password');

      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      await syncUserAsDirectoryInternal(user);

      await audit(req, {
        event: 'admin.users.update',
        level: 'info',
        result: { success: true },
        metadata: {
          targetUserId: user._id,
          targetUsername: user.username,
          before: beforeUser ? {
            email: beforeUser.email,
            fullName: beforeUser.fullName,
            role: beforeUser.role,
            cargoLabel: beforeUser.cargoLabel,
            isActive: beforeUser.isActive,
            phone: beforeUser.phone,
            theme: beforeUser.theme
          } : null,
          after: {
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            cargoLabel: user.cargoLabel,
            isActive: user.isActive,
            phone: user.phone,
            theme: user.theme,
            passwordChanged: !!newPasswordToSet
          }
        }
      });

      res.json({ message: 'Usuario actualizado', user });
    } catch (error) {
      if (error?.name === 'ValidationError') {
        return res.status(400).json({
          message: Object.values(error.errors || {})[0]?.message || 'Datos inválidos al actualizar usuario'
        });
      }

      if (error?.code === 11000) {
        return res.status(400).json({ message: 'El usuario o email ya existe' });
      }

      console.error('Error al actualizar usuario:', error);
      res.status(500).json({ message: 'Error al actualizar usuario' });
    }
  }
);

// DELETE /api/users/:id - Eliminar usuario (solo admin)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user._id.toString()) {
      return res.status(400).json({ message: 'No puedes eliminarte a ti mismo' });
    }

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    await audit(req, {
      event: 'admin.users.delete',
      level: 'warn',
      result: { success: true, reason: 'User deleted by admin' },
      metadata: {
        targetUserId: user._id,
        targetUsername: user.username,
        targetRole: user.role,
        targetEmail: user.email
      }
    });

    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ message: 'Error al eliminar usuario' });
  }
});

module.exports = router;
