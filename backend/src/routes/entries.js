/**
 * File Purpose: backend/src/routes/entries.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, query } = require('express-validator');
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const CatalogLogSource = require('../models/CatalogLogSource');
const AppConfig = require('../models/AppConfig');
const { authenticate, notGuest } = require('../middleware/auth');
const validate = require('../middleware/validate');
const captureMetadata = require('../middleware/metadata');
const { audit } = require('../utils/audit');
const { dispatchGlpiPayload, ensureGlpiConfig, addTicketFollowup } = require('../utils/glpi-dispatch');
const { logger } = require('../utils/logger');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildChecklistSummaryContent = (check) => {
  const services = Array.isArray(check?.services) ? check.services : [];
  const redServices = services.filter((service) => service?.status === 'rojo');
  const kind = check?.type === 'cierre' ? 'Cierre' : 'Inicio';
  const totalServices = services.length;
  const totalProblems = redServices.length;

  if (totalProblems === 0) {
    return `[${kind}] Estado general: OK - Servicios Evaluados ${totalServices} - Servicios con Problemas ${totalProblems}`;
  }

  const detail = redServices
    .map((service) => {
      const title = String(service?.serviceTitle || '').trim() || 'Servicio sin nombre';
      const observation = String(service?.observation || '').trim();
      return observation ? `${title} [${observation}]` : title;
    })
    .join(', ');

  return `[${kind}] Estado general: CON PROBLEMAS ${detail} - Servicios Evaluados ${totalServices} - Servicios con Problemas ${totalProblems}`;
};

const toSantiagoDate = (value) => {
  const d = new Date(value);
  // QA-ENTRIES-DATE-FORMAT-CRASH: Evitar crash por fechas inválidas o corruptas en la base de datos
  if (isNaN(d.getTime())) {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  }
  return d.toLocaleDateString('en-CA', {
    timeZone: 'America/Santiago'
  });
};

const toSantiagoTime = (value) => {
  const d = new Date(value);
  // QA-ENTRIES-DATE-FORMAT-CRASH: Evitar crash por fechas inválidas o corruptas en la base de datos
  if (isNaN(d.getTime())) {
    return '00:00';
  }
  return d.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago'
  });
};

// Texto enviado como ITILFollowup al vincular/reenviar una entrada a un ticket GLPI existente.
const buildGlpiFollowupContent = (entry, username) => {
  const dateLabel = entry.entryDate instanceof Date
    ? entry.entryDate.toISOString().slice(0, 10)
    : String(entry.entryDate || '');

  return [
    `[Bitácora SOC] ${String(entry.entryType || '').toUpperCase()} — ${dateLabel} ${entry.entryTime || ''}`,
    `Analista: ${username || entry.createdByUsername || 'N/A'}`,
    entry.clientName ? `Cliente/Origen: ${entry.clientName}` : null,
    entry.tags?.length ? `Tags: ${entry.tags.join(', ')}` : null,
    '',
    entry.content
  ].filter((line) => line !== null).join('\n');
};

const DEFAULT_INTERNAL_CLIENT_NAME = 'Cliente interno';

const resolveDefaultClientContext = async () => {
  const appConfig = await AppConfig.findOne().select('defaultLogSourceId').lean();

  if (appConfig?.defaultLogSourceId) {
    const defaultSource = await CatalogLogSource.findById(appConfig.defaultLogSourceId)
      .select('_id name enabled isInternal')
      .lean();

    if (defaultSource && defaultSource.enabled !== false) {
      return {
        clientId: String(defaultSource._id),
        clientName: String(defaultSource.name || '').trim() || DEFAULT_INTERNAL_CLIENT_NAME,
        isInternal: defaultSource.isInternal === true
      };
    }
  }

  const internalClient = await CatalogLogSource.findOne({ enabled: true, isInternal: true })
    .select('_id name')
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();

  if (internalClient) {
    return {
      clientId: String(internalClient._id),
      clientName: String(internalClient.name || '').trim() || DEFAULT_INTERNAL_CLIENT_NAME,
      isInternal: true
    };
  }

  return {
    clientId: null,
    clientName: DEFAULT_INTERNAL_CLIENT_NAME,
    isInternal: true
  };
};

const toChecklistEntryLikeRecord = (check, clientContext = {}) => {
  let checkDate = new Date(check.checkDate || check.createdAt || new Date());
  // QA-ENTRIES-DATE-FORMAT-CRASH: Fallback seguro a la fecha actual si la fecha es corrupta o inválida
  if (isNaN(checkDate.getTime())) {
    checkDate = new Date();
  }
  const entryDate = `${toSantiagoDate(checkDate)}T00:00:00.000Z`;
  const entryTime = toSantiagoTime(checkDate);
  return {
    _id: String(check._id),
    content: buildChecklistSummaryContent(check),
    entryType: 'checklist',
    entryDate,
    entryTime,
    tags: [],
    clientId: clientContext.clientId || null,
    clientName: clientContext.clientName || DEFAULT_INTERNAL_CLIENT_NAME,
    createdBy: check.userId || null,
    createdByUsername: check.username || check.userId?.username || 'N/A',
    isGuestEntry: false,
    createdAt: checkDate,
    updatedAt: check.updatedAt || checkDate,
    checklistType: check.type,
    checklistMetrics: {
      totalServices: Array.isArray(check.services) ? check.services.length : 0,
      totalProblems: Array.isArray(check.services)
        ? check.services.filter((service) => service?.status === 'rojo').length
        : 0
    }
  };
};
const TAG_VALIDATION_REGEX = /^[a-z][a-z0-9_-]{0,49}$/i;

// Helper: extraer hashtags (con protección ReDoS)
const extractHashtags = (text) => {
  if (!text || text.length > 100000) return []; // Límite de seguridad

  const regex = /#([a-z][a-z0-9_-]{0,49})/gi;
  const tags = [];
  let match;
  let iterations = 0;
  const MAX_ITERATIONS = 500; // Prevenir ReDoS

  while ((match = regex.exec(text)) !== null && iterations++ < MAX_ITERATIONS) {
    if (TAG_VALIDATION_REGEX.test(match[1])) { // Solo tags semánticos, no IDs numéricos
      tags.push(match[1].toLowerCase());
    }
  }

  return [...new Set(tags)].slice(0, 100); // Max 100 tags únicos
};

/*
 * QA — POST /api/entries (matriz rápida):
 * - Auth: usuario autenticado; `notGuest` impide creación como invitado.
 * - Validación: tipo operativa|incidente|ofensa; fecha ISO; hora HH:mm; clientId opcional MongoId.
 * - Negocio: fecha no > mañana; hashtags desde contenido (límites anti-ReDoS arriba).
 * - Cliente: sin clientId → LogSource por defecto desde AppConfig si existe y está habilitado.
 * - Auditoría: revisar eventos posteriores al save en handler (no duplicar expectativas aquí).
 */

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
    body('clientId').optional({ checkFalsy: true }).isMongoId().withMessage('ClientId inválido'),
    body('glpiTicketId').optional({ checkFalsy: true }).trim().isString()
  ],
  validate,
  async (req, res) => {
    try {
      const { content, entryType, entryDate, entryTime, clientId } = req.body;
      const glpiTicketId = String(req.body.glpiTicketId || '').trim();

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

      // Si no hay clientId, usar cliente interno centralizado (AppConfig o LogSource marcado como interno)
      let finalClientId = clientId;
      let clientName = null;

      if (!clientId) {
        const defaultClientContext = await resolveDefaultClientContext();
        finalClientId = defaultClientContext.clientId || null;
        clientName = defaultClientContext.clientName || DEFAULT_INTERNAL_CLIENT_NAME;
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

      let glpiLinkWarning = null;
      if (glpiTicketId) {
        // El campo manual de ticket GLPI es opcional y depende del toggle de admin
        // (manualLinkFieldEnabled) — se revalida en el servidor por si el front quedó desincronizado.
        // Independiente de config.enabled a propósito (ver ruta /manual-link-field en glpi.js).
        const glpiConfig = await ensureGlpiConfig();
        if (glpiConfig.manualLinkFieldEnabled) {
          try {
            const followup = await addTicketFollowup(glpiConfig, {
              ticketId: glpiTicketId,
              content: buildGlpiFollowupContent(entry, req.user.username)
            });
            entry.glpiTicketId = glpiTicketId;
            entry.glpiLinkedAt = new Date();
            await entry.save();

            await audit(req, {
              event: 'entry.glpi.link',
              result: { success: true },
              metadata: { entryId: entry._id, ticketId: glpiTicketId, followupId: followup.followupId, source: 'create' }
            }).catch((auditError) => {
              logger.error({ err: auditError, entryId: entry._id }, 'Error al registrar auditoría de vínculo GLPI');
            });
          } catch (linkError) {
            logger.error({ err: linkError, entryId: entry._id, requestId: req.requestId }, 'Error linking entry to GLPI ticket at creation');
            glpiLinkWarning = `La entrada se creó, pero no se pudo vincular al ticket GLPI #${glpiTicketId}: ${linkError.message}`;
          }
        }
      }

      if ((entryType === 'incidente' || entryType === 'ofensa') && !entry.glpiTicketId) {
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
        }).then((result) => {
          // Persiste el ticket creado en GLPI sobre la entrada de origen para poder
          // reenviar seguimientos más tarde sin tener que volver a vincularla a mano.
          if (result?.success && result.channel === 'api' && result.externalId) {
            return Entry.findByIdAndUpdate(entry._id, {
              glpiTicketId: String(result.externalId),
              glpiLinkedAt: new Date()
            }).catch((updateError) => {
              logger.error({ err: updateError, entryId: entry._id }, 'Error persisting GLPI ticket id on entry');
            });
          }
        }).catch((error) => {
          logger.error({ err: error, entryId: entry._id, requestId: req.requestId }, 'Error dispatching GLPI immediate ticket');
        });
      }

      res.status(201).json({
        message: 'Entrada creada exitosamente',
        entry,
        ...(glpiLinkWarning ? { glpiLinkWarning } : {})
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
    query('entryType').optional().isIn(['operativa', 'incidente', 'ofensa', 'checklist']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('userId').optional().isMongoId()
  ],
  validate,
  async (req, res) => {
    try {
      const {
        page,
        limit,
        search,
        tags,
        clientId,
        entryType,
        startDate,
        endDate,
        userId
      } = req.query;

      // Asegurar que page y limit sean números enteros para prevenir fallas en MongoDB ($skip / $limit)
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const skip = (pageNum - 1) * limitNum;

      // 🔍 Filtros de la colección principal (Entry)
      const filters = {};

      if (search) {
        const sanitized = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filters.$text = { $search: sanitized };
      }

      if (tags) {
        const tagArray = tags.split(',').map(t => t.trim().toLowerCase());
        filters.tags = { $in: tagArray };
      }

      if (clientId) {
        filters.clientId = new mongoose.Types.ObjectId(clientId);
      }

      if (entryType) {
        filters.entryType = entryType;
      }

      if (startDate || endDate) {
        filters.entryDate = {};
        if (startDate) filters.entryDate.$gte = new Date(startDate);
        if (endDate) filters.entryDate.$lte = new Date(endDate);
      }

      if (userId) {
        if (typeof userId === 'string' && !userId.includes('$')) {
          filters.createdBy = new mongoose.Types.ObjectId(userId);
        } else {
          return res.status(400).json({ message: 'userId inválido' });
        }
      }

      const includeChecklistByType = !entryType || entryType === 'checklist';
      const includeNormalEntriesByType = !entryType || entryType !== 'checklist';
      const shouldIncludeChecklist = includeChecklistByType && !tags;

      let checklistClientContext = { clientId: null, clientName: DEFAULT_INTERNAL_CLIENT_NAME };
      if (shouldIncludeChecklist) {
        const defaultClientContext = await resolveDefaultClientContext();
        checklistClientContext = {
          clientId: defaultClientContext.clientId,
          clientName: defaultClientContext.clientName
        };
      }

      // 🔍 Filtros de la colección de unión (ShiftCheck)
      const checklistFilters = {};
      if (startDate || endDate) {
        checklistFilters.checkDate = {};
        if (startDate) checklistFilters.checkDate.$gte = new Date(startDate);
        if (endDate) checklistFilters.checkDate.$lte = new Date(endDate);
      }
      if (userId) {
        checklistFilters.userId = new mongoose.Types.ObjectId(userId);
      }
      if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        checklistFilters.$or = [
          { username: searchRegex },
          { type: searchRegex },
          { 'services.serviceTitle': searchRegex },
          { 'services.observation': searchRegex }
        ];
      }

      const includeChecklistForClient = !clientId
        || String(checklistClientContext.clientId || '') === String(clientId);

      // 🚀 Pipeline de agregación principal
      const aggregatePipeline = [];

      if (includeNormalEntriesByType) {
        aggregatePipeline.push({ $match: filters });
      } else {
        // Si no se requieren entradas normales, forzar retorno vacío para la colección base
        aggregatePipeline.push({ $match: { _id: null } });
      }

      // Normalizar campos de Entry
      aggregatePipeline.push({
        $project: {
          _id: 1,
          content: 1,
          entryType: 1,
          entryDate: 1,
          entryTime: 1,
          tags: 1,
          clientId: 1,
          clientName: 1,
          createdBy: 1,
          createdByUsername: 1,
          isGuestEntry: 1,
          createdAt: 1,
          updatedAt: 1,
          checklistType: { $literal: null },
          checklistMetrics: { $literal: null }
        }
      });

      // 🔗 Unión nativa con la colección ShiftCheck
      if (shouldIncludeChecklist && includeChecklistForClient) {
        aggregatePipeline.push({
          $unionWith: {
            coll: 'shiftchecks',
            pipeline: [
              { $match: checklistFilters },
              {
                $project: {
                  _id: 1,
                  content: { $literal: '' }, // Se computará en JS
                  entryType: { $literal: 'checklist' },
                  entryDate: { $literal: '' }, // Se computará en JS
                  entryTime: { $literal: '' }, // Se computará en JS
                  tags: { $literal: [] },
                  clientId: { $literal: checklistClientContext.clientId ? new mongoose.Types.ObjectId(checklistClientContext.clientId) : null },
                  clientName: { $literal: checklistClientContext.clientName || DEFAULT_INTERNAL_CLIENT_NAME },
                  createdBy: '$userId',
                  createdByUsername: { $ifNull: ['$username', 'N/A'] },
                  isGuestEntry: { $literal: false },
                  createdAt: { $ifNull: ['$checkDate', { $ifNull: ['$createdAt', new Date()] }] },
                  updatedAt: { $ifNull: ['$updatedAt', { $ifNull: ['$checkDate', { $ifNull: ['$createdAt', new Date()] }] }] },
                  checklistType: '$type',
                  checklistMetrics: {
                    totalServices: { $size: { $ifNull: ['$services', []] } },
                    totalProblems: {
                      $size: {
                        $filter: {
                          input: { $ifNull: ['$services', []] },
                          as: 's',
                          cond: { $eq: ['$$s.status', 'rojo'] }
                        }
                      }
                    }
                  },
                  services: '$services',
                  type: '$type'
                }
              }
            ]
          }
        });
      }

      // ⚙️ Ordenar, paginar y poblar relaciones en base de datos
      aggregatePipeline.push({ $sort: { createdAt: -1 } });
      aggregatePipeline.push({ $skip: skip });
      aggregatePipeline.push({ $limit: limitNum });

      // Lookup selectivo del creador de la entrada/checklist
      aggregatePipeline.push({
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdBy'
        }
      });
      aggregatePipeline.push({
        $unwind: {
          path: '$createdBy',
          preserveNullAndEmptyArrays: true
        }
      });

      // Proyección final y filtrado de datos del usuario
      aggregatePipeline.push({
        $project: {
          _id: 1,
          content: 1,
          entryType: 1,
          entryDate: 1,
          entryTime: 1,
          tags: 1,
          clientId: 1,
          clientName: 1,
          createdByUsername: 1,
          isGuestEntry: 1,
          createdAt: 1,
          updatedAt: 1,
          checklistType: 1,
          checklistMetrics: 1,
          services: 1,
          type: 1,
          createdBy: {
            $cond: {
              if: { $not: ['$createdBy._id'] },
              then: null,
              else: {
                _id: '$createdBy._id',
                username: '$createdBy.username',
                fullName: '$createdBy.fullName',
                role: '$createdBy.role'
              }
            }
          }
        }
      });

      // 📊 Consultar en paralelo los registros de la página y el conteo de totales
      const [entriesPage, entriesTotal, checklistTotal] = await Promise.all([
        Entry.aggregate(aggregatePipeline),
        includeNormalEntriesByType ? Entry.countDocuments(filters) : Promise.resolve(0),
        (shouldIncludeChecklist && includeChecklistForClient)
          ? ShiftCheck.countDocuments(checklistFilters)
          : Promise.resolve(0)
      ]);

      // 🔄 Formatear el contenido y fecha/hora en caliente solo para los registros resultantes de la página
      const pageRows = entriesPage.map((item) => {
        if (item.entryType === 'checklist') {
          item.content = buildChecklistSummaryContent(item);
          
          const checkDate = new Date(item.createdAt);
          item.entryDate = `${toSantiagoDate(checkDate)}T00:00:00.000Z`;
          item.entryTime = toSantiagoTime(checkDate);
          
          delete item.services;
          delete item.type;
        }
        return item;
      });

      const total = entriesTotal + checklistTotal;

      res.json({
        entries: pageRows,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      console.error('Error al listar entradas:', error);
      res.status(500).json({ message: 'Error al obtener entradas' });
    }
  }
);

// GET /api/entries/export - Exportar entradas filtradas a formato CSV
// Este endpoint aplica los mismos filtros de búsqueda, realiza la unión con checklists,
// formatea el contenido y las fechas, y devuelve un archivo CSV optimizado para Excel en español (con BOM).
router.get('/export',
  authenticate,
  [
    query('search').optional().trim(),
    query('tags').optional(),
    query('clientId').optional().isMongoId(),
    query('entryType').optional().isIn(['operativa', 'incidente', 'ofensa', 'checklist']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('userId').optional().isMongoId()
  ],
  validate,
  async (req, res) => {
    try {
      const {
        search,
        tags,
        clientId,
        entryType,
        startDate,
        endDate,
        userId
      } = req.query;

      // Filtros para la colección principal de Entradas
      const filters = {};

      if (search) {
        const sanitized = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filters.$text = { $search: sanitized };
      }

      if (tags) {
        const tagArray = tags.split(',').map(t => t.trim().toLowerCase());
        filters.tags = { $in: tagArray };
      }

      if (clientId) {
        filters.clientId = new mongoose.Types.ObjectId(clientId);
      }

      if (entryType) {
        filters.entryType = entryType;
      }

      if (startDate || endDate) {
        filters.entryDate = {};
        if (startDate) filters.entryDate.$gte = new Date(startDate);
        if (endDate) filters.entryDate.$lte = new Date(endDate);
      }

      if (userId) {
        filters.createdBy = new mongoose.Types.ObjectId(userId);
      }

      const includeChecklistByType = !entryType || entryType === 'checklist';
      const includeNormalEntriesByType = !entryType || entryType !== 'checklist';
      const shouldIncludeChecklist = includeChecklistByType && !tags;

      let checklistClientContext = { clientId: null, clientName: DEFAULT_INTERNAL_CLIENT_NAME };
      if (shouldIncludeChecklist) {
        const defaultClientContext = await resolveDefaultClientContext();
        checklistClientContext = {
          clientId: defaultClientContext.clientId,
          clientName: defaultClientContext.clientName
        };
      }

      // Filtros para la colección de Checklists (ShiftCheck)
      const checklistFilters = {};
      if (startDate || endDate) {
        checklistFilters.checkDate = {};
        if (startDate) checklistFilters.checkDate.$gte = new Date(startDate);
        if (endDate) checklistFilters.checkDate.$lte = new Date(endDate);
      }
      if (userId) {
        checklistFilters.userId = new mongoose.Types.ObjectId(userId);
      }
      if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        checklistFilters.$or = [
          { username: searchRegex },
          { type: searchRegex },
          { 'services.serviceTitle': searchRegex },
          { 'services.observation': searchRegex }
        ];
      }

      const includeChecklistForClient = !clientId
        || String(checklistClientContext.clientId || '') === String(clientId);

      const aggregatePipeline = [];

      if (includeNormalEntriesByType) {
        aggregatePipeline.push({ $match: filters });
      } else {
        aggregatePipeline.push({ $match: { _id: null } });
      }

      // Normalizar la proyección para que coincida entre ambas colecciones
      aggregatePipeline.push({
        $project: {
          _id: 1,
          content: 1,
          entryType: 1,
          entryDate: 1,
          entryTime: 1,
          tags: 1,
          clientId: 1,
          clientName: 1,
          createdBy: 1,
          createdByUsername: 1,
          isGuestEntry: 1,
          createdAt: 1,
          updatedAt: 1,
          checklistType: { $literal: null },
          checklistMetrics: { $literal: null }
        }
      });

      // Unión con Checklists si aplica
      if (shouldIncludeChecklist && includeChecklistForClient) {
        aggregatePipeline.push({
          $unionWith: {
            coll: 'shiftchecks',
            pipeline: [
              { $match: checklistFilters },
              {
                $project: {
                  _id: 1,
                  content: { $literal: '' },
                  entryType: { $literal: 'checklist' },
                  entryDate: { $literal: '' },
                  entryTime: { $literal: '' },
                  tags: { $literal: [] },
                  clientId: { $literal: checklistClientContext.clientId ? new mongoose.Types.ObjectId(checklistClientContext.clientId) : null },
                  clientName: { $literal: checklistClientContext.clientName || DEFAULT_INTERNAL_CLIENT_NAME },
                  createdBy: '$userId',
                  createdByUsername: { $ifNull: ['$username', 'N/A'] },
                  isGuestEntry: { $literal: false },
                  createdAt: { $ifNull: ['$checkDate', { $ifNull: ['$createdAt', new Date()] }] },
                  updatedAt: { $ifNull: ['$updatedAt', { $ifNull: ['$checkDate', { $ifNull: ['$createdAt', new Date()] }] }] },
                  checklistType: '$type',
                  checklistMetrics: {
                    totalServices: { $size: { $ifNull: ['$services', []] } },
                    totalProblems: {
                      $size: {
                        $filter: {
                          input: { $ifNull: ['$services', []] },
                          as: 's',
                          cond: { $eq: ['$$s.status', 'rojo'] }
                        }
                      }
                    }
                  },
                  services: '$services',
                  type: '$type'
                }
              }
            ]
          }
        });
      }

      aggregatePipeline.push({ $sort: { createdAt: -1 } });
      // Límite de seguridad para evitar sobrecarga en la memoria
      aggregatePipeline.push({ $limit: 10000 });

      // Lookup para obtener los datos del creador
      aggregatePipeline.push({
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdBy'
        }
      });
      aggregatePipeline.push({
        $unwind: {
          path: '$createdBy',
          preserveNullAndEmptyArrays: true
        }
      });

      // Proyección final
      aggregatePipeline.push({
        $project: {
          _id: 1,
          content: 1,
          entryType: 1,
          entryDate: 1,
          entryTime: 1,
          tags: 1,
          clientId: 1,
          clientName: 1,
          createdByUsername: 1,
          isGuestEntry: 1,
          createdAt: 1,
          updatedAt: 1,
          checklistType: 1,
          checklistMetrics: 1,
          services: 1,
          type: 1,
          createdBy: {
            $cond: {
              if: { $not: ['$createdBy._id'] },
              then: null,
              else: {
                _id: '$createdBy._id',
                username: '$createdBy.username',
                fullName: '$createdBy.fullName',
                role: '$createdBy.role'
              }
            }
          }
        }
      });

      const entries = await Entry.aggregate(aggregatePipeline);

      // Escape de caracteres especiales para formato de CSV
      const escapeCsv = (val) => {
        const raw = val == null ? '' : String(val);
        if (/[",\n\r]/.test(raw)) {
          return `"${raw.replace(/"/g, '""')}"`;
        }
        return raw;
      };

      const headers = ['Fecha', 'Hora', 'Tipo', 'Contenido', 'Tags', 'Cliente', 'Autor'];
      const csvRows = [headers.join(',')];

      entries.forEach((item) => {
        let content = item.content || '';
        let entryDate = item.entryDate;
        let entryTime = item.entryTime;

        if (item.entryType === 'checklist') {
          content = buildChecklistSummaryContent(item);
          const checkDate = new Date(item.createdAt);
          entryDate = `${toSantiagoDate(checkDate)}T00:00:00.000Z`;
          entryTime = toSantiagoTime(checkDate);
        }

        // Formateo de fecha DD/MM/YYYY en UTC para evitar desfases
        let formattedDate = '';
        if (entryDate) {
          const parsedDate = new Date(entryDate);
          if (!isNaN(parsedDate.getTime())) {
            const day = String(parsedDate.getUTCDate()).padStart(2, '0');
            const month = String(parsedDate.getUTCMonth() + 1).padStart(2, '0');
            const year = parsedDate.getUTCFullYear();
            formattedDate = `${day}/${month}/${year}`;
          } else {
            formattedDate = entryDate;
          }
        }

        const typeLabel = item.entryType === 'checklist' ? 'Checklist'
          : item.entryType === 'incidente' ? 'Incidente'
          : item.entryType === 'ofensa' ? 'Ofensa'
          : 'Operativa';

        const row = [
          formattedDate,
          entryTime || '',
          typeLabel,
          content,
          (item.tags || []).join(', '),
          item.clientName || '',
          item.createdByUsername || (item.createdBy && item.createdBy.username) || 'N/A'
        ].map(escapeCsv);

        csvRows.push(row.join(','));
      });

      // Registrar auditoría de exportación
      await audit(req, {
        event: 'entry.export',
        level: 'info',
        result: { success: true },
        metadata: {
          count: entries.length,
          filters: { search, tags, clientId, entryType, startDate, endDate, userId }
        }
      });

      // Configuración de cabeceras de respuesta y BOM para compatibilidad con Excel en español
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=bitacora_entradas.csv');
      res.status(200).send('\uFEFF' + csvRows.join('\n'));
    } catch (error) {
      console.error('Error al exportar entradas:', error);
      res.status(500).json({ message: 'Error al exportar entradas' });
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

    // Validación de permisos (IDOR fix)
    const creatorId = entry.createdBy && entry.createdBy._id ? entry.createdBy._id.toString() : null;
    if (req.user.role !== 'admin' && creatorId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No tienes permiso para ver esta entrada' });
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

      // Solo el creador o admin puede editar (QA-ENTRIES-NULL-CREATOR-001)
      const createdByIdStr = entry.createdBy ? entry.createdBy.toString() : null;
      if (createdByIdStr !== req.user._id.toString() && req.user.role !== 'admin') {
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

      // Auditar actualización de entrada
      await audit(req, {
        event: 'entry.update',
        level: 'info',
        result: { success: true },
        metadata: {
          entryId: entry._id,
          entryType: entry.entryType,
          entryDate: entry.entryDate,
          tagCount: entry.tags?.length || 0,
          updatedFields: Object.keys(req.body)
        }
      }).catch((auditError) => {
        logger.error({ err: auditError, entryId: entry._id }, 'Error al registrar auditoría de actualización de entrada');
      });

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

    // Solo el creador o admin puede eliminar (QA-ENTRIES-NULL-CREATOR-001)
    const createdByIdStr = entry.createdBy ? entry.createdBy.toString() : null;
    if (createdByIdStr !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'No tienes permiso para eliminar esta entrada' });
    }

    await entry.deleteOne();

    // Auditar eliminación de entrada
    await audit(req, {
      event: 'entry.delete',
      level: 'warn',
      result: { success: true },
      metadata: {
        entryId: entry._id,
        entryType: entry.entryType,
        entryDate: entry.entryDate,
        createdByUsername: entry.createdByUsername
      }
    }).catch((auditError) => {
      logger.error({ err: auditError, entryId: entry._id }, 'Error al registrar auditoría de eliminación de entrada');
    });

    res.json({ message: 'Entrada eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar entrada:', error);
    res.status(500).json({ message: 'Error al eliminar entrada' });
  }
});

// POST /api/entries/:id/glpi-link - Vincula la entrada a un ticket GLPI ya existente
// y envía su contenido como seguimiento (ITILFollowup) de ese ticket.
router.post('/:id/glpi-link',
  authenticate,
  notGuest,
  [body('ticketId').trim().notEmpty().withMessage('ticketId es obligatorio')],
  validate,
  async (req, res) => {
    try {
      const entry = await Entry.findById(req.params.id);
      if (!entry) {
        return res.status(404).json({ message: 'Entrada no encontrada' });
      }

      const ticketId = String(req.body.ticketId).trim();
      const config = await ensureGlpiConfig();
      const followup = await addTicketFollowup(config, {
        ticketId,
        content: buildGlpiFollowupContent(entry, req.user.username)
      });

      entry.glpiTicketId = ticketId;
      entry.glpiLinkedAt = new Date();
      await entry.save();

      await audit(req, {
        event: 'entry.glpi.link',
        result: { success: true },
        metadata: { entryId: entry._id, ticketId, followupId: followup.followupId }
      }).catch((auditError) => {
        logger.error({ err: auditError, entryId: entry._id }, 'Error al registrar auditoría de vínculo GLPI');
      });

      res.json({ message: `Entrada vinculada al ticket GLPI #${ticketId}`, entry });
    } catch (error) {
      logger.error({ err: error, entryId: req.params.id }, 'Error linking entry to GLPI ticket');
      res.status(400).json({ message: error.message || 'Error vinculando entrada a GLPI' });
    }
  }
);

// POST /api/entries/:id/glpi-sync - Reenvía el contenido actual de la entrada como un nuevo
// seguimiento del ticket GLPI ya vinculado (sin crear un ticket ni un vínculo nuevo).
router.post('/:id/glpi-sync',
  authenticate,
  notGuest,
  async (req, res) => {
    try {
      const entry = await Entry.findById(req.params.id);
      if (!entry) {
        return res.status(404).json({ message: 'Entrada no encontrada' });
      }
      if (!entry.glpiTicketId) {
        return res.status(400).json({ message: 'Esta entrada no está vinculada a ningún ticket GLPI' });
      }

      const config = await ensureGlpiConfig();
      const followup = await addTicketFollowup(config, {
        ticketId: entry.glpiTicketId,
        content: buildGlpiFollowupContent(entry, req.user.username)
      });

      entry.glpiLinkedAt = new Date();
      await entry.save();

      await audit(req, {
        event: 'entry.glpi.sync',
        result: { success: true },
        metadata: { entryId: entry._id, ticketId: entry.glpiTicketId, followupId: followup.followupId }
      }).catch((auditError) => {
        logger.error({ err: auditError, entryId: entry._id }, 'Error al registrar auditoría de reenvío GLPI');
      });

      res.json({ message: `Entrada reenviada al ticket GLPI #${entry.glpiTicketId}`, entry });
    } catch (error) {
      logger.error({ err: error, entryId: req.params.id }, 'Error syncing entry to GLPI ticket');
      res.status(400).json({ message: error.message || 'Error reenviando entrada a GLPI' });
    }
  }
);

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
      // QA-ENTRIES-TAGS-SUGGEST-PERF: Filtrar primero con $match para usar el índice multikey de tags
      { $match: { tags: regex } },
      { $unwind: '$tags' },
      // Filtrar post-unwind para excluir otros tags del mismo documento que no coincidan con la búsqueda
      { $match: { tags: regex } },
      { $match: { tags: TAG_VALIDATION_REGEX } },
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
