const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, query } = require('express-validator');
const Entry = require('../models/Entry');
const CatalogLogSource = require('../models/CatalogLogSource');
const AppConfig = require('../models/AppConfig');
const { authenticate, notGuest } = require('../middleware/auth');
const validate = require('../middleware/validate');
const captureMetadata = require('../middleware/metadata');
const { audit } = require('../utils/audit');
const { dispatchGlpiPayload } = require('../utils/glpi-dispatch');
const { logger } = require('../utils/logger');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper: extraer hashtags (con protección ReDoS)
const extractHashtags = (text) => {
  if (!text || text.length > 100000) return []; // Límite de seguridad

  const regex = /#(\w+)/g;
  const tags = [];
  let match;
  let iterations = 0;
  const MAX_ITERATIONS = 500; // Prevenir ReDoS

  while ((match = regex.exec(text)) !== null && iterations++ < MAX_ITERATIONS) {
    if (match[1].length <= 50) { // Tags max 50 chars
      tags.push(match[1].toLowerCase());
    }
  }

  return [...new Set(tags)].slice(0, 100); // Max 100 tags únicos
};

// POST /api/entries - Crear entrada
router.post('/',
  authenticate,
  notGuest,
  captureMetadata,
  [
    body('content').trim().notEmpty().withMessage('El contenido es requerido'),
    body('entryType').isIn(['operativa', 'incidente', 'ofensa']).withMessage('Tipo de entrada inválido'),
    body('entryDate').isISO8601().withMessage('Fecha inválida'),
    body('entryTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Hora inválida (formato HH:mm)'),
    body('clientId').optional({ checkFalsy: true }).isMongoId().withMessage('ClientId inválido')
  ],
  validate,
  async (req, res) => {
    try {
      const { content, entryType, entryDate, entryTime, clientId } = req.body;

      // 🕒 Forzar timezone Chile (America/Santiago)
      const entryDateObj = new Date(entryDate);
      // Validar que no sea fecha futura (más de 1 día adelante)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (entryDateObj > tomorrow) {
        return res.status(400).json({ message: 'No se permite registrar entradas con fechas futuras' });
      }

      // Extraer tags del contenido
      const tags = extractHashtags(content);

      // Si no hay clientId, usar LogSource por defecto de configuración
      let finalClientId = clientId;
      let clientName = null;

      if (!clientId) {
        // Obtener configuración de la app
        const appConfig = await AppConfig.findOne();

        if (appConfig && appConfig.defaultLogSourceId) {
          // Usar LogSource configurado como predeterminado
          const defaultSource = await CatalogLogSource.findById(appConfig.defaultLogSourceId)
            .select('_id name enabled');

          if (defaultSource && defaultSource.enabled) {
            finalClientId = defaultSource._id;
            clientName = defaultSource.name;
          }
        }
        // Si no hay LogSource configurado, el entry se crea sin cliente (null)
      } else {
        // Si se proporciona clientId, obtener su nombre
        const logSource = await CatalogLogSource.findById(clientId).select('name enabled');
        if (logSource && logSource.enabled !== false) {
          clientName = logSource.name;
        } else if (logSource) {
          // Si el cliente existe pero no está habilitado, aún guarda el nombre
          clientName = logSource.name;
        }
      }

      const entry = new Entry({
        content,
        entryType,
        entryDate,
        entryTime,
        tags,
        clientId: finalClientId || null,
        clientName: clientName,
        createdBy: req.user._id,
        createdByUsername: req.user.username,
        isGuestEntry: req.user.role === 'guest',
        ipAddress: req.clientIp,
        userAgent: req.clientUserAgent
      });

      await entry.save();

      // Auditar creación de entrada
      await audit(req, {
        event: 'entry.create',
        level: 'info',
        result: { success: true },
        metadata: {
          entryId: entry._id,
          entryType,
          entryDate,
          tagCount: tags.length,
          isGuest: req.user.role === 'guest'
        }
      });

      if (entryType === 'incidente' || entryType === 'ofensa') {
        const ticketTitle = `[SOC][${entryType.toUpperCase()}] ${clientName || 'Sin cliente'} ${entryTime}`;
        const ticketText = [
          `Tipo: ${entryType}`,
          `Fecha: ${entryDate}`,
          `Hora: ${entryTime}`,
          `Usuario: ${req.user.username}`,
          `Cliente/Origen: ${clientName || 'Sin cliente'}`,
          `Tags: ${tags.length ? tags.join(', ') : 'sin tags'}`,
          '',
          content
        ].join('\n');

        dispatchGlpiPayload({
          expectedDispatchMode: 'immediate',
          title: ticketTitle,
          subject: ticketTitle,
          text: ticketText,
          sourceEvent: 'entry.create.immediate',
          context: {
            entryId: entry._id.toString(),
            entryType,
            clientName: clientName || null,
            createdBy: req.user.username
          }
        }).catch((error) => {
          logger.error({ err: error, entryId: entry._id, requestId: req.requestId }, 'Error dispatching GLPI immediate ticket');
        });
      }

      res.status(201).json({
        message: 'Entrada creada exitosamente',
        entry
      });
    } catch (error) {
      logger.error({
        err: error,
        requestId: req.requestId,
        userId: req.user._id
      }, 'Error creating entry');

      res.status(500).json({ message: 'Error al crear entrada' });
    }
  }
);

