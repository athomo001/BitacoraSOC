/**
 * File Purpose: backend/src/routes/admin-catalog.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * 🔐 ADMIN CATALOG ROUTES - CRUD Catálogos
 * Solo accesible para role=admin
 */
const express = require('express');
const router = express.Router();
const CatalogEvent = require('../models/CatalogEvent');
const CatalogLogSource = require('../models/CatalogLogSource');
const CatalogOperationType = require('../models/CatalogOperationType');
const Service = require('../models/Service');
const Contact = require('../models/Contact');
const EscalationRule = require('../models/EscalationRule');
const RaciEntry = require('../models/RaciEntry');
const ClientEscalationRule = require('../models/ClientEscalationRule');
const { authenticate } = require('../middleware/auth');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = (value, min, max, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

// Middleware para verificar role=admin
const requireAdmin = (req, res, next) => {
  const isAuditorReadOnly = req.user.role === 'auditor' && ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (req.user.role !== 'admin' && !isAuditorReadOnly) {
    return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
  }
  next();
};

// Aplicar autenticación y verificación de admin a todas las rutas
router.use(authenticate, requireAdmin);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EVENTOS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Crear evento
router.post('/events', async (req, res) => {
  try {
    const event = new CatalogEvent(req.body);
    await event.save();
    res.status(201).json(event);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Actualizar evento
router.put('/events/:id', async (req, res) => {
  try {
    const event = await CatalogEvent.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!event) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    res.json(event);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Deshabilitar evento (soft delete)
router.delete('/events/:id', async (req, res) => {
  try {
    const event = await CatalogEvent.findByIdAndUpdate(
      req.params.id,
      { enabled: false },
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    res.json({ message: 'Evento deshabilitado', event });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Listar todos (incluyendo deshabilitados)
router.get('/events', async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const safePage = clamp(page, 1, 100000, 1);
    const safeLimit = clamp(limit, 1, 50, 50);
    const normalizedSearch = String(search || '').trim();

    const query = {};
    if (normalizedSearch) {
      if (normalizedSearch.length > 64) {
        return res.status(400).json({ message: 'search no puede superar 64 caracteres' });
      }

      const searchRegex = new RegExp(escapeRegex(normalizedSearch), 'i');
      query.$or = [
        { name: searchRegex },
        { parent: searchRegex },
        { motivoDefault: searchRegex }
      ];
    }

    const events = await CatalogEvent.find(query)
      .sort({ parent: 1, name: 1 })
      .limit(safeLimit)
      .skip((safePage - 1) * safeLimit);

    const total = await CatalogEvent.countDocuments(query);

    res.json({
      items: events,
      total,
      page: safePage,
      totalPages: Math.ceil(total / safeLimit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Importar masivo (CSV/JSON)
router.post('/events/import', async (req, res) => {
  try {
    const { events } = req.body; // Array de eventos
    if (!Array.isArray(events)) {
      return res.status(400).json({ message: 'Se esperaba un array de eventos' });
    }

    const results = [];
    for (const eventData of events) {
      const event = new CatalogEvent(eventData);
      await event.save();
      results.push(event);
    }

    res.status(201).json({
      message: `${results.length} eventos importados`,
      items: results
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOG SOURCES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/log-sources', async (req, res) => {
  try {
    const source = new CatalogLogSource(req.body);
    await source.save();
    res.status(201).json(source);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/log-sources/:id', async (req, res) => {
  try {
    const source = await CatalogLogSource.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!source) {
      return res.status(404).json({ message: 'Log Source no encontrado' });
    }
    res.json(source);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/log-sources/:id', async (req, res) => {
  try {
    const sourceId = req.params.id;
    const source = await CatalogLogSource.findById(sourceId);
    if (!source) {
      return res.status(404).json({ message: 'Log Source no encontrado' });
    }

    const services = await Service.find({ clientId: sourceId }).select('_id').lean();
    const serviceIds = services.map((service) => service._id);

    const [deletedEscalationRules, deletedContacts, deletedServices, deletedRaciEntries, deletedClientAlertRules] = await Promise.all([
      serviceIds.length > 0
        ? EscalationRule.deleteMany({ serviceId: { $in: serviceIds } })
        : Promise.resolve({ deletedCount: 0 }),
      serviceIds.length > 0
        ? Contact.deleteMany({ serviceId: { $in: serviceIds } })
        : Promise.resolve({ deletedCount: 0 }),
      Service.deleteMany({ clientId: sourceId }),
      RaciEntry.deleteMany({ clientId: sourceId }),
      ClientEscalationRule.deleteMany({ clientId: sourceId })
    ]);

    await CatalogLogSource.findByIdAndDelete(sourceId);

    res.json({
      message: 'Log Source eliminado permanentemente con limpieza de escalación',
      source,
      cascade: {
        services: deletedServices.deletedCount || 0,
        contacts: deletedContacts.deletedCount || 0,
        escalationRules: deletedEscalationRules.deletedCount || 0,
        raciEntries: deletedRaciEntries.deletedCount || 0,
        clientAlertRules: deletedClientAlertRules.deletedCount || 0
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/log-sources', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const sources = await CatalogLogSource.find()
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await CatalogLogSource.countDocuments();

    res.json({
      items: sources,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OPERATION TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/operation-types', async (req, res) => {
  try {
    const type = new CatalogOperationType(req.body);
    await type.save();
    res.status(201).json(type);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/operation-types/:id', async (req, res) => {
  try {
    const type = await CatalogOperationType.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!type) {
      return res.status(404).json({ message: 'Tipo de operación no encontrado' });
    }
    res.json(type);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/operation-types/:id', async (req, res) => {
  try {
    const type = await CatalogOperationType.findByIdAndDelete(req.params.id);
    if (!type) {
      return res.status(404).json({ message: 'Tipo de operación no encontrado' });
    }
    res.json({ message: 'Tipo de operación eliminado', type });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/operation-types', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const types = await CatalogOperationType.find()
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await CatalogOperationType.countDocuments();

    res.json({
      items: types,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
