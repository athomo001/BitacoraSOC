const Service = require('../models/Service');
const CatalogLogSource = require('../models/CatalogLogSource');
const Contact = require('../models/Contact');
const EscalationRule = require('../models/EscalationRule');
const ShiftRole = require('../models/ShiftRole');
const ShiftRotationCycle = require('../models/ShiftRotationCycle');
const ShiftAssignment = require('../models/ShiftAssignment');
const ShiftOverride = require('../models/ShiftOverride');
const User = require('../models/User');
const ExternalPerson = require('../models/ExternalPerson');
const RaciEntry = require('../models/RaciEntry');
const AppConfig = require('../models/AppConfig');
const SmtpConfig = require('../models/SmtpConfig');
const { sendEscalationInternalReminderEmail } = require('../routes/smtp');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const {
  normalizeContactType,
  isValidEmail,
  parseContactsCsv,
  formatContactsCsv,
  parseBooleanLike
} = require('../utils/contactDirectory');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ENABLED_LOG_SOURCE_MATCH = {
  $or: [
    { enabled: true },
    { enabled: { $exists: false } }
  ]
};

const CONTACT_SERVICE_POPULATE = {
  path: 'serviceId',
  select: 'name clientId',
  populate: {
    path: 'clientId',
    select: 'name parent enabled',
    match: ENABLED_LOG_SOURCE_MATCH
  }
};

const parsePositiveInt = (value, fallback, max = 500) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

const cargoMatchesRoleCode = (cargoLabel, roleCode) => {
  const normalizedCargo = String(cargoLabel || '').trim().toUpperCase();
  if (!normalizedCargo) return false;

  if (roleCode === 'N1_NO_HABIL') {
    return normalizedCargo.startsWith('N1');
  }

  if (roleCode === 'N2') {
    return normalizedCargo.startsWith('N2');
  }

  return true;
};

const findAssignmentConflict = async ({ roleCode, weekStartDate, weekEndDate, excludeId }) => {
  const conflictFilter = {
    roleCode,
    weekStartDate,
    weekEndDate
  };

  if (excludeId) {
    conflictFilter._id = { $ne: excludeId };
  }

  return ShiftAssignment.findOne(conflictFilter)
    .populate('userId', 'fullName')
    .populate('externalPersonId', 'name');
};

const formatConflictMessage = (conflict) => {
  const personName = conflict?.userId?.fullName || conflict?.externalPersonId?.name || 'otra persona';
  const startLabel = new Date(conflict.weekStartDate).toLocaleDateString('es-CL');
  const endLabel = new Date(conflict.weekEndDate).toLocaleDateString('es-CL');
  return `Ya existe una asignación para ${conflict.roleCode} en el mismo período (${startLabel} - ${endLabel}) con ${personName}`;
};

const normalizeCargoLabel = (value) => String(value || '').trim().toUpperCase();
const sanitizeText = (value, maxLength = 300) => String(value ?? '').trim().slice(0, maxLength);

const sanitizeContactPayload = (payload = {}, existing = {}) => {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const contactType = normalizeContactType(payload.contactType || payload.type || existing.contactType);

  const organizationSource = hasOwn('organization')
    ? payload.organization
    : (hasOwn('company') ? payload.company : existing.organization);

  return {
    name: sanitizeText(hasOwn('name') ? payload.name : existing.name, 120),
    email: sanitizeText(hasOwn('email') ? payload.email : existing.email, 180).toLowerCase(),
    phone: sanitizeText(hasOwn('phone') ? payload.phone : existing.phone, 80),
    organization: sanitizeText(organizationSource, 160),
    serviceId: contactType === 'preventive'
      ? null
      : ((hasOwn('serviceId') ? payload.serviceId : existing.serviceId) || null),
    role: sanitizeText(hasOwn('role') ? payload.role : existing.role, 40)
      || (contactType === 'preventive' ? 'PREVENTIVO' : 'PARA'),
    active: hasOwn('active') ? parseBooleanLike(payload.active, true) : (existing.active ?? true),
    favorite: hasOwn('favorite') ? parseBooleanLike(payload.favorite, false) : (existing.favorite ?? false),
    doNotSend: hasOwn('doNotSend') ? parseBooleanLike(payload.doNotSend, false) : (existing.doNotSend ?? false),
    notes: sanitizeText(hasOwn('notes') ? payload.notes : existing.notes, 500),
    contactType
  };
};

const validateContactPayload = (contact) => {
  const errors = [];
  if (!contact.name) errors.push('El nombre es obligatorio');
  if (contact.email && !isValidEmail(contact.email)) errors.push('El correo no es válido');

  if (contact.contactType === 'preventive') {
    if (!contact.email) errors.push('El correo es obligatorio para la agenda preventiva');
    if (!contact.organization) errors.push('La empresa es obligatoria para la agenda preventiva');
  }

  return errors;
};