// GET /api/entries - Listar entradas con filtros y paginación
router.get('/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().trim(),
    query('tags').optional(),
    query('clientId').optional().isMongoId(),
    query('entryType').optional().isIn(['operativa', 'incidente', 'ofensa']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('userId').optional().isMongoId()
  ],
  validate,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        tags,
        clientId,
        entryType,
        startDate,
        endDate,
        userId
      } = req.query;

      const skip = (page - 1) * limit;

      // Construir filtros
      const filters = {};

      // Búsqueda de texto (sanitizada)
      if (search) {
        // Escapar caracteres especiales de MongoDB
        const sanitized = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filters.$text = { $search: sanitized };
      }

      // Filtro por tags
      if (tags) {
        const tagArray = tags.split(',').map(t => t.trim().toLowerCase());
        filters.tags = { $in: tagArray };
      }

      // Filtro por cliente (B2i)
      if (clientId) {
        filters.clientId = clientId;
      }

      // Filtro por tipo
      if (entryType) {
        filters.entryType = entryType;
      }

      // Filtro por rango de fechas
      if (startDate || endDate) {
        filters.entryDate = {};
        if (startDate) filters.entryDate.$gte = new Date(startDate);
        if (endDate) filters.entryDate.$lte = new Date(endDate);
      }

      // Filtro por usuario (sanitizar para prevenir NoSQL injection)
      if (userId) {
        // 🔒 Bloquear operadores $ en IDs (ej: {"$ne": null})
        if (typeof userId === 'string' && !userId.includes('$')) {
          filters.createdBy = userId;
        } else {
          return res.status(400).json({ message: 'userId inválido' });
        }
      }

      // Ejecutar consulta
      const [entries, total] = await Promise.all([
        Entry.find(filters)
          .sort({ entryDate: -1, entryTime: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('createdBy', 'username fullName role')
          .lean(),
        Entry.countDocuments(filters)
      ]);

      res.json({
        entries,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error al listar entradas:', error);
      res.status(500).json({ message: 'Error al obtener entradas' });
    }
  }
);

// GET /api/entries/:id - Obtener entrada por ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const entry = await Entry.findById(req.params.id)
      .populate('createdBy', 'username fullName role');

    if (!entry) {
      return res.status(404).json({ message: 'Entrada no encontrada' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Error al obtener entrada:', error);
    res.status(500).json({ message: 'Error al obtener entrada' });
  }
});

// PUT /api/entries/:id - Actualizar entrada
router.put('/:id',
  authenticate,
  notGuest,
  [
    body('content').optional().trim().notEmpty(),
    body('entryType').optional().isIn(['operativa', 'incidente', 'ofensa']),
    body('entryDate').optional().isISO8601(),
    body('entryTime').optional().matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body('clientId').optional({ checkFalsy: true }).isMongoId()
  ],
  validate,
  async (req, res) => {
    try {
      const entry = await Entry.findById(req.params.id);

      if (!entry) {
        return res.status(404).json({ message: 'Entrada no encontrada' });
      }

      // Solo el creador o admin puede editar
      if (entry.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'No tienes permiso para editar esta entrada' });
      }

      const { content, entryType, entryDate, entryTime, clientId } = req.body;

      if (content) {
        entry.content = content;
        entry.tags = extractHashtags(content);
      }
      if (entryType) entry.entryType = entryType;
      if (entryDate) entry.entryDate = entryDate;
      if (entryTime) entry.entryTime = entryTime;

      // Manejar cambio de clientId
      if (clientId !== undefined) {
        if (clientId === null) {
          // Si es null, usar LogSource por defecto de configuración
          const appConfig = await AppConfig.findOne();

          if (appConfig && appConfig.defaultLogSourceId) {
            const defaultSource = await CatalogLogSource.findById(appConfig.defaultLogSourceId);
            if (defaultSource && defaultSource.enabled) {
              entry.clientId = defaultSource._id;
              entry.clientName = defaultSource.name;
            } else {
              entry.clientId = null;
              entry.clientName = null;
            }
          } else {
            entry.clientId = null;
            entry.clientName = null;
          }
        } else {
          // Buscar el LogSource especificado
          const logSource = await CatalogLogSource.findById(clientId);
          if (logSource && logSource.enabled) {
            entry.clientId = logSource._id;
            entry.clientName = logSource.name;
          } else {
            return res.status(400).json({ message: 'Log Source no válido o inactivo' });
          }
        }
      }

      await entry.save();

      res.json({ message: 'Entrada actualizada', entry });
    } catch (error) {
      console.error('Error al actualizar entrada:', error);
      res.status(500).json({ message: 'Error al actualizar entrada' });
    }
  }
);

