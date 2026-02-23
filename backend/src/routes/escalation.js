const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const escalationController = require('../controllers/escalationController');
const clientAlertController = require('../controllers/clientAlertController');

// Middleware para verificar que el usuario es ADMIN
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📖 LECTURA (Analyst/Admin) - Requiere autenticación
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * @route   GET /api/escalation/view/:serviceId
 * @desc    Obtener información de escalación para un servicio (quién informar AHORA)
 * @access  Private (Analyst/Admin)
 */
router.get('/view/:serviceId', authenticate, escalationController.getEscalationView);

/**
 * @route   GET /api/escalation/clients
 * @desc    Obtener lista de clientes activos
 * @access  Private (Analyst/Admin)
 */
router.get('/clients', authenticate, escalationController.getClients);

/**
 * @route   GET /api/escalation/services
 * @desc    Obtener lista de servicios (opcional: filtrar por clientId)
 * @access  Private (Analyst/Admin)
 */
router.get('/services', authenticate, escalationController.getServices);

/**
 * @route   GET /api/escalation/contacts
 * @desc    Obtener lista de contactos activos (uso de analistas)
 * @access  Private (Analyst/Admin)
 */
router.get('/contacts', authenticate, escalationController.getContactsPublic);

/**
 * @route   GET /api/escalation/internal-shifts
 * @desc    Obtener turnos internos (quién está de turno AHORA)
 * @access  Private (Analyst/Admin)
 */
router.get('/internal-shifts', authenticate, escalationController.getInternalShiftsNow);

/**
 * @route   GET /api/escalation/raci?clientId=...&serviceId=...
 * @desc    Obtener matriz RACI por cliente/servicio
 * @access  Private (Analyst/Admin)
 */
router.get('/raci', authenticate, escalationController.getRaciByClient);

/**
 * @route   GET /api/escalation/client-alert?clientId=...&context=report
 * @desc    Evaluar si aplica alerta especial de escalamiento por cliente
 * @access  Private (Analyst/Admin)
 */
router.get('/client-alert', authenticate, clientAlertController.evaluateClientAlert);

/**
 * @route   POST /api/escalation/client-alert/ack
 * @desc    Confirmar lectura de alerta especial
 * @access  Private (Analyst/Admin)
 */
router.post('/client-alert/ack', authenticate, clientAlertController.acknowledgeClientAlert);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Clientes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/clients', authenticate, requireAdmin, escalationController.getAllClients);
router.post('/admin/clients', authenticate, requireAdmin, escalationController.createClient);
router.put('/admin/clients/:id', authenticate, requireAdmin, escalationController.updateClient);
router.delete('/admin/clients/:id', authenticate, requireAdmin, escalationController.deleteClient);

// 🔧 CRUD ADMIN - Reglas especiales por cliente (B22)
router.get('/admin/client-alert-rules', authenticate, requireAdmin, clientAlertController.getClientAlertRules);
router.post('/admin/client-alert-rules', authenticate, requireAdmin, clientAlertController.createClientAlertRule);
router.put('/admin/client-alert-rules/:id', authenticate, requireAdmin, clientAlertController.updateClientAlertRule);
router.delete('/admin/client-alert-rules/:id', authenticate, requireAdmin, clientAlertController.deleteClientAlertRule);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Servicios
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/services', authenticate, requireAdmin, escalationController.getAllServices);
router.post('/admin/services', authenticate, requireAdmin, escalationController.createService);
router.put('/admin/services/:id', authenticate, requireAdmin, escalationController.updateService);
router.delete('/admin/services/:id', authenticate, requireAdmin, escalationController.deleteService);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Contactos
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/contacts', authenticate, requireAdmin, escalationController.getAllContacts);
router.post('/admin/contacts', authenticate, requireAdmin, escalationController.createContact);
router.put('/admin/contacts/:id', authenticate, requireAdmin, escalationController.updateContact);
router.delete('/admin/contacts/:id', authenticate, requireAdmin, escalationController.deleteContact);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - RACI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/raci', authenticate, requireAdmin, escalationController.getRaciAdmin);
router.post('/admin/raci', authenticate, requireAdmin, escalationController.createRaci);
router.put('/admin/raci/:id', authenticate, requireAdmin, escalationController.updateRaci);
router.delete('/admin/raci/:id', authenticate, requireAdmin, escalationController.deleteRaci);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Reglas de Escalación
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/rules', authenticate, requireAdmin, escalationController.getRules);
router.post('/admin/rules', authenticate, requireAdmin, escalationController.createRule);
router.put('/admin/rules/:id', authenticate, requireAdmin, escalationController.updateRule);
router.delete('/admin/rules/:id', authenticate, requireAdmin, escalationController.deleteRule);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Ciclos de Rotación
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/cycles', authenticate, requireAdmin, escalationController.getCycles);
router.post('/admin/cycles', authenticate, requireAdmin, escalationController.createCycle);
router.put('/admin/cycles/:id', authenticate, requireAdmin, escalationController.updateCycle);
router.delete('/admin/cycles/:id', authenticate, requireAdmin, escalationController.deleteCycle);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Asignaciones de Turno
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/assignments', authenticate, requireAdmin, escalationController.getAssignments);
router.post('/admin/assignments', authenticate, requireAdmin, escalationController.createAssignment);
router.put('/admin/assignments/:id', authenticate, requireAdmin, escalationController.updateAssignment);
router.delete('/admin/assignments/:id', authenticate, requireAdmin, escalationController.deleteAssignment);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Overrides Manuales
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/overrides', authenticate, requireAdmin, escalationController.getOverrides);
router.post('/admin/overrides', authenticate, requireAdmin, escalationController.createOverride);
router.put('/admin/overrides/:id', authenticate, requireAdmin, escalationController.updateOverride);
router.delete('/admin/overrides/:id', authenticate, requireAdmin, escalationController.deleteOverride);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Personas Externas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/admin/external-people', authenticate, requireAdmin, escalationController.getExternalPeople);
router.post('/admin/external-people', authenticate, requireAdmin, escalationController.createExternalPerson);
router.put('/admin/external-people/:id', authenticate, requireAdmin, escalationController.updateExternalPerson);
router.delete('/admin/external-people/:id', authenticate, requireAdmin, escalationController.deleteExternalPerson);

module.exports = router;