/**
 * Resuelve quién está de turno AHORA para un servicio específico
 * @param {string} serviceId - ID del servicio
 * @param {Date} now - Momento actual (default: new Date())
 */
async function getEscalationNow(serviceId, now = new Date()) {
  try {
    // 1. Obtener servicio y cliente
    const service = await Service.findById(serviceId).populate({
      path: 'clientId',
      select: 'name parent enabled',
      match: ENABLED_LOG_SOURCE_MATCH
    });
    if (!service || !service.clientId) {
      throw new Error('Service not found');
    }

    // 2. Obtener regla de escalación externa
    const rule = await EscalationRule.findOne({ serviceId, active: true })
      .populate('recipientsTo recipientsCC emergencyContactId');

    const externalContacts = {
      to: rule?.recipientsTo?.map(c => ({ id: c._id, name: c.name, email: c.email })) || [],
      cc: rule?.recipientsCC?.map(c => ({ id: c._id, name: c.name, email: c.email })) || [],
      emergency: {
        phone: rule?.emergencyPhone || null,
        contactName: rule?.emergencyContactId?.name || null
      }
    };

    // 3. Resolver turnos internos (N2, TI, N1_NO_HABIL)
    const roles = ['N2', 'TI', 'N1_NO_HABIL'];
    const internalShifts = [];

    for (const roleCode of roles) {
      const shift = await resolveCurrentShift(roleCode, now);
      if (shift) {
        internalShifts.push(shift);
      }
    }

    return {
      service: {
        id: service._id,
        name: service.name,
        code: service.code,
        clientName: service.clientId.name
      },
      externalContacts,
      internalShifts,
      timestamp: now.toISOString()
    };
  } catch (error) {
    logger.error('Error in getEscalationNow:', error);
    throw error;
  }
}

/**
 * Resuelve quién está de turno para un rol específico en un momento dado
 * @param {string} roleCode - Código del rol (N2, TI, N1_NO_HABIL)
 * @param {Date} now - Momento actual
 */
