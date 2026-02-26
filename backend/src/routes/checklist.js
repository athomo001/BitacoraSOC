// Checklist routes and admin template management
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const mongoose = require('mongoose');
const ChecklistTemplate = require('../models/ChecklistTemplate');
const ServiceCatalog = require('../models/ServiceCatalog');
const ShiftCheck = require('../models/ShiftCheck');
const ShiftClosure = require('../models/ShiftClosure');
const Entry = require('../models/Entry');
const AppConfig = require('../models/AppConfig');
const WorkShift = require('../models/WorkShift');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const captureMetadata = require('../middleware/metadata');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const { sendShiftReport } = require('../utils/shift-report');

const isSameDay = (a, b) => a && b && a.toDateString() === b.toDateString();

const isTimeInRange = (time, start, end) => {
  if (start < end) {
    return time >= start && time < end;
  }
  return time >= start || time < end;
};

const getCurrentShift = async (date = new Date()) => {
  const currentTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const shifts = await WorkShift.find({ active: true }).sort({ order: 1, startTime: 1 });
  if (!shifts.length) return null;

  let currentShift = null;
  for (const shift of shifts) {
    if (isTimeInRange(currentTime, shift.startTime, shift.endTime)) {
      currentShift = shift;
      break;
    }
  }

  if (!currentShift) {
    currentShift = shifts.find(s => s.type === 'emergency') || null;
  }

  return currentShift;
};

const ensureObjectId = (value) => (
  mongoose.Types.ObjectId.isValid(value) ? value : new mongoose.Types.ObjectId()
);

const normalizeChildren = (children = []) => {
  if (!Array.isArray(children)) return [];
  return children.map((child, idx) => ({
    _id: ensureObjectId(child._id),
    title: child.title,
    description: child.description,
    order: typeof child.order === 'number' ? child.order : idx,
    isActive: child.isActive !== false
  }));
};

const normalizeItem = (item, idx) => ({
  _id: ensureObjectId(item._id),
  title: item.title,
  description: item.description,
  order: typeof item.order === 'number' ? item.order : idx,
  isActive: item.isActive !== false,
  children: normalizeChildren(item.children)
});

const ensureTemplateItemIds = (template) => {
  let changed = false;

  (template.items || []).forEach(item => {
    if (!mongoose.Types.ObjectId.isValid(item._id)) {
      item._id = new mongoose.Types.ObjectId();
      changed = true;
    }

    if (Array.isArray(item.children)) {
      item.children.forEach(child => {
        if (!mongoose.Types.ObjectId.isValid(child._id)) {
          child._id = new mongoose.Types.ObjectId();
          changed = true;
        }
      });
    }
  });

  if (changed) {
    template.markModified('items');
  }

  return changed;
};

const sortItems = (items = []) =>
  [...items].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const flattenItems = (items = [], parentId = null) => {
  const flat = [];
  sortItems(items).forEach(item => {
    flat.push({
      ...item.toObject?.() ? item.toObject() : item,
      parentId
    });
    if (item.children && item.children.length > 0) {
      flat.push(...flattenItems(item.children, item._id || item.id));
    }
  });
  return flat;
};

// Snapshot helper: returns active template or legacy catalog as fallback
const getActiveChecklistSnapshot = async (shiftId = null, templateType = null) => {
  let activeTemplate = null;

  if (shiftId && templateType) {
    activeTemplate = await ChecklistTemplate.findOne({
      assignedTo: { $elemMatch: { shiftId: shiftId, type: templateType } }
    });
  }

  if (!activeTemplate) {
    activeTemplate = await ChecklistTemplate.findOne({ isActive: true });
  }

  if (activeTemplate) {
    if (ensureTemplateItemIds(activeTemplate)) {
      await activeTemplate.save();
    }

    // Normalize items to ensure all have _id (including children)
    const normalizedItems = (activeTemplate.items || [])
      .filter(item => item.isActive !== false)
      .map((item, idx) => normalizeItem(item, idx));

    const activeItems = sortItems(normalizedItems.map(item => ({
      ...item,
      children: sortItems((item.children || []).filter(c => c.isActive !== false))
    })));

    return {
      type: 'template',
      checklistId: activeTemplate._id,
      checklistName: activeTemplate.name,
      items: activeItems,
      flatItems: flattenItems(activeItems)
    };
  }

  const services = await ServiceCatalog.find({ isActive: true }).sort({ order: 1, title: 1 });
  return {
    type: 'legacy',
    checklistId: null,
    checklistName: 'Catalogo de servicios',
    items: services,
    flatItems: services
  };
};

