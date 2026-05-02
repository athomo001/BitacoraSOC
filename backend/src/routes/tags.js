/**
 * File Purpose: backend/src/routes/tags.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de Tags y Etiquetado
 *
 * Endpoints:
 *   GET    /api/tags           - Lista de tags con contador de uso (sync con entradas)
 *   PUT    /api/tags/:tag      - Renombrar un tag en todas las entradas (admin)
 *   DELETE /api/tags/:tag      - Eliminar un tag de todas las entradas (admin)
 *   GET    /api/tags/stats     - Top 50 tags mas usados (admin)
 *   GET    /api/tags/list      - Lista completa de tags unicos
 *   GET    /api/tags/suggest   - Autocomplete de tags (min 2 chars)
 *
 * Funcionalidad:
 *   - Tags son extraidos automaticamente del contenido (#hashtag)
 *   - Autocomplete con regex case-insensitive (^query)
 *   - Stats: aggregation para conteo de frecuencia
 *
 * Uso SOC:
 *   - Los analistas pueden etiquetar incidentes/operaciones con #tags
 *   - Tags facilitan busqueda y categorizacion de entradas
 *   - Admin puede ver tags mas usados en dashboard
 */
const express = require('express');
const router = express.Router();
const Entry = require('../models/Entry');
const { authenticate, authorize } = require('../middleware/auth');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Normaliza un nombre de tag: trim + lowercase y valida longitud
const normalizeTagName = (name = '') => {
  const normalized = name.toString().trim().toLowerCase();
  if (!normalized || normalized.length > 50) return null;
  return normalized;
};

// GET /api/tags - Tags unicos con contador de uso
router.get('/', authenticate, async (req, res) => {
  try {
    const tags = await Entry.aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $project: { tag: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1, tag: 1 } }
    ]);

    res.json({ tags });
  } catch (error) {
    console.error('Error al obtener tags con contador:', error);
    res.status(500).json({ message: 'Error al obtener tags' });
  }
});

// GET /api/tags/stats - Estadisticas de tags (top 50)
router.get('/stats', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tagStats = await Entry.aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
      { $project: { tag: '$_id', count: 1, _id: 0 } }
    ]);

    res.json(tagStats);
  } catch (error) {
    console.error('Error al obtener stats de tags:', error);
    res.status(500).json({ message: 'Error al obtener estadisticas de tags' });
  }
});

// GET /api/tags/list - Lista completa de tags unicos
router.get('/list', authenticate, async (req, res) => {
  try {
    const tags = await Entry.distinct('tags');
    res.json(tags.sort());
  } catch (error) {
    console.error('Error al obtener lista de tags:', error);
    res.status(500).json({ message: 'Error al obtener tags' });
  }
});

// GET /api/tags/suggest - Autocompletar (ya esta en entries.js pero tambien aqui)
router.get('/suggest', authenticate, async (req, res) => {
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
    console.error('Error en autocomplete:', error);
    res.status(500).json({ message: 'Error al obtener sugerencias' });
  }
});

// PUT /api/tags/:tag - Renombrar tag en todas las entradas (admin)
router.put('/:tag', authenticate, authorize('admin'), async (req, res) => {
  try {
    const currentTag = normalizeTagName(req.params.tag);
    const newName = normalizeTagName(req.body.name);

    if (!currentTag || !newName) {
      return res.status(400).json({ message: 'Nombre de tag invalido' });
    }

    if (currentTag === newName) {
      return res.status(400).json({ message: 'El nuevo nombre es igual al actual' });
    }

    const result = await Entry.updateMany(
      { tags: currentTag },
      [
        {
          $set: {
            tags: {
              // Reemplaza el tag y elimina duplicados
              $setUnion: [
                {
                  $map: {
                    input: '$tags',
                    as: 'tag',
                    in: {
                      $cond: [
                        { $eq: ['$$tag', currentTag] },
                        newName,
                        '$$tag'
                      ]
                    }
                  }
                },
                []
              ]
            }
          }
        }
      ]
    );

    res.json({
      message: 'Tag renombrado correctamente',
      from: currentTag,
      to: newName,
      matchedCount: result.matchedCount ?? result.nMatched ?? result.n ?? 0,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0
    });
  } catch (error) {
    console.error('Error al renombrar tag:', error);
    res.status(500).json({ message: 'Error al renombrar tag' });
  }
});

// DELETE /api/tags/:tag - Eliminar tag de todas las entradas (admin)
router.delete('/:tag', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tag = normalizeTagName(req.params.tag);

    if (!tag) {
      return res.status(400).json({ message: 'Tag invalido' });
    }

    const result = await Entry.updateMany(
      { tags: tag },
      [
        {
          $set: {
            tags: {
              $filter: {
                input: '$tags',
                as: 't',
                cond: { $ne: ['$$t', tag] }
              }
            }
          }
        }
      ]
    );

    res.json({
      message: 'Tag eliminado de las entradas',
      tag,
      matchedCount: result.matchedCount ?? result.nMatched ?? result.n ?? 0,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0
    });
  } catch (error) {
    console.error('Error al eliminar tag:', error);
    res.status(500).json({ message: 'Error al eliminar tag' });
  }
});

module.exports = router;