// DELETE /api/entries/:id - Eliminar entrada
router.delete('/:id', authenticate, notGuest, async (req, res) => {
  try {
    const entry = await Entry.findById(req.params.id);

    if (!entry) {
      return res.status(404).json({ message: 'Entrada no encontrada' });
    }

    // Solo el creador o admin puede eliminar
    if (entry.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'No tienes permiso para eliminar esta entrada' });
    }

    await entry.deleteOne();

    res.json({ message: 'Entrada eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar entrada:', error);
    res.status(500).json({ message: 'Error al eliminar entrada' });
  }
});

// GET /api/entries/tags/suggest - Autocompletar tags
router.get('/tags/suggest', authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();

    if (!q || q.length < 2) {
      return res.json([]);
    }

    if (q.length > 64) {
      return res.status(400).json({ message: 'q no puede superar 64 caracteres' });
    }

    const regex = new RegExp(`^${escapeRegex(q)}`, 'i');

    const tags = await Entry.aggregate([
      { $unwind: '$tags' },
      { $match: { tags: regex } },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { tag: '$_id', count: 1, _id: 0 } }
    ]);

    res.json(tags);
  } catch (error) {
    console.error('Error en autocomplete de tags:', error);
    res.status(500).json({ message: 'Error al obtener sugerencias' });
  }
});