// ========== Checklist templates (admin) ==========

// Active template (visible to any authenticated role)
router.get('/templates/active', authenticate, async (req, res) => {
  try {
    const templateType = req.query.type;
    const currentShift = await getCurrentShift();
    const shiftId = currentShift ? currentShift._id : null;

    const snapshot = await getActiveChecklistSnapshot(shiftId, templateType);

    if (!snapshot.items || snapshot.items.length === 0) {
      return res.status(404).json({ message: 'No hay checklist activo configurado' });
    }

    res.json({
      template: {
        _id: snapshot.checklistId,
        name: snapshot.checklistName,
        isActive: true,
        items: snapshot.items,
        flatItems: snapshot.flatItems
      },
      source: snapshot.type
    });
  } catch (error) {
    logger.error({ err: error }, 'Error obteniendo checklist activo');
    res.status(500).json({ message: 'Error obteniendo checklist activo' });
  }
});

// List templates
router.get('/templates', authenticate, authorize('admin'), async (req, res) => {
  try {
    const templates = await ChecklistTemplate.find().sort({ isActive: -1, updatedAt: -1 });
    res.json({ templates });
  } catch (error) {
    logger.error({ err: error }, 'Error listando plantillas');
    res.status(500).json({ message: 'Error listando plantillas' });
  }
});

// Create template
router.post('/templates',
  authenticate,
  authorize('admin'),
  [
    body('name').trim().notEmpty().withMessage('El nombre es requerido'),
    body('description').optional().trim(),
    body('items').isArray({ min: 1 }).withMessage('Debes definir al menos un item'),
    body('items.*.title').trim().notEmpty().withMessage('Cada item requiere titulo'),
    body('items.*.description').optional().trim(),
    body('items.*.order').optional().isInt().toInt(),
    body('items.*.isActive').optional().isBoolean(),
    body('items.*.children').optional().isArray(),
    body('items.*.children.*.title').optional().trim().notEmpty(),
    body('items.*.children.*.description').optional().trim(),
    body('items.*.children.*.order').optional().isInt().toInt(),
    body('items.*.children.*.isActive').optional().isBoolean(),
    body('assignedTo').optional().isArray(),
    body('assignedTo.*.shiftId').optional().isMongoId(),
    body('assignedTo.*.type').optional().isIn(['inicio', 'cierre']),
    body('isActive').optional().isBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      const { name, description, items, isActive, assignedTo } = req.body;

      const normalizedItems = items.map((item, idx) => normalizeItem(item, idx));

      const template = new ChecklistTemplate({
        name,
        description,
        items: normalizedItems,
        isActive: !!isActive,
        assignedTo: assignedTo || [],
        activatedAt: isActive ? new Date() : undefined,
        createdBy: req.user?._id,
        updatedBy: req.user?._id
      });

      if (assignedTo && assignedTo.length > 0) {
        for (const assign of assignedTo) {
          await ChecklistTemplate.updateMany(
            {},
            { $pull: { assignedTo: { shiftId: assign.shiftId, type: assign.type } } }
          );
        }
      }

      if (template.isActive) {
        await ChecklistTemplate.updateMany({ _id: { $ne: template._id } }, { isActive: false });
      } else {
        const activeCount = await ChecklistTemplate.countDocuments({ isActive: true });
        if (activeCount === 0) {
          template.isActive = true;
          template.activatedAt = new Date();
        }
      }

      await template.save();
      res.status(201).json({ message: 'Plantilla creada', template });
    } catch (error) {
      logger.error({ err: error }, 'Error creando plantilla');
      res.status(500).json({ message: 'Error creando plantilla' });
    }
  }
);

