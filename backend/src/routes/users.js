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
const { syncDirectoryContact } = require('../utils/directory-sync');

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

    // Mapear a formato simple con "name" para compatibilidad
    const usersSimple = users.map(u => ({
      _id: u._id,
      name: u.fullName,
      username: u.username,
      email: u.email,
      role: u.role,
      phone: u.phone,
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
    body('currentPassword').optional().notEmpty(),
    body('newPassword').optional().isLength({ min: 6 })
  ],
  validate,
  async (req, res) => {
    try {
      const { email, fullName, theme, currentPassword, newPassword } = req.body;

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      const before = {
        email: user.email,
        fullName: user.fullName,
        theme: user.theme,
        phone: user.phone
      };

      if (email) user.email = email;
      if (fullName) user.fullName = fullName;
      if (theme) user.theme = theme;

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

// POST /api/users - Crear usuario (solo admin)
router.post('/',
  authenticate,
  authorize('admin'),
  [
    body('username').trim().isLength({ min: 3 }).withMessage('El usuario debe tener al menos 3 caracteres'),
    body('email').isEmail().normalizeEmail().withMessage('Email invalido'),
    body('password').notEmpty().withMessage('La contraseña no puede estar vacía'),  // Admin: sin mínimo de caracteres
    body('fullName').trim().notEmpty().withMessage('El nombre completo es requerido'),
    body('role').isIn(['admin', 'user', 'auditor', 'guest']).withMessage('Rol inválido'),
    body('phone').optional().trim().isLength({ min: 6, max: 20 }).withMessage('Teléfono inválido'),
    body('cargoLabel').optional({ nullable: true }).isString().trim().isLength({ max: MAX_CARGO_LENGTH })
      .withMessage(`Cargo inválido (máx ${MAX_CARGO_LENGTH} caracteres)`)
  ],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, role, phone } = req.body;
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
          guestExpiresAt
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
    body('phone').optional().trim().isLength({ min: 6, max: 20 }),
    body('cargoLabel').optional({ nullable: true }).isString().trim().isLength({ max: MAX_CARGO_LENGTH })
      .withMessage(`Cargo inválido (máx ${MAX_CARGO_LENGTH} caracteres)`),
    body('newPassword').optional().notEmpty().withMessage('La nueva contraseña no puede estar vacía') // Admin: sin mínimo
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
