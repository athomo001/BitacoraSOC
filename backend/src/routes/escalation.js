/**
 * File Purpose: backend/src/routes/escalation.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});
const escalationController = require('../controllers/escalationController');
const clientAlertController = require('../controllers/clientAlertController');

// Middleware para verificar que el usuario es ADMIN
/*
 * QA — `requireAdmin`: excepción explícita para `auditor` solo en métodos seguros (lectura).
 * Verificar que ningún endpoint admin mutable quede expuesto vía método que no sea GET/HEAD/OPTIONS.
 */
const requireAdmin = (req, res, next) => {
  const isAuditorReadOnly = req.user.role === 'auditor' && ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (req.user.role !== 'admin' && !isAuditorReadOnly) {
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
 * @route   GET /api/escalation/assignments
 * @desc    Obtener asignaciones de turno (teletrabajo, vacaciones, turnos regulares)
 *          para la vista operativa. Accesible a analistas autenticados.
 * @access  Private (Analyst/Admin)
 */
router.get('/assignments', authenticate, escalationController.getAssignments);

/**
 * @route   GET /api/escalation/raci?clientId=...&serviceId=...
 * @desc    Obtener matriz RACI por cliente/servicio
 * @access  Private (Analyst/Admin)
 */
router.get('/raci', authenticate, escalationController.getRaciByClient);
router.get('/flow/:clientId', authenticate, escalationController.getEscalationFlowByClient);
router.put('/flow/:clientId', authenticate, requireAdmin, escalationController.upsertEscalationFlowByClient);
router.post('/flow/:clientId', authenticate, requireAdmin, escalationController.upsertEscalationFlowByClient);

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

// ─── ESC-MAINT-042 — Mantenimientos (Analistas y Admins) ─────────────────
router.get('/maintenance-rules', authenticate, clientAlertController.getMaintenanceRules);
router.post('/maintenance-rules', authenticate, clientAlertController.createMaintenanceRule);
router.put('/maintenance-rules/:id', authenticate, clientAlertController.updateMaintenanceRule);
router.delete('/maintenance-rules/:id', authenticate, clientAlertController.deleteMaintenanceRule);

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
router.get('/admin/contacts/export-csv', authenticate, requireAdmin, escalationController.exportContactsCsv);
router.post('/admin/contacts/import-csv', authenticate, requireAdmin, csvUpload.single('file'), escalationController.importContactsCsv);
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
router.get('/admin/assignments/template-csv', authenticate, requireAdmin, escalationController.downloadAssignmentTemplateCsv);
router.post('/admin/assignments/import-csv', authenticate, requireAdmin, csvUpload.single('file'), escalationController.importAssignmentsCsv);
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

// 🧪 Probar envío de recordatorio de escalación interna con cargos configurados
router.post('/admin/reminder/test', authenticate, requireAdmin, escalationController.testEscalationReminder);

// 📅 Automatización de Turnos (ESC-SHIFT-111)
router.post('/admin/automation/trigger-send', authenticate, requireAdmin, escalationController.triggerEscalationScheduleSend);

// 📅 CRUD ADMIN - Programación de Notificaciones de Turnos (ShiftNotificationSchedule)
router.get('/admin/notification-schedules', authenticate, requireAdmin, escalationController.getNotificationSchedules);
router.post('/admin/notification-schedules', authenticate, requireAdmin, escalationController.createNotificationSchedule);
router.put('/admin/notification-schedules/:id', authenticate, requireAdmin, escalationController.updateNotificationSchedule);
router.delete('/admin/notification-schedules/:id', authenticate, requireAdmin, escalationController.deleteNotificationSchedule);
router.post('/admin/notification-schedules/:id/trigger-send', authenticate, requireAdmin, escalationController.triggerNotificationScheduleSend);

module.exports = router;