// Update template
router.put('/templates/:id',
  authenticate,
  authorize('admin'),
  [
    body('name').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('items').optional().isArray({ min: 1 }),
    body('items.*.title').optional().trim().notEmpty(),
    body('items.*.description').optional().trim(),
    body('items.*.order').optional().isInt().toInt(),
    body('items.*.isActive').optional().isBoolean(),
    body('items.*.children').optional().isArray(),
    body('items.*.children.*.title').optional().trim().notEmpty(),
    body('items.*.children.*.description').optional().trim(),
    body('items.*.children.*.order').optional().isInt().toInt(),
    body('items.*.children.*.isActive').optional().isBoolean(),
    body('assignedTo').optional().isArray(),
    body('assignedTo.*.shiftId').optional().isMongoId(),
    body('assignedTo.*.type').optional().isIn(['inicio', 'cierre'])
  ],
  validate,
  async (req, res) => {
    try {
      const payload = { ...req.body };

      if (payload.items) {
        payload.items = payload.items.map((item, idx) => normalizeItem(item, idx));
      }

      if (payload.assignedTo && payload.assignedTo.length > 0) {
        for (const assign of payload.assignedTo) {
          await ChecklistTemplate.updateMany(
            { _id: { $ne: req.params.id } },
            { $pull: { assignedTo: { shiftId: assign.shiftId, type: assign.type } } }
          );
        }
      }

      payload.updatedBy = req.user?._id;

      const template = await ChecklistTemplate.findByIdAndUpdate(
        req.params.id,
        payload,
        { new: true }
      );

      if (!template) {
        return res.status(404).json({ message: 'Plantilla no encontrada' });
      }

      res.json({ message: 'Plantilla actualizada', template });
    } catch (error) {
      logger.error({ err: error }, 'Error actualizando plantilla');
      res.status(500).json({ message: 'Error actualizando plantilla' });
    }
  }
);

// Delete template
router.delete('/templates/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const template = await ChecklistTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ message: 'Plantilla no encontrada' });
    }

    if (template.isActive) {
      return res.status(400).json({ message: 'No puedes eliminar una plantilla activa. Desactiva primero.' });
    }

    await ChecklistTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Plantilla eliminada' });
  } catch (error) {
    logger.error({ err: error }, 'Error eliminando plantilla');
    res.status(500).json({ message: 'Error eliminando plantilla' });
  }
});

// Activate template
router.put('/templates/:id/activate', authenticate, authorize('admin'), async (req, res) => {
  try {
    const template = await ChecklistTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ message: 'Plantilla no encontrada' });
    }

    await ChecklistTemplate.updateMany({ _id: { $ne: template._id } }, { isActive: false });
    template.isActive = true;
    template.activatedAt = new Date();
    template.updatedBy = req.user?._id;
    await template.save();

    res.json({ message: 'Plantilla activada', template });
  } catch (error) {
    logger.error({ err: error }, 'Error activando plantilla');
    res.status(500).json({ message: 'Error activando plantilla' });
  }
});

// Deactivate template
router.put('/templates/:id/deactivate', authenticate, authorize('admin'), async (req, res) => {
  try {
    const template = await ChecklistTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ message: 'Plantilla no encontrada' });
    }

    template.isActive = false;
    template.updatedBy = req.user?._id;
    await template.save();

    res.json({ message: 'Plantilla desactivada', template });
  } catch (error) {
    logger.error({ err: error }, 'Error desactivando plantilla');
    res.status(500).json({ message: 'Error desactivando plantilla' });
  }
});

// ========== Legacy service catalog endpoints ==========

router.get('/services', authenticate, async (req, res) => {
  try {
    const snapshot = await getActiveChecklistSnapshot();
    const items = (snapshot.flatItems || []).filter(item => item.isActive !== false);
    res.json(items);
  } catch (error) {
    logger.error({ err: error }, 'Error al obtener servicios');
    res.status(500).json({ message: 'Error al obtener servicios' });
  }
});

router.get('/services/all', authenticate, authorize('admin'), async (req, res) => {
  try {
    const services = await ServiceCatalog.find().sort({ order: 1, title: 1 });
    res.json(services);
  } catch (error) {
    logger.error({ err: error }, 'Error al obtener servicios');
    res.status(500).json({ message: 'Error al obtener servicios' });
  }
});

router.post('/services',
  authenticate,
  authorize('admin'),
  [
    body('title').trim().notEmpty().withMessage('El titulo es requerido'),
    body('order').optional().isInt().toInt()
  ],
  validate,
  async (req, res) => {
    try {
      const { title, order } = req.body;
      const service = new ServiceCatalog({ title, order: order || 0 });
      await service.save();
      res.status(201).json({ message: 'Servicio creado', service });
    } catch (error) {
      logger.error({ err: error }, 'Error al crear servicio');
      res.status(500).json({ message: 'Error al crear servicio' });
    }
  }
);

