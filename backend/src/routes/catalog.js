/**
 * File Purpose: backend/src/routes/catalog.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * 📚 RUTAS DE CATÁLOGOS
 * 
 * Endpoints para búsqueda incremental (typeahead) de catálogos grandes:
 *   - GET /api/catalog/events
 *   - GET /api/catalog/log-sources
 *   - GET /api/catalog/operation-types
 * 
 * Performance:
 *   - Búsqueda server-side con índice de texto MongoDB
 *   - Límite de 20 resultados por request
 *   - Cursor-based pagination (opcional)
 *   - Solo registros enabled=true
 * 
 * RBAC:
 *   - GET (lectura): Todos los usuarios autenticados
 *   - POST/PUT/DELETE (escritura): Solo ADMIN (no implementado aquí, ver /api/admin/catalog)
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const CatalogEvent = require('../models/CatalogEvent');
const CatalogLogSource = require('../models/CatalogLogSource');
const CatalogOperationType = require('../models/CatalogOperationType');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildEnabledQuery = (enabledBool) => (
  enabledBool
    ? {
        $or: [
          { enabled: true },
          { enabled: { $exists: false } },
          { enabled: 'true' },
          { enabled: 1 }
        ]
      }
    : {
        $or: [
          { enabled: false },
          { enabled: 'false' },
          { enabled: 0 }
        ]
      }
);

const buildSearchPipeline = ({
  searchTerm,
  enabledBool,
  cursor,
  limitNum,
  projectFields,
  includeMotivoDefault = false
}) => {
  const query = buildEnabledQuery(enabledBool);
  if (cursor) {
    query._id = { $gt: cursor };
  }

  const pipeline = [{ $match: query }];

  if (searchTerm.length > 0) {
    const safeTerm = escapeRegExp(searchTerm);
    const exact = new RegExp(`^${safeTerm}$`, 'i');
    const prefix = new RegExp(`^${safeTerm}`, 'i');
    const contains = new RegExp(safeTerm, 'i');
    const isShort = searchTerm.length <= 3;

    const scoreParts = [
      { $cond: [{ $regexMatch: { input: '$name', regex: exact } }, 100, 0] },
      { $cond: [{ $regexMatch: { input: '$name', regex: prefix } }, 80, 0] },
      { $cond: [{ $regexMatch: { input: '$name', regex: isShort ? prefix : contains } }, 50, 0] },
      { $cond: [{ $regexMatch: { input: '$parent', regex: isShort ? prefix : contains } }, 20, 0] }
    ];

    if (!isShort) {
      scoreParts.push({ $cond: [{ $regexMatch: { input: '$description', regex: contains } }, 10, 0] });
    }

    if (includeMotivoDefault && !isShort) {
      scoreParts.push({ $cond: [{ $regexMatch: { input: '$motivoDefault', regex: contains } }, 8, 0] });
    }

    pipeline.push({
      $addFields: {
        _score: { $add: scoreParts }
      }
    });

    pipeline.push({ $match: { _score: { $gt: 0 } } });
    pipeline.push({ $sort: { _score: -1, name: 1 } });
  } else {
    pipeline.push({ $sort: { name: 1 } });
  }

  pipeline.push({ $limit: limitNum + 1 });
  pipeline.push({ $project: projectFields });

  return pipeline;
};

/**
 * GET /api/catalog/events
 * 
 * Buscar eventos en catálogo (typeahead)
 * 
 * Query params:
 *   - search: string de búsqueda (min 2 caracteres recomendado)
 *   - enabled: true (default) | false
 *   - limit: max resultados (default 20, max 50)
 *   - cursor: _id para pagination (opcional)
 * 
 * Respuesta:
 *   {
 *     items: [{ _id, name, parent, description, motivoDefault }],
 *     nextCursor: string | null
 *   }
 */
router.get('/events', authenticate, async (req, res) => {
  try {
    const { 
      search = '', 
      enabled = 'true', 
      limit = '20', 
      cursor 
    } = req.query;

    const searchTerm = search.trim();
    const limitNum = Math.min(parseInt(limit) || 20, 50);
    const enabledBool = enabled === 'true';

    const pipeline = buildSearchPipeline({
      searchTerm,
      enabledBool,
      cursor,
      limitNum,
      includeMotivoDefault: true,
      projectFields: { _id: 1, name: 1, parent: 1, description: 1, motivoDefault: 1 }
    });

    const items = await CatalogEvent.aggregate(pipeline);

    // Detectar si hay más resultados
    const hasMore = items.length > limitNum;
    const results = hasMore ? items.slice(0, limitNum) : items;
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    res.json({
      items: results,
      nextCursor
    });
  } catch (error) {
    console.error('Error en búsqueda de eventos:', error);
    res.status(500).json({ message: 'Error al buscar eventos', error: error.message });
  }
});

/**
 * GET /api/catalog/log-sources
 * 
 * Buscar log sources en catálogo (typeahead)
 */
router.get('/log-sources', authenticate, async (req, res) => {
  try {
    const { 
      search = '', 
      enabled = 'true', 
      limit = '20', 
      cursor 
    } = req.query;

    const searchTerm = search.trim();
    const limitNum = Math.min(parseInt(limit) || 20, 50);
    const enabledBool = enabled === 'true';

    const pipeline = buildSearchPipeline({
      searchTerm,
      enabledBool,
      cursor,
      limitNum,
      projectFields: { _id: 1, name: 1, parent: 1, description: 1, isInternal: 1 }
    });

    const items = await CatalogLogSource.aggregate(pipeline);

    const hasMore = items.length > limitNum;
    const results = hasMore ? items.slice(0, limitNum) : items;
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    res.json({
      items: results,
      nextCursor
    });
  } catch (error) {
    console.error('Error en búsqueda de log sources:', error);
    res.status(500).json({ message: 'Error al buscar log sources', error: error.message });
  }
});

/**
 * GET /api/catalog/operation-types
 * 
 * Buscar tipos de operación en catálogo (typeahead)
 */
router.get('/operation-types', authenticate, async (req, res) => {
  try {
    const { 
      search = '', 
      enabled = 'true', 
      limit = '20', 
      cursor 
    } = req.query;

    const searchTerm = search.trim();
    const limitNum = Math.min(parseInt(limit) || 20, 50);
    const enabledBool = enabled === 'true';

    const pipeline = buildSearchPipeline({
      searchTerm,
      enabledBool,
      cursor,
      limitNum,
      projectFields: { _id: 1, name: 1, parent: 1, description: 1, infoAdicionalDefault: 1 }
    });

    const items = await CatalogOperationType.aggregate(pipeline);

    const hasMore = items.length > limitNum;
    const results = hasMore ? items.slice(0, limitNum) : items;
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    res.json({
      items: results,
      nextCursor
    });
  } catch (error) {
    console.error('Error en búsqueda de operation types:', error);
    res.status(500).json({ message: 'Error al buscar operation types', error: error.message });
  }
});

module.exports = router;
