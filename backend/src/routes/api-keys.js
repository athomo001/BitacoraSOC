/**
 * File Purpose: backend/src/routes/api-keys.js
 * Responsibilities: CRUD de administración de API Keys y visualización de logs de auditoría.
 * QA Notes: Restringido únicamente a administradores del SOC. Registra eventos en el log de auditoría del sistema.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const ApiLog = require('../models/ApiLog');
const { authenticate, authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');

// Proteger todas las rutas de administración con autenticación normal del SOC y rol admin
router.use(authenticate, authorize('admin'));

/**
 * GET /api/api-keys
 * Retorna la lista de todas las API Keys (excluyendo el hash de la clave por seguridad)
 */
router.get('/', async (req, res) => {
  try {
    const keys = await ApiKey.find({}, '-key')
      .populate('createdBy', 'username fullName')
      .sort({ createdAt: -1 });
    res.json(keys);
  } catch (error) {
    console.error('[ApiKeys/list] Error:', error);
    res.status(500).json({ message: 'Error al listar las claves de API', detail: error.message });
  }
});

/**
 * POST /api/api-keys
 * Crea una nueva clave de API. Devuelve la clave en texto plano UNA SOLA VEZ.
 */
router.post('/', async (req, res) => {
  const { name, permissions, expiresAt } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'El nombre es requerido' });
  }

  if (!Array.isArray(permissions) || permissions.length === 0) {
    return res.status(400).json({ message: 'Debe especificar al menos un permiso' });
  }

  // Validar permisos soportados para evitar inyecciones de permisos no válidos
  const validPermissions = ['users:read', 'events:read', 'events:write', 'escalations:read', 'templates:render'];
  const hasInvalidPermission = permissions.some(p => !validPermissions.includes(p));
  if (hasInvalidPermission) {
    return res.status(400).json({ 
      message: 'Uno o más permisos especificados no son válidos.',
      permisosValidos: validPermissions 
    });
  }

  try {
    // Generar clave segura aleatoria de 32 bytes
    const rawBytes = crypto.randomBytes(32).toString('hex');
    // Formato de token: bsoc_key_ + 8 caracteres de prefijo + 64 caracteres de entropía
    const rawKey = `bsoc_key_${rawBytes.slice(0, 8)}${rawBytes}`;
    
    // El prefijo son los primeros 12 caracteres (ej: bsoc_key_a1b2)
    const prefix = rawKey.slice(0, 12);
    
    // Hash SHA-256 para guardar en base de datos
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    const newKey = new ApiKey({
      name: name.trim(),
      key: hashedKey,
      prefix,
      permissions,
      createdBy: req.user._id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      status: 'active'
    });

    await newKey.save();

    // Auditar la creación en el log de auditoría del sistema
    await audit(req, {
      event: 'api_key.create',
      level: 'info',
      result: { success: true, reason: 'Creación exitosa de clave de API' },
      metadata: {
        keyId: newKey._id,
        name: newKey.name,
        permissions: newKey.permissions,
        expiresAt: newKey.expiresAt
      }
    }).catch(err => console.error('[ApiKeys/create] Error de auditoría del sistema:', err.message));

    // Retornar la clave en texto plano
    res.status(201).json({
      message: 'Clave de API generada con éxito. Asegúrese de copiarla ahora, ya que no se volverá a mostrar.',
      apiKey: rawKey,
      data: {
        _id: newKey._id,
        name: newKey.name,
        prefix: newKey.prefix,
        permissions: newKey.permissions,
        status: newKey.status,
        expiresAt: newKey.expiresAt,
        createdAt: newKey.createdAt
      }
    });
  } catch (error) {
    console.error('[ApiKeys/create] Error:', error);
    res.status(500).json({ message: 'Error al generar la clave de API', detail: error.message });
  }
});

/**
 * PUT /api/api-keys/:id/revoke
 * Cambia inmediatamente el estado de una API Key a 'revoked'
 */
router.put('/:id/revoke', async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.id);
    if (!apiKey) {
      return res.status(404).json({ message: 'Clave de API no encontrada' });
    }

    if (apiKey.status === 'revoked') {
      return res.status(400).json({ message: 'La clave de API ya está revocada' });
    }

    apiKey.status = 'revoked';
    await apiKey.save();

    // Auditar la revocación
    await audit(req, {
      event: 'api_key.revoke',
      level: 'warn',
      result: { success: true, reason: 'Revocación exitosa de clave de API' },
      metadata: {
        keyId: apiKey._id,
        name: apiKey.name,
        prefix: apiKey.prefix
      }
    }).catch(err => console.error('[ApiKeys/revoke] Error de auditoría:', err.message));

    res.json({
      success: true,
      message: 'Clave de API revocada correctamente',
      data: {
        _id: apiKey._id,
        status: apiKey.status
      }
    });
  } catch (error) {
    console.error('[ApiKeys/revoke] Error:', error);
    res.status(500).json({ message: 'Error al revocar la clave de API', detail: error.message });
  }
});

/**
 * GET /api/api-keys/logs
 * Retorna los logs de auditoría de la API externa
 */
router.get('/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      ApiLog.find({})
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ApiLog.countDocuments({})
    ]);

    res.json({
      logs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[ApiKeys/logs] Error:', error);
    res.status(500).json({ message: 'Error al consultar logs de auditoría de la API', detail: error.message });
  }
});

module.exports = router;