router.put('/services/:id',
  authenticate,
  authorize('admin'),
  [
    body('title').optional().trim().notEmpty(),
    body('isActive').optional().isBoolean(),
    body('order').optional().isInt().toInt()
  ],
  validate,
  async (req, res) => {
    try {
      const service = await ServiceCatalog.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      );

      if (!service) {
        return res.status(404).json({ message: 'Servicio no encontrado' });
      }

      res.json({ message: 'Servicio actualizado', service });
    } catch (error) {
      logger.error({ err: error }, 'Error al actualizar servicio');
      res.status(500).json({ message: 'Error al actualizar servicio' });
    }
  }
);

router.delete('/services/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const service = await ServiceCatalog.findByIdAndDelete(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }
    res.json({ message: 'Servicio eliminado' });
  } catch (error) {
    logger.error({ err: error }, 'Error al eliminar servicio');
    res.status(500).json({ message: 'Error al eliminar servicio' });
  }
});

// ========== Checklist records ==========

router.post('/check',
  authenticate,
  captureMetadata,
  [
    body('type').isIn(['inicio', 'cierre']).withMessage('Tipo invalido'),
    body('checklistId').optional().isMongoId(),
    body('services').isArray({ min: 1 }).withMessage('Debes incluir al menos un servicio'),
    body('services.*.serviceId').isMongoId().withMessage('ID de servicio invalido'),
    body('services.*.status').isIn(['verde', 'rojo']).withMessage('Estado invalido'),
    body('services.*.observation').optional().trim().isString().isLength({ max: 1000 })
  ],
  validate,
  async (req, res) => {
    try {
      const { type, services, checklistId } = req.body;
      const userId = req.user._id;

      const currentShift = await getCurrentShift();
      const shiftId = currentShift ? currentShift._id : null;

      const snapshot = await getActiveChecklistSnapshot(shiftId, type);
      if (!snapshot.items || snapshot.items.length === 0) {
        return res.status(400).json({ message: 'No hay un checklist activo configurado' });
      }

      if (snapshot.type === 'template' && checklistId && checklistId !== String(snapshot.checklistId)) {
        return res.status(400).json({ message: 'El checklist usado ya no esta activo. Refresca y vuelve a intentar.' });
      }

      const activeServices = snapshot.flatItems || snapshot.items;
      const servicesMap = new Map(activeServices.map(s => [String(s._id), s]));
      const receivedServiceIds = services.map(s => String(s.serviceId));
      const activeServiceIds = activeServices.map(s => String(s._id));

      const missingServices = activeServiceIds.filter(id => !receivedServiceIds.includes(id));
      if (missingServices.length > 0) {
        const missingTitles = activeServices
          .filter(s => missingServices.includes(String(s._id)))
          .map(s => s.title);
        return res.status(400).json({ message: `Debes evaluar todos los servicios. Faltan: ${missingTitles.join(', ')}` });
      }

      const extraServices = receivedServiceIds.filter(id => !activeServiceIds.includes(id));
      if (extraServices.length > 0) {
        return res.status(400).json({ message: 'Se incluyeron servicios inactivos o inexistentes' });
      }

      for (const service of services) {
        if (service.status === 'rojo' && (!service.observation || service.observation.trim() === '')) {
          return res.status(400).json({ message: `El servicio "${servicesMap.get(String(service.serviceId))?.title || service.serviceId}" esta en rojo y requiere observacion` });
        }
      }

      const lastCheck = await ShiftCheck.findOne({}).sort({ createdAt: -1 });
      if (lastCheck && lastCheck.type === type) {
        const expectedType = type === 'inicio' ? 'cierre' : 'inicio';

        await audit(req, {
          event: 'shiftcheck.block.consecutive',
          level: 'warn',
          result: { success: false, reason: `Consecutive ${type} blocked` },
          metadata: { type, lastCheckType: lastCheck.type, expectedType, lastCheckUserId: lastCheck.userId }
        });

        return res.status(400).json({ message: `No puedes registrar dos "${type}" consecutivos. Debes hacer "${expectedType}" primero.` });
      }

      const config = await AppConfig.findOne();
      const cooldownMinutes = config?.shiftCheckCooldownHours || 240;

      if (lastCheck) {
        const minutesSinceLastCheck = (Date.now() - lastCheck.createdAt.getTime()) / (1000 * 60);
        const sameDay = isSameDay(lastCheck.createdAt, new Date());
        if (sameDay && minutesSinceLastCheck < cooldownMinutes) {
          const remainingMinutes = Math.ceil(cooldownMinutes - minutesSinceLastCheck);

          await audit(req, {
            event: 'shiftcheck.block.cooldown',
            level: 'warn',
            result: { success: false, reason: 'Cooldown not met' },
            metadata: {
              type,
              cooldownMinutes,
              minutesSinceLastCheck: minutesSinceLastCheck.toFixed(2),
              remainingMinutes,
              sameDay
            }
          });

          return res.status(400).json({ message: `Debes esperar ${cooldownMinutes} minutos entre checks. Tiempo restante: ${remainingMinutes} min` });
        }
      }

      const hasRedServices = services.some(s => s.status === 'rojo');

      const normalizedServices = services.map(s => {
        const def = servicesMap.get(String(s.serviceId));
        return {
          serviceId: def?._id,
          parentServiceId: def?.parentId || null,
          serviceTitle: def?.title || s.serviceId,
          status: s.status,
          observation: s.observation || ''
        };
      });

      const check = new ShiftCheck({
        checklistId: snapshot.checklistId,
        checklistName: snapshot.checklistName,
        userId,
        username: req.user.username,
        type,
        services: normalizedServices,
        hasRedServices,
        checkDate: new Date(),
        ipAddress: req.clientIp,
        userAgent: req.clientUserAgent
      });

      await check.save();

      await audit(req, {
        event: 'shiftcheck.submit',
        level: 'info',
        result: { success: true, reason: 'Check registered successfully' },
        metadata: {
          type,
          checklistId: snapshot.checklistId,
          redCount: normalizedServices.filter(s => s.status === 'rojo').length,
          greenCount: normalizedServices.filter(s => s.status === 'verde').length,
          services: normalizedServices.map(s => ({
            title: s.serviceTitle,
            status: s.status,
            hasObservation: !!s.observation
          }))
        }
      });

      // DESACTIVADO: No enviar email individual por checklist con rojos
      // Solo se envía el reporte completo (inicio + cierre + entradas) al hacer cierre de turno
      // try {
      //   const { sendChecklistEmail } = require('./smtp');
      //   const SmtpConfig = require('../models/SmtpConfig');
      //   const smtpConfig = await SmtpConfig.findOne({ isActive: true });
      //
      //   if (smtpConfig) {
      //     const shouldSend = !smtpConfig.sendOnlyIfRed || hasRedServices;
      //     if (shouldSend) {
      //       await sendChecklistEmail(check, normalizedServices);
      //     }
      //   }
      // } catch (emailError) {
      //   logger.error({ err: emailError, requestId: req.requestId, checkId: check._id }, 'Error sending checklist email');
      // }

      // Enviar reporte de turno al registrar checklist de cierre (si está habilitado en Checklist Admin)
      if (type === 'cierre' && config?.checklistCloseEmailEnabled) {
        try {
          const currentShift = await getCurrentShift(new Date());
          if (currentShift) {
            await sendShiftReport(currentShift._id, new Date(), { ignoreShiftEnabled: true });
          } else {
            logger.warn({ requestId: req.requestId }, 'No se encontró turno actual para enviar reporte');
          }
        } catch (reportError) {
          logger.error({ err: reportError, requestId: req.requestId, checkId: check._id }, 'Error sending shift report');
        }
      }

      res.status(201).json({ message: 'Checklist registrado exitosamente', check });
    } catch (error) {
      logger.error({ err: error }, 'Error al registrar checklist');
      res.status(500).json({ message: 'Error al registrar checklist' });
    }
  }
);