// PUT /api/entries/admin/edit - Edición masiva/individual por admin
router.put('/admin/edit',
  authenticate,
  [
    body('entryIds').isArray({ min: 1 }).withMessage('Debe proporcionar al menos un ID de entrada'),
    body('entryIds.*').isMongoId().withMessage('IDs inválidos'),
    body('updates').isObject().withMessage('Actualizaciones requeridas')
  ],
  validate,
  async (req, res) => {
    try {
      // Solo admin puede usar este endpoint
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Solo administradores pueden editar entradas de otros' });
      }

      const { entryIds, updates } = req.body;
      console.log('🔵 [Admin Edit] Received request:', { entryIds, updates });

      // Whitelist de campos editables por admin
      const allowedFields = ['tags', 'clientId', 'clientName', 'entryType'];
      const sanitizedUpdates = {};

      // Procesar campos permitidos (filtrar '__no_change__')
      for (const field of allowedFields) {
        if (updates[field] !== undefined && updates[field] !== '__no_change__') {
          // Validar cada campo según su tipo
          if (field === 'tags' && !Array.isArray(updates[field])) {
            return res.status(400).json({ message: 'tags debe ser un array' });
          }
          if (field === 'clientId' && updates[field] !== null) {
            if (!mongoose.Types.ObjectId.isValid(updates[field])) {
              return res.status(400).json({ message: 'clientId debe ser un ObjectId válido o null' });
            }
          }
          if (field === 'entryType' && !['operativa', 'incidente', 'ofensa'].includes(updates[field])) {
            return res.status(400).json({ message: 'entryType debe ser "operativa", "incidente" o "ofensa"' });
          }

          sanitizedUpdates[field] = updates[field];
        }
      }

      console.log('🟢 [Admin Edit] Sanitized updates:', sanitizedUpdates);

      // Blacklist explícito (protección extra - campos inmutables)
      delete sanitizedUpdates.content;
      delete sanitizedUpdates.timestamp;
      delete sanitizedUpdates.entryDate;
      delete sanitizedUpdates.entryTime;
      delete sanitizedUpdates.createdBy;
      delete sanitizedUpdates.createdByUsername;
      delete sanitizedUpdates.user;
      delete sanitizedUpdates.author;
      delete sanitizedUpdates.createdAt;
      delete sanitizedUpdates.updatedAt;

      // Si se está actualizando clientId, resolver el clientName
      if (sanitizedUpdates.clientId !== undefined) {
        console.log('🟡 [Admin Edit] Resolving clientName for clientId:', sanitizedUpdates.clientId);
        if (sanitizedUpdates.clientId === null) {
          sanitizedUpdates.clientName = null;
        } else {
          const logSource = await CatalogLogSource.findById(sanitizedUpdates.clientId);
          console.log('🟡 [Admin Edit] CatalogLogSource found:', logSource);
          if (!logSource) {
            return res.status(400).json({ message: 'LogSource no encontrado' });
          }
          sanitizedUpdates.clientName = logSource.name;
        }
      }

      // Verificar que las entradas existen
      console.log('🔵 [Admin Edit] Checking entries exist...');
      const entries = await Entry.find({ _id: { $in: entryIds } });
      console.log('🟢 [Admin Edit] Found entries:', entries.length);
      if (entries.length !== entryIds.length) {
        return res.status(404).json({ message: 'Una o más entradas no encontradas' });
      }

      const trackedFields = ['tags', 'clientId', 'clientName', 'entryType'];
      const beforeById = new Map(
        entries.map((entry) => {
          const id = String(entry._id);
          return [
            id,
            {
              tags: entry.tags || [],
              clientId: entry.clientId ? String(entry.clientId) : null,
              clientName: entry.clientName || null,
              entryType: entry.entryType || null
            }
          ];
        })
      );

      // Actualizar entradas
      console.log('🔵 [Admin Edit] Executing updateMany with:', { sanitizedUpdates });
      const result = await Entry.updateMany(
        { _id: { $in: entryIds } },
        { $set: sanitizedUpdates }
      );
      console.log('🟢 [Admin Edit] UpdateMany result:', result);

      const updatedEntries = await Entry.find({ _id: { $in: entryIds } })
        .select('tags clientId clientName entryType')
        .lean();

      const beforeAfter = updatedEntries.map((entry) => {
        const id = String(entry._id);
        const before = beforeById.get(id) || {};
        const after = {
          tags: entry.tags || [],
          clientId: entry.clientId ? String(entry.clientId) : null,
          clientName: entry.clientName || null,
          entryType: entry.entryType || null
        };

        const changedFields = trackedFields.filter((field) => {
          const beforeValue = before[field];
          const afterValue = after[field];
          return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
        });

        return {
          entryId: id,
          changedFields,
          before,
          after
        };
      });

      const changedEntries = beforeAfter.filter((item) => item.changedFields.length > 0);
      const beforeAfterSample = changedEntries.slice(0, 50);

      // Auditar la acción
      console.log('🔵 [Admin Edit] Logging audit event...');
      await audit(req, {
        event: 'entry.admin_bulk_edit',
        level: 'warn',
        result: { success: true },
        metadata: {
          entryCount: entryIds.length,
          entryIds: entryIds.slice(0, 10), // Solo primeros 10 IDs
          updatedFields: Object.keys(sanitizedUpdates),
          adminUsername: req.user.username,
          changedEntriesCount: changedEntries.length,
          beforeAfter: beforeAfterSample,
          beforeAfterTruncated: changedEntries.length > beforeAfterSample.length
        }
      });
      console.log('🟢 [Admin Edit] Audit logged successfully');

      res.json({
        message: `${result.modifiedCount} entrada(s) actualizada(s)`,
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount
      });
    } catch (error) {
      logger.error({
        err: error,
        stack: error.stack,
        requestId: req.requestId,
        userId: req.user._id,
        body: req.body
      }, 'Error in admin bulk edit');

      console.error('❌ [Admin Edit] Error:', error);

      res.status(500).json({
        message: 'Error al editar entradas',
        error: error.message,
        requestId: req.requestId
      });
    }
  }
);

module.exports = router;
