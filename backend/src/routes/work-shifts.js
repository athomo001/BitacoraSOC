const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const WorkShift = require('../models/WorkShift');
const moment = require('moment-timezone');
const { logger } = require('../utils/logger');

const normalizeAssignedUsersPayload = (payload = {}) => {
  const nextPayload = { ...payload };

  const hasAssignedUserIds = Object.prototype.hasOwnProperty.call(nextPayload, 'assignedUserIds');
  const hasAssignedUserId = Object.prototype.hasOwnProperty.call(nextPayload, 'assignedUserId');

  if (hasAssignedUserIds) {
    const raw = Array.isArray(nextPayload.assignedUserIds) ? nextPayload.assignedUserIds : [];
    const normalized = Array.from(new Set(raw.filter(Boolean).map((value) => String(value))));
    nextPayload.assignedUserIds = normalized;
    nextPayload.assignedUserId = normalized.length > 0 ? normalized[0] : null;
    return nextPayload;
  }

  if (hasAssignedUserId) {
    nextPayload.assignedUserIds = nextPayload.assignedUserId ? [nextPayload.assignedUserId] : [];
  }

  return nextPayload;
};

/**
 * Rutas de Turnos de Trabajo
 * 
 * Endpoints:
 *   GET    /api/work-shifts              - Listar turnos (todos los usuarios)
 *   GET    /api/work-shifts/current      - Obtener turno actual según hora
 *   GET    /api/work-shifts/:id          - Obtener turno específico
 *   POST   /api/work-shifts              - Crear turno (admin)
 *   PUT    /api/work-shifts/:id          - Actualizar turno (admin)
 *   DELETE /api/work-shifts/:id          - Eliminar turno (admin)
 *   PUT    /api/work-shifts/reorder      - Reordenar turnos (admin)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔍 CONSULTAS PÚBLICAS (todos los usuarios autenticados)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/work-shifts/current - Obtener turno actual según hora (ANTES de /:id)
router.get('/current', authenticate, async (req, res) => {
  try {
    // Buscar turnos activos
    const shifts = await WorkShift.find({ active: true })
      .populate('assignedUserId', 'fullName email phone')
      .populate('assignedUserIds', 'fullName email phone')
      .populate('checklistTemplateId', 'name')
      .populate('checklistTemplateStartId', 'name')
      .populate('checklistTemplateEndId', 'name')
      .sort({ order: 1 });

    if (shifts.length === 0) {
      return res.json({ shift: null, message: 'No hay turnos configurados' });
    }

    // Determinar turno actual respetando la zona horaria del turno (OPS-ASSIGN-008)
    let currentShift = null;
    let shiftCurrentTime = null;

    for (const shift of shifts) {
      const shiftTz = shift.timezone || 'America/Santiago';
      const nowInTz = moment().tz(shiftTz);
      const currentTimeStr = nowInTz.format('HH:mm');

      if (isTimeInRange(currentTimeStr, shift.startTime, shift.endTime)) {
        currentShift = shift;
        shiftCurrentTime = currentTimeStr;
        break;
      }
    }

    // Si no hay turno regular, buscar turno de emergencia
    if (!currentShift) {
      currentShift = shifts.find(s => s.type === 'emergency');
      if (currentShift) {
        const shiftTz = currentShift.timezone || 'America/Santiago';
        shiftCurrentTime = moment().tz(shiftTz).format('HH:mm');
      }
    }

    res.json({
      shift: currentShift,
      currentTime: shiftCurrentTime || moment().format('HH:mm'),
      timezone: currentShift?.timezone || 'America/Santiago'
    });
  } catch (error) {
    logger.error('Error getting current work shift:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/work-shifts - Listar todos los turnos
router.get('/',
  authenticate,
  [
    query('type').optional().isIn(['regular', 'emergency']),
    query('active').optional().isBoolean().toBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      const filter = {};

      if (req.query.type) {
        filter.type = req.query.type;
      }

      if (req.query.active !== undefined) {
        filter.active = req.query.active;
      }

      const shifts = await WorkShift.find(filter)
        .populate('assignedUserId', 'fullName email')
        .populate('assignedUserIds', 'fullName email')
        .populate('checklistTemplateId', 'name')
        .populate('checklistTemplateStartId', 'name')
        .populate('checklistTemplateEndId', 'name')
        .sort({ order: 1, startTime: 1 });

      res.json(shifts);
    } catch (error) {
      logger.error('Error listing work shifts:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /api/work-shifts/:id - Obtener turno específico
router.get('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('ID inválido')
  ],
  validate,
  async (req, res) => {
    try {
      const shift = await WorkShift.findById(req.params.id)
        .populate('assignedUserId', 'fullName email phone')
        .populate('assignedUserIds', 'fullName email phone')
        .populate('checklistTemplateId', 'name')
        .populate('checklistTemplateStartId', 'name')
        .populate('checklistTemplateEndId', 'name');

      if (!shift) {
        return res.status(404).json({ error: 'Turno no encontrado' });
      }

      res.json(shift);
    } catch (error) {
      logger.error('Error getting work shift:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 ADMINISTRACIÓN (solo admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// PUT /api/work-shifts/reorder - Reordenar turnos (ANTES de /:id)
router.put('/reorder',
  authenticate,
  authorize('admin'),
  [
    body('shifts').isArray().withMessage('shifts debe ser un array'),
    body('shifts.*.id').isMongoId().withMessage('ID inválido'),
    body('shifts.*.order').isInt().toInt().withMessage('order debe ser un número')
  ],
  validate,
  async (req, res) => {
    try {
      const { shifts } = req.body;

      // Actualizar orden de cada turno
      const updates = shifts.map(({ id, order }) =>
        WorkShift.findByIdAndUpdate(id, { order }, { new: true })
      );

      await Promise.all(updates);

      logger.info('Work shifts reordered:', { count: shifts.length });
      res.json({ message: 'Orden actualizado correctamente' });
    } catch (error) {
      logger.error('Error reordering work shifts:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/work-shifts - Crear turno
router.post('/',
  authenticate,
  authorize('admin'),
  [
    body('name').trim().notEmpty().withMessage('Nombre requerido'),
    body('code').trim().notEmpty().toUpperCase().withMessage('Código requerido'),
    body('type').isIn(['regular', 'emergency']).withMessage('Tipo debe ser regular o emergency'),
    body('startTime').matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).withMessage('startTime formato inválido (HH:MM)'),
    body('endTime').matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).withMessage('endTime formato inválido (HH:MM)'),
    body('timezone').optional().trim(),
    body('description').optional().trim(),
    body('assignedUserId').optional({ checkFalsy: true }).isMongoId().withMessage('assignedUserId inválido'),
    body('assignedUserIds').optional().isArray().withMessage('assignedUserIds debe ser un array'),
    body('assignedUserIds.*').optional({ checkFalsy: true }).isMongoId().withMessage('assignedUserIds contiene IDs inválidos'),
    body('checklistTemplateId').optional({ checkFalsy: true }).isMongoId().withMessage('checklistTemplateId inválido'),
    body('checklistTemplateStartId').optional({ checkFalsy: true }).isMongoId().withMessage('checklistTemplateStartId inválido'),
    body('checklistTemplateEndId').optional({ checkFalsy: true }).isMongoId().withMessage('checklistTemplateEndId inválido'),
    body('emailReportConfig').optional().isObject(),
    body('emailReportConfig.enabled').optional().isBoolean().toBoolean(),
    body('emailReportConfig.includeChecklist').optional().isBoolean().toBoolean(),
    body('emailReportConfig.includeEntries').optional().isBoolean().toBoolean(),
    body('emailReportConfig.recipients').optional().isArray(),
    body('emailReportConfig.subjectTemplate').optional().trim(),
    body('order').optional().isInt().toInt(),
    body('color').optional().trim(),
    body('active').optional().isBoolean().toBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      // Verificar código único
      const existing = await WorkShift.findOne({ code: req.body.code });
      if (existing) {
        return res.status(400).json({ error: 'El código ya existe' });
      }

      const payload = normalizeAssignedUsersPayload(req.body);
      const shift = new WorkShift(payload);
      await shift.save();

      await shift.populate('assignedUserId', 'fullName email');
      await shift.populate('assignedUserIds', 'fullName email');
      await shift.populate('checklistTemplateId', 'name')
        .populate('checklistTemplateStartId', 'name')
        .populate('checklistTemplateEndId', 'name');

      logger.info('Work shift created:', { shiftId: shift._id, code: shift.code, type: shift.type });
      res.status(201).json(shift);
    } catch (error) {
      logger.error('Error creating work shift:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// PUT /api/work-shifts/:id - Actualizar turno
router.put('/:id',
  authenticate,
  authorize('admin'),
  [
    param('id').isMongoId().withMessage('ID inválido'),
    body('name').optional().trim().notEmpty(),
    body('code').optional().trim().notEmpty().toUpperCase(),
    body('type').optional().isIn(['regular', 'emergency']),
    body('startTime').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
    body('endTime').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
    body('timezone').optional().trim(),
    body('description').optional().trim(),
    body('assignedUserId').optional({ checkFalsy: true }).isMongoId(),
    body('assignedUserIds').optional().isArray(),
    body('assignedUserIds.*').optional({ checkFalsy: true }).isMongoId(),
    body('checklistTemplateId').optional({ checkFalsy: true }).isMongoId(),
    body('checklistTemplateStartId').optional({ checkFalsy: true }).isMongoId(),
    body('checklistTemplateEndId').optional({ checkFalsy: true }).isMongoId(),
    body('emailReportConfig').optional().isObject(),
    body('emailReportConfig.enabled').optional().isBoolean().toBoolean(),
    body('emailReportConfig.includeChecklist').optional().isBoolean().toBoolean(),
    body('emailReportConfig.includeEntries').optional().isBoolean().toBoolean(),
    body('emailReportConfig.recipients').optional().isArray(),
    body('emailReportConfig.subjectTemplate').optional().trim(),
    body('order').optional().isInt().toInt(),
    body('color').optional().trim(),
    body('active').optional().isBoolean().toBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      // Verificar código único si se está cambiando
      if (req.body.code) {
        const existing = await WorkShift.findOne({
          code: req.body.code,
          _id: { $ne: req.params.id }
        });
        if (existing) {
          return res.status(400).json({ error: 'El código ya existe' });
        }
      }

      const payload = normalizeAssignedUsersPayload(req.body);

      const shift = await WorkShift.findByIdAndUpdate(
        req.params.id,
        payload,
        { new: true, runValidators: true }
      )
        .populate('assignedUserId', 'fullName email')
        .populate('assignedUserIds', 'fullName email')
        .populate('checklistTemplateId', 'name')
        .populate('checklistTemplateStartId', 'name')
        .populate('checklistTemplateEndId', 'name');

      if (!shift) {
        return res.status(404).json({ error: 'Turno no encontrado' });
      }

      logger.info('Work shift updated:', { shiftId: shift._id, code: shift.code });
      res.json(shift);
    } catch (error) {
      logger.error('Error updating work shift:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// DELETE /api/work-shifts/:id - Eliminar turno
router.delete('/:id',
  authenticate,
  authorize('admin'),
  [
    param('id').isMongoId().withMessage('ID inválido')
  ],
  validate,
  async (req, res) => {
    try {
      const shift = await WorkShift.findByIdAndDelete(req.params.id);

      if (!shift) {
        return res.status(404).json({ error: 'Turno no encontrado' });
      }

      logger.info('Work shift deleted:', { shiftId: shift._id, code: shift.code });
      res.json({ message: 'Turno eliminado correctamente' });
    } catch (error) {
      logger.error('Error deleting work shift:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/work-shifts/:id/send-report - Enviar reporte manualmente
router.post('/:id/send-report',
  authenticate,
  authorize('admin'),
  [
    param('id').isMongoId().withMessage('ID inválido'),
    body('date').optional().isISO8601().toDate().withMessage('date debe ser una fecha válida')
  ],
  validate,
  async (req, res) => {
    try {
      const { sendShiftReport } = require('../utils/shift-report');

      const date = req.body.date ? new Date(req.body.date) : new Date();

      const result = await sendShiftReport(req.params.id, date);

      logger.info('Manual shift report sent:', {
        shiftId: req.params.id,
        date: date.toISOString(),
        recipients: result.recipients
      });

      res.json(result);
    } catch (error) {
      logger.error('Error sending shift report:', error);
      res.status(500).json({
        error: error.message,
        success: false
      });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🛠️ FUNCIONES AUXILIARES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Verifica si una hora está dentro de un rango
 * Maneja cruces de medianoche (ej: 22:00 - 06:00)
 */
function isTimeInRange(time, start, end) {
  if (start < end) {
    // Rango normal (no cruza medianoche)
    return time >= start && time < end;
  } else {
    // Rango que cruza medianoche
    return time >= start || time < end;
  }
}

module.exports = router;