router.get('/check/last', authenticate, async (req, res) => {
  try {
    const lastCheck = await ShiftCheck.findOne({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('services.serviceId');

    if (!lastCheck) {
      return res.json({ message: 'Sin registro previo', check: null });
    }

    res.json(lastCheck);
  } catch (error) {
    logger.error({ err: error }, 'Error al obtener ultimo check');
    res.status(500).json({ message: 'Error al obtener ultimo check' });
  }
});

router.get('/check/history', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Todos los usuarios ven todos los checklists (información compartida del equipo)
    const [checks, total] = await Promise.all([
      ShiftCheck.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('userId', 'username fullName'),
      ShiftCheck.countDocuments({})
    ]);

    res.json({
      checks,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Error al obtener historial');
    res.status(500).json({ message: 'Error al obtener historial' });
  }
});

// DELETE /api/checklist/check/:id - Eliminar checklist (admin)
router.delete('/check/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ DELETE INICIADO para check ID:', id);

    const check = await ShiftCheck.findById(id);
    console.log('📋 Check encontrado:', check ? `Sí (${check._id}, type: ${check.type})` : 'NO ENCONTRADO');

    if (!check) {
      console.log('❌ Check no existe en DB');
      return res.status(404).json({ message: 'Checklist no encontrado' });
    }

    const deleteResult = await ShiftCheck.findByIdAndDelete(id);
    console.log('✅ findByIdAndDelete ejecutado');
    console.log('   Resultado:', deleteResult ? `Eliminado: ${deleteResult._id}` : 'Retornó null');

    // Verificar que se eliminó realmente
    const checkAfterDelete = await ShiftCheck.findById(id);
    console.log('🔍 Verificación post-delete:', checkAfterDelete ? '❌ AÚN EXISTE!' : '✅ Confirmado eliminado');

    await audit(req, {
      event: 'shiftcheck.delete',
      level: 'warn',
      result: { success: true, checkId: id, type: check.type, userId: check.userId }
    });

    console.log('📝 Auditado correctamente');
    res.json({ message: 'Checklist eliminado' });
  } catch (error) {
    console.error('❌ ERROR EN DELETE:', error.message);
    logger.error({ err: error }, 'Error eliminando checklist');
    res.status(500).json({ message: 'Error eliminando checklist' });
  }
});

