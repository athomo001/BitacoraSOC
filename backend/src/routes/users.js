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

const MAX_CARGO_LENGTH = 120;

const normalizeCargoLabel = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
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
    body('password').isLength({ min: 6 }).withMessage('La contrasena debe tener al menos 6 caracteres'),
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

      const existingUser = await User.findOne({ $or: [{ username }, { email }] });
      if (existingUser) {
        return res.status(400).json({ message: 'El usuario o email ya existe' });
      }

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

      const user = new User({
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

      await audit(req, {
        event: 'admin.users.create',
        level: 'info',
        result: { success: true },
        metadata: {
          targetUserId: user._id,
          targetUsername: user.username,
          targetRole: user.role,
          cargoLabel: user.cargoLabel,
          isGuest: user.role === 'guest',
          guestExpiresAt: user.guestExpiresAt
        }
      });

      res.status(201).json({
        message: 'Usuario creado exitosamente',
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
      .withMessage(`Cargo inválido (máx ${MAX_CARGO_LENGTH} caracteres)`)
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

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
      const user = await User.findByIdAndUpdate(id, updates, { new: true }).select('-password');

      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

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
            theme: user.theme
          }
        }
      });

      res.json({ message: 'Usuario actualizado', user });
    } catch (error) {
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