async function resolveCurrentShift(roleCode, now) {
  try {
    // 1. Buscar override activo
    const override = await ShiftOverride.findOne({
      roleCode,
      active: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).populate('replacementUserId', 'fullName email phone');

    if (override) {
      const role = await ShiftRole.findOne({ code: roleCode });
      return {
        role: roleCode,
        roleName: role?.name || roleCode,
        currentUser: override.replacementUserId ? {
          id: override.replacementUserId._id,
          name: override.replacementUserId.fullName || override.replacementUserId.name,
          email: override.replacementUserId.email
        } : null,
        shiftPeriod: {
          start: override.startDate.toISOString(),
          end: override.endDate.toISOString()
        },
        isOverride: true,
        overrideReason: override.reason
      };
    }

    // 2. Buscar asignación regular que cubra "now"
    const assignment = await ShiftAssignment.findOne({
      roleCode,
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now }
    }).populate('userId', 'fullName email phone').populate('externalPersonId', 'name email phone');

    if (assignment) {
      const role = await ShiftRole.findOne({ code: roleCode });
      const assignedUser = assignment.userId || assignment.externalPersonId;
      return {
        role: roleCode,
        roleName: role?.name || roleCode,
        currentUser: assignedUser ? {
          id: assignedUser._id,
          name: assignedUser.fullName || assignedUser.name,
          email: assignedUser.email,
          phone: assignedUser.phone
        } : null,
        shiftPeriod: {
          start: assignment.weekStartDate.toISOString(),
          end: assignment.weekEndDate.toISOString()
        },
        isOverride: false
      };
    }

    // 3. No hay nadie asignado
    const role = await ShiftRole.findOne({ code: roleCode });
    return {
      role: roleCode,
      roleName: role?.name || roleCode,
      currentUser: null,
      shiftPeriod: null,
      isOverride: false
    };
  } catch (error) {
    logger.error(`Error in resolveCurrentShift for ${roleCode}:`, error);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📖 LECTURA (Analyst/Admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getEscalationView = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { now } = req.query;
    const parsedNow = now ? new Date(now) : null;
    const effectiveNow = parsedNow && !isNaN(parsedNow.getTime()) ? parsedNow : new Date();
    const result = await getEscalationNow(serviceId, effectiveNow);
    res.json(result);
  } catch (error) {
    logger.error('Error in getEscalationView:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getInternalShiftsNow = async (req, res) => {
  try {
    const { now } = req.query;
    const parsedNow = now ? new Date(now) : null;
    const effectiveNow = parsedNow && !isNaN(parsedNow.getTime()) ? parsedNow : new Date();
    const roles = ['N2', 'TI', 'N1_NO_HABIL'];
    const internalShifts = [];

    for (const roleCode of roles) {
      const shift = await resolveCurrentShift(roleCode, effectiveNow);
      if (shift) {
        internalShifts.push(shift);
      }
    }

    res.json({
      internalShifts,
      timestamp: effectiveNow.toISOString()
    });
  } catch (error) {
    logger.error('Error in getInternalShiftsNow:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getClients = async (req, res) => {
  try {
    const clients = await CatalogLogSource
      .find(ENABLED_LOG_SOURCE_MATCH)
      .select('_id name parent description enabled')
      .sort({ name: 1 });
    res.json(clients);
  } catch (error) {
    logger.error('Error in getClients:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getServices = async (req, res) => {
  try {
    const { clientId } = req.query;
    const filter = { active: true };
    if (clientId) {
      filter.clientId = clientId;
    }
    const services = await Service.find(filter)
      .populate({
        path: 'clientId',
        select: 'name parent enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      })
      .sort({ name: 1 });
    const visibleServices = services.filter((service) => Boolean(service.clientId));
    
    const result = visibleServices.map(s => ({
      _id: s._id,
      name: s.name,
      code: s.code,
      clientId: s.clientId?._id || s.clientId,
      clientName: s.clientId?.name,
      active: s.active
    }));
    
    res.json(result);
  } catch (error) {
    logger.error('Error in getServices:', error);
    res.status(500).json({ error: error.message });
  }
};

// Contactos visibles para usuarios (no admin)
exports.getContactsPublic = async (req, res) => {
  try {
    const requestedType = req.query.contactType || req.query.type || 'escalation';
    const contactType = normalizeContactType(requestedType);
    const search = String(req.query.search || '').trim();
    const filter = { active: true, contactType };

    if (search) {
      if (search.length > 64) {
        return res.status(400).json({ error: 'search no puede superar 64 caracteres' });
      }
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
        { organization: { $regex: escapeRegex(search), $options: 'i' } }
      ];
    }

    const contacts = await Contact.find(filter)
      .populate(CONTACT_SERVICE_POPULATE)
      .sort({ favorite: -1, organization: 1, name: 1 });

    const visibleContacts = contacts.filter((contact) => {
      if (contact.contactType === 'preventive') return true;
      if (!contact.serviceId) return true;
      return Boolean(contact.serviceId?.clientId);
    });

    res.json(visibleContacts);
  } catch (error) {
    logger.error('Error in getContactsPublic:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📖 RACI (Analyst/Admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getRaciByClient = async (req, res) => {
  try {
    const { clientId } = req.query;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId es requerido' });
    }

    const filter = { clientId, active: true };

    const raciEntries = await RaciEntry.find(filter)
      .populate({
        path: 'clientId',
        select: 'name parent enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      })
      .sort({ topic: 1, activity: 1 });
    const visibleEntries = raciEntries.filter((entry) => Boolean(entry.clientId));

    res.json(visibleEntries);
  } catch (error) {
    logger.error('Error in getRaciByClient:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Clientes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getAllClients = async (req, res) => {
  try {
    const clients = await CatalogLogSource
      .find(ENABLED_LOG_SOURCE_MATCH)
      .select('_id name parent description enabled')
      .sort({ name: 1 });
    res.json(clients);
  } catch (error) {
    logger.error('Error in getAllClients:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createClient = async (req, res) => {
  try {
    return res.status(410).json({
      error: 'La gestión de clientes de escalación se realiza desde Catálogos > Log Sources'
    });
  } catch (error) {
    logger.error('Error in createClient:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    return res.status(410).json({
      error: 'La gestión de clientes de escalación se realiza desde Catálogos > Log Sources'
    });
  } catch (error) {
    logger.error('Error in updateClient:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    return res.status(410).json({
      error: 'La gestión de clientes de escalación se realiza desde Catálogos > Log Sources'
    });
  } catch (error) {
    logger.error('Error in deleteClient:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Servicios
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getAllServices = async (req, res) => {
  try {
    const services = await Service.find({ active: true })
      .populate({
        path: 'clientId',
        select: 'name parent enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      })
      .sort({ name: 1 });
    const visibleServices = services.filter((service) => Boolean(service.clientId));
    res.json(visibleServices);
  } catch (error) {
    logger.error('Error in getAllServices:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createService = async (req, res) => {
  try {
    const data = { ...req.body };
    const client = await CatalogLogSource.findOne({
      _id: data.clientId,
      ...ENABLED_LOG_SOURCE_MATCH
    }).select('_id');
    if (!client) {
      return res.status(400).json({ error: 'Cliente/Log Source inválido o deshabilitado' });
    }
    if (!data.code && data.name) {
      const slug = data.name
        .toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
      data.code = `${slug}_${data.clientId || 'svc'}`;
    }
    const service = new Service(data);
    await service.save();
    await service.populate('clientId', 'name');
    logger.info('Service created:', { serviceId: service._id, name: service.name });
    res.status(201).json(service);
  } catch (error) {
    logger.error('Error in createService:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.body?.clientId) {
      const client = await CatalogLogSource.findOne({
        _id: req.body.clientId,
        ...ENABLED_LOG_SOURCE_MATCH
      }).select('_id');
      if (!client) {
        return res.status(400).json({ error: 'Cliente/Log Source inválido o deshabilitado' });
      }
    }
    const service = await Service.findByIdAndUpdate(id, req.body, { new: true, runValidators: true })
      .populate({
        path: 'clientId',
        select: 'name parent enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      });
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    if (!service.clientId) {
      return res.status(400).json({ error: 'Servicio asociado a cliente deshabilitado' });
    }
    logger.info('Service updated:', { serviceId: service._id, name: service.name });
    res.json(service);
  } catch (error) {
    logger.error('Error in updateService:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findByIdAndDelete(id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    logger.info('Service deleted:', { serviceId: service._id, code: service.code });
    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteService:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Contactos
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getAllContacts = async (req, res) => {
  try {
    const requestedType = String(req.query.contactType || req.query.type || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();
    const filter = {};

    if (requestedType && requestedType !== 'all') {
      filter.contactType = normalizeContactType(requestedType);
    }

    if (req.query.active !== undefined) {
      filter.active = parseBooleanLike(req.query.active, true);
    }

    if (search) {
      if (search.length > 64) {
        return res.status(400).json({ error: 'search no puede superar 64 caracteres' });
      }
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
        { organization: { $regex: escapeRegex(search), $options: 'i' } }
      ];
    }

    const contacts = await Contact.find(filter)
      .populate(CONTACT_SERVICE_POPULATE)
      .sort({ favorite: -1, organization: 1, name: 1 });

    const visibleContacts = contacts.filter((contact) => {
      if (contact.contactType === 'preventive') return true;
      if (!contact.serviceId) return true;
      return Boolean(contact.serviceId?.clientId);
    });

    res.json(visibleContacts);
  } catch (error) {
    logger.error('Error in getAllContacts:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createContact = async (req, res) => {
  try {
    const payload = sanitizeContactPayload(req.body);
    const validationErrors = validateContactPayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('. ') });
    }

    if (payload.serviceId) {
      const service = await Service.findById(payload.serviceId)
        .populate({
          path: 'clientId',
          select: 'enabled',
          match: ENABLED_LOG_SOURCE_MATCH
        });
      if (!service || !service.clientId) {
        return res.status(400).json({ error: 'Servicio inválido o asociado a cliente deshabilitado' });
      }
    }

    const contact = new Contact(payload);
    await contact.save();
    await contact.populate(CONTACT_SERVICE_POPULATE);

    await audit(req, {
      event: 'directory.contact.create',
      result: { success: true },
      metadata: {
        contactId: contact._id,
        name: contact.name,
        email: contact.email,
        organization: contact.organization,
        contactType: contact.contactType,
        favorite: contact.favorite,
        doNotSend: contact.doNotSend
      }
    });

    logger.info('Contact created:', { contactId: contact._id, name: contact.name, type: contact.contactType });
    res.status(201).json(contact);
  } catch (error) {
    logger.error('Error in createContact:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const { id } = req.params;
    const existingContact = await Contact.findById(id);
    if (!existingContact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const payload = sanitizeContactPayload(req.body, existingContact.toObject());
    const validationErrors = validateContactPayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('. ') });
    }

    if (payload.serviceId) {
      const service = await Service.findById(payload.serviceId)
        .populate({
          path: 'clientId',
          select: 'enabled',
          match: ENABLED_LOG_SOURCE_MATCH
        });
      if (!service || !service.clientId) {
        return res.status(400).json({ error: 'Servicio inválido o asociado a cliente deshabilitado' });
      }
    }

    Object.assign(existingContact, payload);
    await existingContact.save();
    await existingContact.populate(CONTACT_SERVICE_POPULATE);

    await audit(req, {
      event: 'directory.contact.update',
      result: { success: true },
      metadata: {
        contactId: existingContact._id,
        name: existingContact.name,
        email: existingContact.email,
        organization: existingContact.organization,
        contactType: existingContact.contactType,
        favorite: existingContact.favorite,
        doNotSend: existingContact.doNotSend
      }
    });

    logger.info('Contact updated:', { contactId: existingContact._id, name: existingContact.name, type: existingContact.contactType });
    res.json(existingContact);
  } catch (error) {
    logger.error('Error in updateContact:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findByIdAndDelete(id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await audit(req, {
      event: 'directory.contact.delete',
      result: { success: true },
      metadata: {
        contactId: contact._id,
        name: contact.name,
        email: contact.email,
        contactType: contact.contactType
      }
    });

    logger.info('Contact deleted:', { contactId: contact._id, name: contact.name, type: contact.contactType });
    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteContact:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.importContactsCsv = async (req, res) => {
  try {
    const defaultType = normalizeContactType(req.body?.contactType || req.query?.contactType || 'preventive');
    const csvText = req.file?.buffer
      ? req.file.buffer.toString('utf8')
      : String(req.body?.csvText || '');

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'Adjunta un archivo CSV o contenido csvText válido' });
    }

    const parsed = parseContactsCsv(csvText, { defaultType });
    if (parsed.validRows.length === 0) {
      return res.status(400).json({
        error: 'No se encontraron filas válidas para importar',
        errors: parsed.errors.slice(0, 200)
      });
    }

    const importErrors = [...parsed.errors];
    let created = 0;
    let updated = 0;
    const maxRows = 1000;
    const rowsToProcess = parsed.validRows.slice(0, maxRows);

    if (parsed.validRows.length > maxRows) {
      importErrors.push({ row: maxRows + 1, message: `Se omitieron ${parsed.validRows.length - maxRows} filas por límite operativo de ${maxRows}` });
    }

    for (const row of rowsToProcess) {
      if (row.serviceId) {
        const service = await Service.findById(row.serviceId)
          .populate({
            path: 'clientId',
            select: 'enabled',
            match: ENABLED_LOG_SOURCE_MATCH
          });
        if (!service || !service.clientId) {
          importErrors.push({ row: row.name, message: 'Servicio inválido o asociado a cliente deshabilitado' });
          continue;
        }
      }

      const existing = await Contact.findOne({
        email: row.email,
        contactType: row.contactType
      });

      if (existing) {
        Object.assign(existing, row);
        await existing.save();
        updated += 1;
      } else {
        await Contact.create(row);
        created += 1;
      }
    }

    await audit(req, {
      event: 'directory.contact.import_csv',
      result: { success: true },
      metadata: {
        contactType: defaultType,
        created,
        updated,
        errorCount: importErrors.length
      }
    });

    res.json({
      message: `Importación completada: ${created} nuevos, ${updated} actualizados, ${importErrors.length} observaciones`,
      created,
      updated,
      errorCount: importErrors.length,
      errors: importErrors.slice(0, 200)
    });
  } catch (error) {
    logger.error('Error in importContactsCsv:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.exportContactsCsv = async (req, res) => {
  try {
    const requestedType = String(req.query.contactType || req.query.type || 'preventive').trim().toLowerCase();
    const filter = {};
    if (requestedType !== 'all') {
      filter.contactType = normalizeContactType(requestedType);
    }

    const contacts = await Contact.find(filter)
      .sort({ organization: 1, name: 1 })
      .lean();

    const csv = formatContactsCsv(contacts);
    const fileLabel = filter.contactType || 'all';

    await audit(req, {
      event: 'directory.contact.export_csv',
      result: { success: true },
      metadata: {
        contactType: fileLabel,
        count: contacts.length
      }
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contactos-${fileLabel}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(`\ufeff${csv}`);
  } catch (error) {
    logger.error('Error in exportContactsCsv:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - RACI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getRaciAdmin = async (req, res) => {
  try {
    const { clientId, serviceId, topic } = req.query;
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (serviceId) filter.serviceId = serviceId;
    if (topic) {
      const sanitizedTopic = String(topic).trim();
      if (sanitizedTopic.length > 64) {
        return res.status(400).json({ error: 'topic no puede superar 64 caracteres' });
      }
      filter.topic = { $regex: escapeRegex(sanitizedTopic), $options: 'i' };
    }

    const raciEntries = await RaciEntry.find(filter)
      .populate({
        path: 'clientId',
        select: 'name parent enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      })
      .populate('serviceId', 'name')
      .sort({ createdAt: -1 });
    const visibleEntries = raciEntries.filter((entry) => Boolean(entry.clientId));

    res.json(visibleEntries);
  } catch (error) {
    logger.error('Error in getRaciAdmin:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createRaci = async (req, res) => {
  try {
    const data = { ...req.body };
    data.topic = String(data.topic || '').trim();
    data.serviceId = null;
    const raciEntry = await RaciEntry.create(data);
    const populated = await RaciEntry.findById(raciEntry._id)
      .populate('clientId', 'name')
      .populate('serviceId', 'name');

    res.status(201).json(populated);
  } catch (error) {
    logger.error('Error in createRaci:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.updateRaci = async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    data.topic = String(data.topic || '').trim();
    data.serviceId = null;

    const updated = await RaciEntry.findByIdAndUpdate(id, data, { new: true })
      .populate('clientId', 'name')
      .populate('serviceId', 'name');

    if (!updated) {
      return res.status(404).json({ error: 'RACI no encontrado' });
    }

    res.json(updated);
  } catch (error) {
    logger.error('Error in updateRaci:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteRaci = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await RaciEntry.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'RACI no encontrado' });
    }
    res.json({ message: 'RACI eliminado' });
  } catch (error) {
    logger.error('Error in deleteRaci:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Reglas de Escalación
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getRules = async (req, res) => {
  try {
    const { serviceId } = req.query;
    const filter = {};
    if (serviceId) {
      filter.serviceId = serviceId;
    }
    const rules = await EscalationRule.find(filter)
      .populate({
        path: 'serviceId',
        select: 'name code clientId',
        populate: {
          path: 'clientId',
          select: 'name parent enabled',
          match: ENABLED_LOG_SOURCE_MATCH
        }
      })
      .populate('recipientsTo', 'name email')
      .populate('recipientsCC', 'name email')
      .populate('emergencyContactId', 'name phone')
      .sort({ createdAt: -1 });
    const visibleRules = rules.filter((rule) => Boolean(rule.serviceId?.clientId));
    res.json(visibleRules);
  } catch (error) {
    logger.error('Error in getRules:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createRule = async (req, res) => {
  try {
    const service = await Service.findById(req.body?.serviceId)
      .populate({
        path: 'clientId',
        select: 'enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      });
    if (!service || !service.clientId) {
      return res.status(400).json({ error: 'Servicio inválido o asociado a cliente deshabilitado' });
    }
    const rule = new EscalationRule(req.body);
    await rule.save();
    await rule.populate('serviceId recipientsTo recipientsCC emergencyContactId');
    logger.info('Escalation rule created:', { ruleId: rule._id, serviceId: rule.serviceId });
    res.status(201).json(rule);
  } catch (error) {
    logger.error('Error in createRule:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.body?.serviceId) {
      const service = await Service.findById(req.body.serviceId)
        .populate({
          path: 'clientId',
          select: 'enabled',
          match: ENABLED_LOG_SOURCE_MATCH
        });
      if (!service || !service.clientId) {
        return res.status(400).json({ error: 'Servicio inválido o asociado a cliente deshabilitado' });
      }
    }
    const rule = await EscalationRule.findByIdAndUpdate(id, req.body, { new: true, runValidators: true })
      .populate({
        path: 'serviceId',
        select: 'name code clientId',
        populate: {
          path: 'clientId',
          select: 'name parent enabled',
          match: ENABLED_LOG_SOURCE_MATCH
        }
      })
      .populate('recipientsTo recipientsCC emergencyContactId');
    if (!rule) {
      return res.status(404).json({ error: 'Escalation rule not found' });
    }
    logger.info('Escalation rule updated:', { ruleId: rule._id, serviceId: rule.serviceId });
    res.json(rule);
  } catch (error) {
    logger.error('Error in updateRule:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteRule = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await EscalationRule.findByIdAndDelete(id);
    if (!rule) {
      return res.status(404).json({ error: 'Escalation rule not found' });
    }
    logger.info('Escalation rule deleted:', { ruleId: rule._id });
    res.json({ message: 'Escalation rule deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteRule:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Ciclos de Rotación
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getCycles = async (req, res) => {
  try {
    const cycles = await ShiftRotationCycle.find().sort({ roleCode: 1 });
    res.json(cycles);
  } catch (error) {
    logger.error('Error in getCycles:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createCycle = async (req, res) => {
  try {
    const cycle = new ShiftRotationCycle(req.body);
    await cycle.save();
    logger.info('Shift cycle created:', { cycleId: cycle._id, roleCode: cycle.roleCode });
    res.status(201).json(cycle);
  } catch (error) {
    logger.error('Error in createCycle:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateCycle = async (req, res) => {
  try {
    const { id } = req.params;
    const cycle = await ShiftRotationCycle.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!cycle) {
      return res.status(404).json({ error: 'Shift cycle not found' });
    }
    logger.info('Shift cycle updated:', { cycleId: cycle._id, roleCode: cycle.roleCode });
    res.json(cycle);
  } catch (error) {
    logger.error('Error in updateCycle:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteCycle = async (req, res) => {
  try {
    const { id } = req.params;
    const cycle = await ShiftRotationCycle.findByIdAndDelete(id);
    if (!cycle) {
      return res.status(404).json({ error: 'Shift cycle not found' });
    }
    logger.info('Shift cycle deleted:', { cycleId: cycle._id });
    res.json({ message: 'Shift cycle deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteCycle:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Asignaciones de Turno
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getAssignments = async (req, res) => {
  try {
    const { roleCode, fromDate, toDate, limit } = req.query;
    const filter = {};
    if (roleCode) {
      filter.roleCode = roleCode;
    }
    if (fromDate || toDate) {
      filter.weekStartDate = {};
      if (fromDate) {
        filter.weekStartDate.$gte = new Date(fromDate);
      }
      if (toDate) {
        filter.weekStartDate.$lte = new Date(toDate);
      }
    }
    const parsedLimit = parsePositiveInt(limit, 0, 1000);
    let query = ShiftAssignment.find(filter)
      .populate('userId', 'fullName email')
      .populate('externalPersonId', 'name email')
      .sort({ weekStartDate: -1 });
    if (parsedLimit > 0) {
      query = query.limit(parsedLimit);
    }
    const assignments = await query;
    res.json(assignments);
  } catch (error) {
    logger.error('Error in getAssignments:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createAssignment = async (req, res) => {
  try {
    const weekStartDate = new Date(req.body.weekStartDate);
    const weekEndDate = new Date(req.body.weekEndDate);

    if (Number.isNaN(weekStartDate.getTime()) || Number.isNaN(weekEndDate.getTime())) {
      return res.status(400).json({ error: 'Fechas de asignación inválidas' });
    }

    if (req.body.userId) {
      const user = await User.findById(req.body.userId).select('cargoLabel fullName username');
      if (!user) {
        return res.status(400).json({ error: 'Usuario no válido para la asignación' });
      }

      if (!cargoMatchesRoleCode(user.cargoLabel, req.body.roleCode)) {
        const userName = user.fullName || user.username || 'usuario';
        return res.status(400).json({
          error: `El usuario ${userName} no tiene cargo compatible con el rol ${req.body.roleCode}`
        });
      }
    }

    const conflict = await findAssignmentConflict({
      roleCode: req.body.roleCode,
      weekStartDate,
      weekEndDate
    });

    if (conflict) {
      return res.status(409).json({ error: formatConflictMessage(conflict) });
    }

    const assignment = new ShiftAssignment(req.body);
    await assignment.save();
    await assignment.populate('userId', 'fullName email');
    await assignment.populate('externalPersonId', 'name email');
    logger.info('Shift assignment created:', { assignmentId: assignment._id, roleCode: assignment.roleCode });
    res.status(201).json(assignment);
  } catch (error) {
    logger.error('Error in createAssignment:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await ShiftAssignment.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Shift assignment not found' });
    }

    const roleCode = req.body.roleCode || existing.roleCode;
    const weekStartDate = req.body.weekStartDate ? new Date(req.body.weekStartDate) : new Date(existing.weekStartDate);
    const weekEndDate = req.body.weekEndDate ? new Date(req.body.weekEndDate) : new Date(existing.weekEndDate);
    const userId = req.body.userId !== undefined ? req.body.userId : existing.userId;

    if (Number.isNaN(weekStartDate.getTime()) || Number.isNaN(weekEndDate.getTime())) {
      return res.status(400).json({ error: 'Fechas de asignación inválidas' });
    }

    if (userId) {
      const user = await User.findById(userId).select('cargoLabel fullName username');
      if (!user) {
        return res.status(400).json({ error: 'Usuario no válido para la asignación' });
      }

      if (!cargoMatchesRoleCode(user.cargoLabel, roleCode)) {
        const userName = user.fullName || user.username || 'usuario';
        return res.status(400).json({
          error: `El usuario ${userName} no tiene cargo compatible con el rol ${roleCode}`
        });
      }
    }

    const conflict = await findAssignmentConflict({
      roleCode,
      weekStartDate,
      weekEndDate,
      excludeId: id
    });

    if (conflict) {
      return res.status(409).json({ error: formatConflictMessage(conflict) });
    }

    const assignment = await ShiftAssignment.findByIdAndUpdate(id, req.body, { new: true, runValidators: true })
      .populate('userId', 'fullName email')
      .populate('externalPersonId', 'name email');
    logger.info('Shift assignment updated:', { assignmentId: assignment._id, roleCode: assignment.roleCode });
    res.json(assignment);
  } catch (error) {
    logger.error('Error in updateAssignment:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const assignment = await ShiftAssignment.findByIdAndDelete(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Shift assignment not found' });
    }
    logger.info('Shift assignment deleted:', { assignmentId: assignment._id });
    res.json({ message: 'Shift assignment deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteAssignment:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Overrides Manuales
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getOverrides = async (req, res) => {
  try {
    const { roleCode, active } = req.query;
    const filter = {};
    if (roleCode) {
      filter.roleCode = roleCode;
    }
    if (active !== undefined) {
      filter.active = active === 'true';
    }
    const overrides = await ShiftOverride.find(filter)
      .populate('originalUserId replacementUserId createdBy', 'fullName email')
      .sort({ startDate: -1 });
    res.json(overrides);
  } catch (error) {
    logger.error('Error in getOverrides:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createOverride = async (req, res) => {
  try {
    const override = new ShiftOverride({
      ...req.body,
      createdBy: req.user.id
    });
    await override.save();
    await override.populate('originalUserId replacementUserId createdBy', 'fullName email');
    logger.info('Shift override created:', { overrideId: override._id, roleCode: override.roleCode });
    res.status(201).json(override);
  } catch (error) {
    logger.error('Error in createOverride:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateOverride = async (req, res) => {
  try {
    const { id } = req.params;
    const override = await ShiftOverride.findByIdAndUpdate(id, req.body, { new: true, runValidators: true })
      .populate('originalUserId replacementUserId createdBy', 'fullName email');
    if (!override) {
      return res.status(404).json({ error: 'Shift override not found' });
    }
    logger.info('Shift override updated:', { overrideId: override._id, roleCode: override.roleCode });
    res.json(override);
  } catch (error) {
    logger.error('Error in updateOverride:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteOverride = async (req, res) => {
  try {
    const { id } = req.params;
    const override = await ShiftOverride.findByIdAndDelete(id);
    if (!override) {
      return res.status(404).json({ error: 'Shift override not found' });
    }
    logger.info('Shift override deleted:', { overrideId: override._id });
    res.json({ message: 'Shift override deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteOverride:', error);
    res.status(500).json({ error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Personas Externas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exports.getExternalPeople = async (req, res) => {
  try {
    const people = await ExternalPerson.find().sort({ name: 1 });
    res.json(people);
  } catch (error) {
    logger.error('Error in getExternalPeople:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createExternalPerson = async (req, res) => {
  try {
    const person = new ExternalPerson(req.body);
    await person.save();
    res.status(201).json(person);
  } catch (error) {
    logger.error('Error in createExternalPerson:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateExternalPerson = async (req, res) => {
  try {
    const { id } = req.params;
    const person = await ExternalPerson.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!person) {
      return res.status(404).json({ error: 'External person not found' });
    }
    res.json(person);
  } catch (error) {
    logger.error('Error in updateExternalPerson:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteExternalPerson = async (req, res) => {
  try {
    const { id } = req.params;
    const person = await ExternalPerson.findByIdAndDelete(id);
    if (!person) {
      return res.status(404).json({ error: 'External person not found' });
    }
    res.json({ message: 'External person deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteExternalPerson:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.testEscalationReminder = async (req, res) => {
  try {
    const payloadCargoLabels = Array.isArray(req.body?.cargoLabels)
      ? req.body.cargoLabels.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    const config = await AppConfig.findOne().select('escalationReminderCargoLabels');
    const configuredCargoLabels = Array.isArray(config?.escalationReminderCargoLabels)
      ? config.escalationReminderCargoLabels.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    const cargoLabels = payloadCargoLabels.length > 0
      ? payloadCargoLabels
      : (configuredCargoLabels.length > 0 ? configuredCargoLabels : ['N2']);

    const smtpActive = await SmtpConfig.exists({ isActive: true });
    if (!smtpActive) {
      return res.status(400).json({
        message: 'No hay configuración SMTP activa. Configura SMTP antes de probar el recordatorio.'
      });
    }

    if (cargoLabels.length === 0) {
      return res.status(400).json({
        message: 'No hay cargos configurados para el recordatorio de escalación interna'
      });
    }

    const normalized = cargoLabels.map(normalizeCargoLabel);

    const users = await User.find({
      isActive: true,
      email: { $exists: true, $ne: '' },
      cargoLabel: { $exists: true, $ne: '' }
    }).select('email cargoLabel');

    const recipients = Array.from(new Set(
      users
        .filter((user) => normalized.includes(normalizeCargoLabel(user.cargoLabel)))
        .map((user) => user.email)
    ));

    if (recipients.length === 0) {
      return res.json({
        message: 'No hay usuarios activos con email para los cargos configurados',
        cargoLabels,
        totalRecipients: 0,
        recipients: []
      });
    }

    await sendEscalationInternalReminderEmail({
      recipients,
      cargoLabels,
      dateLabel: new Date().toLocaleDateString('es-CL')
    });

    return res.json({
      message: 'Correo de prueba de recordatorio enviado',
      cargoLabels,
      totalRecipients: recipients.length,
      recipients
    });
  } catch (error) {
    logger.error('Error in testEscalationReminder:', error);
    return res.status(500).json({
      message: 'Error enviando correo de prueba de recordatorio',
      error: error.message
    });
  }
};