// POST /api/checklist/closure - Registrar cierre de turno (B2m)
router.post('/closure',
  authenticate,
  [
    body('checkId').isMongoId().withMessage('checkId requerido'),
    body('observaciones').optional().trim(),
    body('servicesDown').optional().isArray().withMessage('servicesDown debe ser array')
  ],
  validate,
  async (req, res) => {
    try {
      const { checkId, observaciones, servicesDown } = req.body;
      const userId = req.user._id;

      // Obtener el check de cierre
      const closureCheck = await ShiftCheck.findById(checkId);
      if (!closureCheck || closureCheck.userId.toString() !== userId.toString()) {
        return res.status(404).json({ message: 'Check no encontrado o no pertenece al usuario' });
      }

      // Obtener check de inicio para delimitar turno
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const startCheck = await ShiftCheck.findOne({
        userId,
        type: 'inicio',
        createdAt: { $gte: today, $lt: tomorrow }
      });

      const shiftStartAt = startCheck?.createdAt || today;
      const shiftEndAt = new Date();

      // Contar entradas del turno
      const entries = await Entry.find({
        createdBy: userId,
        createdAt: { $gte: shiftStartAt, $lte: shiftEndAt }
      }).select('entryType');

      const totalEntries = entries.length;
      const totalIncidents = entries.filter(e => e.entryType === 'incidente').length;

      // Crear registro de cierre
      const closure = new ShiftClosure({
        userId,
        shiftStartAt,
        shiftEndAt,
        closureCheckId: checkId,
        summary: {
          totalEntries,
          totalIncidents,
          servicesDown: servicesDown || [],
          observaciones: observaciones || ''
        }
      });

      await closure.save();

      // Auditar cierre de turno
      await audit(req, {
        event: 'shift.closure',
        level: 'info',
        result: { success: true, closureId: closure._id },
        metadata: {
          totalEntries,
          totalIncidents,
          servicesDownCount: (servicesDown || []).length
        }
      });

      res.status(201).json({
        message: 'Turno cerrado exitosamente',
        closure
      });
    } catch (error) {
      logger.error({ err: error }, 'Error registrando cierre de turno');
      res.status(500).json({ message: 'Error al registrar cierre de turno' });
    }
  }
);

// GET /api/checklist/closures - Obtener cierres de turno del usuario (B2m)
router.get('/closures',
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { limit = 10, page = 1 } = req.query;
      const skip = (page - 1) * limit;

      const [closures, total] = await Promise.all([
        ShiftClosure.find({ userId })
          .sort({ shiftEndAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        ShiftClosure.countDocuments({ userId })
      ]);

      res.json({
        closures,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'Error obteniendo cierres de turno');
      res.status(500).json({ message: 'Error al obtener cierres de turno' });
    }
  }
);

module.exports = router;
