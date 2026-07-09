/**
 * File Purpose: backend/src/middleware/apiKeyAuth.js
 * Responsibilities: Definir los middlewares de autenticación, autorización y auditoría para las API Keys.
 * QA Notes: Implementa validaciones rigurosas y auditoría continua para todos los accesos programáticos.
 */

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const ApiLog = require('../models/ApiLog');

/**
 * Middleware para autenticar llamadas mediante X-API-KEY o Authorization Bearer
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    let rawKey = req.headers['x-api-key'] || req.headers['x-api-token'];
    
    // También verificar en el header Authorization
    const authHeader = req.headers.authorization;
    if (!rawKey && authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        rawKey = authHeader.substring(7);
      } else if (authHeader.startsWith('ApiKey ')) {
        rawKey = authHeader.substring(7);
      }
    }

    if (!rawKey) {
      return res.status(401).json({ message: 'No se proporcionó una clave de API' });
    }

    rawKey = rawKey.trim();

    // Validar el formato esperado: bsoc_key_[hexadecimal_de_32_bytes]
    if (!rawKey.startsWith('bsoc_key_') || rawKey.length < 15) {
      return res.status(401).json({ message: 'Formato de clave de API inválido' });
    }

    // Extraer prefijo rápido (primeros 12 caracteres, ej: bsoc_key_a1b2)
    const prefix = rawKey.slice(0, 12);

    // Buscar la clave activa asociada a este prefijo y popular la info del creador
    const apiKeyDoc = await ApiKey.findOne({ prefix, status: 'active' }).populate('createdBy', 'username fullName');

    if (!apiKeyDoc) {
      return res.status(401).json({ message: 'Clave de API inválida, revocada o inactiva' });
    }

    // Validar el hash SHA-256
    const hashedKeyInput = crypto.createHash('sha256').update(rawKey).digest('hex');
    if (apiKeyDoc.key !== hashedKeyInput) {
      return res.status(401).json({ message: 'Clave de API inválida' });
    }

    // Validar expiración si corresponde
    if (apiKeyDoc.expiresAt && new Date() > apiKeyDoc.expiresAt) {
      apiKeyDoc.status = 'expired';
      await apiKeyDoc.save();
      return res.status(401).json({ message: 'La clave de API ha expirado' });
    }

    // Inyectar en req el documento de la API Key para verificar permisos más tarde
    req.apiKey = apiKeyDoc;

    // Obtener nombre del creador real de la API Key para autoría y auditoría
    const creatorName = apiKeyDoc.createdBy?.fullName || apiKeyDoc.createdBy?.username || `API Key: ${apiKeyDoc.name}`;

    // Crear un usuario virtual compatible con el resto del backend (trazabilidad y RBAC)
    req.user = {
      _id: apiKeyDoc._id,
      username: apiKeyDoc.name,
      fullName: creatorName,
      role: apiKeyDoc.role || 'user',
      isActive: true,
      isApiKey: true,
      isGuestExpired: () => false
    };

    next();
  } catch (error) {
    console.error('[auth/apiKey] Error de autenticación:', error);
    return res.status(500).json({ message: 'Error interno de autenticación de API' });
  }
};

/**
 * Middleware para validar que la API Key cuente con el permiso requerido
 * @param {string} permission - El scope del recurso requerido (ej: 'events:read')
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({ message: 'No autenticado por API Key' });
    }

    if (!req.apiKey.permissions.includes(permission)) {
      return res.status(403).json({ message: `Permiso insuficiente. Se requiere el scope: ${permission}` });
    }

    next();
  };
};

/**
 * Middleware global para auditoría asíncrona de la API pública v1
 */
const apiAuditLogger = (req, res, next) => {
  const ipAddress = req.clientIp || req.headers['x-forwarded-for'] || req.ip || '0.0.0.0';
  const endpoint = req.originalUrl || req.url;
  const method = req.method;

  // Interceptar la finalización de la petición para guardar el log con su respectivo status HTTP
  res.on('finish', async () => {
    try {
      const apiKeyId = req.apiKey ? req.apiKey._id : null;
      const apiKeyName = req.apiKey ? req.apiKey.name : (req.headers['x-api-key'] ? 'Clave Inválida' : 'Sin credenciales');
      const status = res.statusCode;

      let actionDetails = '';
      if (req.apiKey) {
        actionDetails = `Acceso autorizado. Permisos de la clave: ${req.apiKey.permissions.join(', ')}`;
      } else {
        actionDetails = `Intento de acceso rechazado con estado HTTP ${status}`;
      }

      // Registrar el log de auditoría de la API
      await ApiLog.create({
        apiKeyId,
        apiKeyName,
        endpoint,
        method,
        ipAddress,
        status,
        actionDetails
      });

      // Actualizar el campo lastUsedAt de la clave de forma asíncrona
      if (req.apiKey) {
        await ApiKey.updateOne(
          { _id: req.apiKey._id },
          { $set: { lastUsedAt: new Date() } }
        );
      }
    } catch (err) {
      console.error('[apiAuditLogger] Error al escribir el log de auditoría:', err.message);
    }
  });

  next();
};

module.exports = {
  authenticateApiKey,
  requirePermission,
  apiAuditLogger
};
