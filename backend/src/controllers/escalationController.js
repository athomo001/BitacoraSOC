/**
 * File Purpose: backend/src/controllers/escalationController.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const Service = require('../models/Service');
const path = require('path');
const fs = require('fs').promises;
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
const ShiftNotificationSchedule = require('../models/ShiftNotificationSchedule');
const { sendEscalationInternalReminderEmail } = require('../routes/smtp');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const {
  normalizeContactType,
  isValidEmail,
  parseContactsCsv,
  formatContactsCsv
} = require('../utils/contactDirectory');
const { parseBooleanLike } = require('../utils/boolean-helper');
const { syncDirectoryContact, syncManyDirectoryContacts } = require('../utils/directory-sync');
const { buildEscalationScheduleEmail } = require('../utils/escalationScheduleEmailTemplate');
const { sendEmail } = require('../utils/email');

const INTERNAL_SHIFT_ROLE_CODES = ['N1_NO_HABIL', 'N2', 'TI'];
const SHIFT_ROLE_ORDER = {
  N1_NO_HABIL: 1,
  N2: 2,
  TI: 3
};
const ROLE_TELEWORK = 'TELEWORK';
const ROLE_OL = 'OL';
const ROLE_VACATION = 'VACATION';
const ROLE_MEDICAL_LEAVE = 'MEDICAL_LEAVE';
const ROLE_MEDICAL_APPOINTMENT = 'MEDICAL_APPOINTMENT';
const ABSENCE_ROLE_CODES = ['VACATION', 'MEDICAL_LEAVE'];
const NON_EXCLUSIVE_ASSIGNMENT_ROLE_CODES = [ROLE_TELEWORK, ROLE_OL, ROLE_MEDICAL_APPOINTMENT, ...ABSENCE_ROLE_CODES];
const UPLOADS_LOGOS_DIR = path.resolve(path.join(__dirname, '../../uploads/logos'));

const contentTypeFromLogoFilename = (filename) => {
  const extension = path.extname(filename || '').toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  return 'image/png';
};

const resolveUploadedLogoWebPath = (logoUrl) => {
  if (!logoUrl || typeof logoUrl !== 'string') return null;

  const clean = logoUrl.trim();
  if (!clean) return null;

  if (clean.startsWith('/uploads/logos/')) {
    return clean.split('?')[0];
  }

  if (/^https?:\/\//i.test(clean)) {
    try {
      const parsed = new URL(clean);
      if (parsed.pathname && parsed.pathname.startsWith('/uploads/logos/')) {
        return parsed.pathname.split('?')[0];
      }
    } catch {
      return null;
    }
  }

  return null;
};

const readUploadedLogoFromWebPath = async (webPath) => {
  if (!webPath || typeof webPath !== 'string') return null;
  const clean = webPath.split('?')[0].trim();
  if (!clean.startsWith('/uploads/logos/')) return null;
  const base = path.basename(clean);
  if (!base || base === '.' || base === '..' || base.includes('..')) return null;
  const full = path.resolve(path.join(UPLOADS_LOGOS_DIR, base));
  if (!full.startsWith(UPLOADS_LOGOS_DIR)) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
};

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

  const expectedCargoByRole = {
    N1_NO_HABIL: 'N1',
    N2: 'N2',
    TI: 'TI'
  };

  if (Object.prototype.hasOwnProperty.call(expectedCargoByRole, roleCode)) {
    return normalizedCargo === expectedCargoByRole[roleCode];
  }

  return true;
};

const findAssignmentConflict = async ({ roleCode, weekStartDate, weekEndDate, excludeId }) => {
  // Teletrabajo y ausencias no tienen conflicto de exclusividad de rol único
  if (NON_EXCLUSIVE_ASSIGNMENT_ROLE_CODES.includes(roleCode)) {
    return null;
  }

  // Se evalúa por solapamiento temporal real en lugar de coincidencia exacta de fechas (inclusivo)
  const conflictFilter = {
    roleCode,
    weekStartDate: { $lte: weekEndDate },
    weekEndDate: { $gte: weekStartDate },
    isPaused: { $ne: true }
  };

  if (excludeId) {
    conflictFilter._id = { $ne: excludeId };
  }

  return ShiftAssignment.findOne(conflictFilter)
    .populate('userId', 'fullName')
    .populate('externalPersonId', 'name');
};

const findOverlappingMedicalLeave = async ({ assigneeFilter, weekStartDate, weekEndDate, excludeId }) => {
  const filter = {
    ...assigneeFilter,
    roleCode: ROLE_MEDICAL_LEAVE,
    isPaused: { $ne: true },
    weekStartDate: { $lte: weekEndDate },
    weekEndDate: { $gte: weekStartDate }
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return ShiftAssignment.findOne(filter);
};

// Pausa asignaciones del analista debido a una licencia médica activa
const pauseAssignmentsForMedicalLeave = async ({ medicalLeaveId, assigneeFilter, weekStartDate, weekEndDate }) => {
  const pauseFilter = {
    ...assigneeFilter,
    _id: { $ne: medicalLeaveId },
    roleCode: { $ne: ROLE_MEDICAL_LEAVE },
    weekStartDate: { $lte: weekEndDate },
    weekEndDate: { $gte: weekStartDate },
    isPaused: { $ne: true }
  };

  const pauseResult = await ShiftAssignment.updateMany(
    pauseFilter,
    {
      $set: {
        isPaused: true,
        pausedByMedicalLeaveId: medicalLeaveId
      }
    }
  );

  return pauseResult.modifiedCount || 0;
};

// Restaura asignaciones pausadas por una licencia médica específica
const restoreAssignmentsPausedByMedicalLeave = async (medicalLeaveId) => {
  const restoreResult = await ShiftAssignment.updateMany(
    { pausedByMedicalLeaveId: medicalLeaveId },
    {
      $set: { isPaused: false },
      $unset: { pausedByMedicalLeaveId: '' }
    }
  );

  return restoreResult.modifiedCount || 0;
};

// Restaura asignaciones cuya licencia médica pausadora ha expirado
const restoreExpiredMedicalLeavePauses = async (referenceDate = new Date()) => {
  const pausedMedicalLeaveIds = await ShiftAssignment.distinct('pausedByMedicalLeaveId', {
    isPaused: true,
    pausedByMedicalLeaveId: { $ne: null }
  });

  if (!pausedMedicalLeaveIds.length) {
    return 0;
  }

  const activeMedicalLeaves = await ShiftAssignment.find({
    _id: { $in: pausedMedicalLeaveIds },
    roleCode: ROLE_MEDICAL_LEAVE,
    weekEndDate: { $gte: referenceDate }
  }).select('_id');

  const activeIds = new Set(activeMedicalLeaves.map((leave) => String(leave._id)));
  const expiredMedicalLeaveIds = pausedMedicalLeaveIds.filter((leaveId) => !activeIds.has(String(leaveId)));

  if (!expiredMedicalLeaveIds.length) {
    return 0;
  }

  const restoreResult = await ShiftAssignment.updateMany(
    {
      isPaused: true,
      pausedByMedicalLeaveId: { $in: expiredMedicalLeaveIds }
    },
    {
      $set: { isPaused: false },
      $unset: { pausedByMedicalLeaveId: '' }
    }
  );

  return restoreResult.modifiedCount || 0;
};

// Pausa asignaciones del analista debido a vacaciones activas (misma mecánica que licencia médica)
const pauseAssignmentsForVacation = async ({ vacationId, assigneeFilter, weekStartDate, weekEndDate }) => {
  const pauseFilter = {
    ...assigneeFilter,
    _id: { $ne: vacationId },
    roleCode: { $nin: [ROLE_MEDICAL_LEAVE, ROLE_VACATION] }, // no pausar licencias médicas ni otras vacaciones
    weekStartDate: { $lte: weekEndDate },
    weekEndDate: { $gte: weekStartDate },
    isPaused: { $ne: true }
  };

  const pauseResult = await ShiftAssignment.updateMany(
    pauseFilter,
    {
      $set: {
        isPaused: true,
        pausedByVacationId: vacationId
      }
    }
  );

  return pauseResult.modifiedCount || 0;
};

// Restaura asignaciones pausadas por un registro de vacaciones específico
const restoreAssignmentsPausedByVacation = async (vacationId) => {
  const restoreResult = await ShiftAssignment.updateMany(
    { pausedByVacationId: vacationId },
    {
      $set: { isPaused: false },
      $unset: { pausedByVacationId: '' }
    }
  );

  return restoreResult.modifiedCount || 0;
};

// Restaura asignaciones cuyas vacaciones pausadoras han expirado
const restoreExpiredVacationPauses = async (referenceDate = new Date()) => {
  const pausedVacationIds = await ShiftAssignment.distinct('pausedByVacationId', {
    isPaused: true,
    pausedByVacationId: { $ne: null }
  });

  if (!pausedVacationIds.length) {
    return 0;
  }

  const activeVacations = await ShiftAssignment.find({
    _id: { $in: pausedVacationIds },
    roleCode: ROLE_VACATION,
    weekEndDate: { $gte: referenceDate }
  }).select('_id');

  const activeIds = new Set(activeVacations.map((vac) => String(vac._id)));
  const expiredVacationIds = pausedVacationIds.filter((vacId) => !activeIds.has(String(vacId)));

  if (!expiredVacationIds.length) {
    return 0;
  }

  const restoreResult = await ShiftAssignment.updateMany(
    {
      isPaused: true,
      pausedByVacationId: { $in: expiredVacationIds }
    },
    {
      $set: { isPaused: false },
      $unset: { pausedByVacationId: '' }
    }
  );

  return restoreResult.modifiedCount || 0;
};

// Función unificada para restaurar pausas de ausencias (licencia médica o vacaciones) expiradas
const restoreExpiredAbsencePauses = async (referenceDate = new Date()) => {
  const restoredMedical = await restoreExpiredMedicalLeavePauses(referenceDate);
  const restoredVacation = await restoreExpiredVacationPauses(referenceDate);
  return restoredMedical + restoredVacation;
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
    isMailingList: hasOwn('isMailingList') ? parseBooleanLike(payload.isMailingList, false) : (existing.isMailingList ?? false),
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

const splitCsvLine = (line = '') => {
  const values = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

// Generación de la plantilla CSV con comentarios explicativos sobre los valores válidos para Condición (antes Rol)
const formatShiftAssignmentsTemplateCsv = () => ([
  '# LEYENDA E INSTRUCCIONES DE IMPORTACIÓN DE TURNOS',
  '# ------------------------------------------------',
  '# Columna "condicion": Especifica el estado administrativo o técnico del analista en el turno.',
  '# Valores válidos permitidos:',
  '#   - N2 (Operador N2)',
  '#   - TI (Especialista TI)',
  '#   - N1 (Guardia N1 No Hábil)',
  '#   - Teletrabajo (o TELEWORK)',
  '#   - Charla/Capacitacion (o OL)',
  '#   - Vacaciones (o VACATION)',
  '#   - Trámite Médico (o MEDICAL_APPOINTMENT)',
  '#   - Licencia médica (o MEDICAL_LEAVE)',
  '# Columna "usuario": Username, correo electrónico o nombre completo registrado del analista.',
  '# Columna "fechaInicio" / "fechaFin": Fecha en formato AAAA-MM-DD (Ej: 2026-06-15)',
  '# Columna "horaInicio" / "horaFin": Hora en formato HH:MM de 24 horas (Ej: 09:00)',
  '# ------------------------------------------------',
  'condicion,usuario,fechaInicio,horaInicio,fechaFin,horaFin',
  'N2,usuario.n2,2026-05-04,09:00,2026-05-11,08:59',
  'TI,usuario.ti,2026-05-04,09:00,2026-05-11,08:59',
  'Vacaciones,usuario.n2,2026-05-11,09:00,2026-05-18,08:59'
].join('\n'));

// Procesador de CSV que ignora líneas explicativas y mapea 'condición' a 'rol' para mantener la lógica interna
const parseShiftAssignmentsCsv = (csvText = '') => {
  const text = String(csvText || '').replace(/^\uFEFF/, '').trim();
  if (!text) {
    return { rows: [], errors: [{ row: 0, message: 'CSV vacío' }] };
  }

  // Filtrar las líneas vacías y omitir las que comiencen con '#' para las leyendas de ayuda
  // Se eliminan comillas exteriores en caso de que el editor de CSV las haya envuelto (ej. " # Columna ... ")
  const lines = text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    const cleanLine = trimmed.replace(/^"+|"+$/g, '').trim();
    return !cleanLine.startsWith('#');
  });
  if (lines.length < 2) {
    return { rows: [], errors: [{ row: 0, message: 'El CSV debe incluir encabezado y al menos una fila' }] };
  }

  // Mapear 'condicion' o 'condición' a 'rol' para asegurar compatibilidad con la base de datos
  const headers = splitCsvLine(lines[0]).map((header) => {
    const h = header.trim().toLowerCase();
    if (h === 'condicion' || h === 'condición') return 'rol';
    return h;
  });
  const requiredHeaders = ['rol', 'usuario', 'fechainicio', 'horainicio', 'fechafin', 'horafin'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [{ row: 0, message: `Faltan columnas requeridas: ${missingHeaders.join(', ')}` }]
    };
  }

  const rows = [];
  const errors = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitCsvLine(lines[index]);
    const row = { rowNumber: index + 1 };

    headers.forEach((header, headerIndex) => {
      row[header] = String(values[headerIndex] || '').trim();
    });

    if (!row.rol && !row.usuario) {
      continue;
    }

    if (!row.rol || !row.usuario || !row.fechainicio || !row.horainicio || !row.fechafin || !row.horafin) {
      errors.push({ row: row.rowNumber, message: 'Fila incompleta. Revisa condicion, usuario y fechas/horas.' });
      continue;
    }

    rows.push(row);
  }

  return { rows, errors };
};

const buildAssignmentDateTime = (dateValue, timeValue) => {
  const isoCandidate = String(dateValue || '').includes('T')
    ? String(dateValue || '')
    : `${String(dateValue || '').trim()}T${String(timeValue || '').trim()}:00`;
  const parsed = new Date(isoCandidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveAssignmentAssignee = async (row) => {
  const identifier = String(row.usuario || row.identifier || '').trim();

  if (!identifier) {
    throw new Error('Falta el identificador de la persona asignada');
  }

  // Primero buscar usuario interno
  const user = await User.findOne({
    $or: [
      { username: identifier },
      { email: identifier.toLowerCase() },
      { fullName: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } }
    ]
  }).select('_id cargoLabel fullName username email');

  if (user) {
    return {
      userId: user._id,
      user,
      label: user.fullName || user.username || user.email || identifier
    };
  }

  // Si no se encontró internamente, buscar en personas externas
  const externalPerson = await ExternalPerson.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { name: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } }
    ]
  }).select('_id name email');

  if (externalPerson) {
    return {
      externalPersonId: externalPerson._id,
      label: externalPerson.name || externalPerson.email || identifier
    };
  }

  throw new Error(`Persona no encontrada: ${identifier}`);
};

const normalizeEscalationFlowPayload = (rawSteps = []) => {
  if (!Array.isArray(rawSteps)) return [];

  return rawSteps.map((rawStep, index) => {
    const stepType = String(rawStep?.type || '').trim().toLowerCase() === 'pool' ? 'pool' : 'unique';
    const normalizedContacts = Array.isArray(rawStep?.contacts)
      ? rawStep.contacts
        .map((contact) => ({
          name: sanitizeText(contact?.name, 120),
          tel: sanitizeText(contact?.tel, 80)
        }))
        .filter((contact) => contact.name || contact.tel)
      : [];

    const parsedCallAt = rawStep?.callAt ? new Date(rawStep.callAt) : null;
    const callAt = parsedCallAt && !Number.isNaN(parsedCallAt.getTime()) ? parsedCallAt : null;

    return {
      order: index + 1,
      title: sanitizeText(rawStep?.title || `Paso ${index + 1}`, 120) || `Paso ${index + 1}`,
      type: stepType,
      contactName: stepType === 'unique' ? sanitizeText(rawStep?.contactName, 120) : '',
      contactTel: stepType === 'unique' ? sanitizeText(rawStep?.contactTel, 80) : '',
      callAt: stepType === 'unique' ? callAt : null,
      contacts: stepType === 'pool' ? normalizedContacts : []
    };
  });
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
    await restoreExpiredMedicalLeavePauses(now);

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
      isPaused: { $ne: true },
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

    await audit(req, {
      event: 'escalation.view.service.read',
      result: { success: true },
      metadata: {
        serviceId,
        hasNowOverride: Boolean(now),
        internalShifts: Array.isArray(result?.internalShifts) ? result.internalShifts.length : 0,
        contacts: Array.isArray(result?.contacts) ? result.contacts.length : 0
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de vista de escalación');
    });

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

    await audit(req, {
      event: 'escalation.view.internal_shifts.read',
      result: { success: true },
      metadata: {
        hasNowOverride: Boolean(now),
        internalShiftsCount: internalShifts.length
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de turnos internos');
    });

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
    const andFilters = [{ active: { $ne: false } }];

    if (contactType === 'preventive') {
      andFilters.push({ contactType: 'preventive' });
    } else {
      // Compatibilidad legacy: contactos históricos sin contactType se tratan como escalación.
      andFilters.push({
        $or: [
          { contactType: 'escalation' },
          { contactType: { $exists: false } },
          { contactType: null },
          { contactType: '' }
        ]
      });
    }

    if (search) {
      if (search.length > 64) {
        return res.status(400).json({ error: 'search no puede superar 64 caracteres' });
      }
      andFilters.push({
        $or: [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
        { organization: { $regex: escapeRegex(search), $options: 'i' } }
        ]
      });
    }

    const filter = andFilters.length === 1 ? andFilters[0] : { $and: andFilters };

    const contacts = await Contact.find(filter)
      .populate(CONTACT_SERVICE_POPULATE)
      .sort({ favorite: -1, organization: 1, name: 1 });

    const visibleContacts = contacts.filter((contact) => {
      if (contact.contactType === 'preventive') return true;
      if (!contact.serviceId) return true;
      return Boolean(contact.serviceId?.clientId);
    });

    await audit(req, {
      event: 'escalation.view.contacts.read',
      result: { success: true },
      metadata: {
        contactType,
        search: search || null,
        count: visibleContacts.length
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de contactos públicos de escalación');
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

    await audit(req, {
      event: 'escalation.view.raci.read',
      result: { success: true },
      metadata: {
        clientId,
        count: visibleEntries.length
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de vista RACI');
    });

    res.json(visibleEntries);
  } catch (error) {
    logger.error('Error in getRaciByClient:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getEscalationFlowByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await CatalogLogSource.findOne({
      _id: clientId,
      ...ENABLED_LOG_SOURCE_MATCH
    }).select('_id name escalationFlow escalationLegend');

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado o deshabilitado' });
    }

    const payload = {
      clientId: client._id,
      clientName: client.name,
      flow: (client.escalationFlow || []).sort((a, b) => (a.order || 0) - (b.order || 0)),
      legend: client.escalationLegend || ''
    };

    await audit(req, {
      event: 'escalation.view.flow.read',
      result: { success: true },
      metadata: {
        clientId,
        flowSteps: Array.isArray(payload.flow) ? payload.flow.length : 0,
        hasLegend: Boolean(payload.legend)
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de flujo de escalación');
    });

    return res.json(payload);
  } catch (error) {
    logger.error('Error in getEscalationFlowByClient:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.upsertEscalationFlowByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const flow = normalizeEscalationFlowPayload(req.body?.flow);
    const legend = sanitizeText(req.body?.legend, 3000);

    const client = await CatalogLogSource.findOneAndUpdate(
      { _id: clientId, ...ENABLED_LOG_SOURCE_MATCH },
      {
        $set: {
          escalationFlow: flow,
          escalationLegend: legend
        }
      },
      { new: true, runValidators: true }
    ).select('_id name escalationFlow escalationLegend');

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado o deshabilitado' });
    }

    const flowDirectoryContacts = [];
    flow.forEach((step) => {
      if (step.type === 'pool') {
        (step.contacts || []).forEach((contact) => {
          flowDirectoryContacts.push({
            name: contact?.name,
            phone: contact?.tel,
            type: 'External'
          });
        });
        return;
      }

      flowDirectoryContacts.push({
        name: step.contactName,
        phone: step.contactTel,
        type: 'External'
      });
    });
    await syncManyDirectoryContacts(flowDirectoryContacts);

    return res.json({
      message: 'Flujo de escalamiento actualizado',
      clientId: client._id,
      clientName: client.name,
      flow: (client.escalationFlow || []).sort((a, b) => (a.order || 0) - (b.order || 0)),
      legend: client.escalationLegend || ''
    });
  } catch (error) {
    logger.error('Error in upsertEscalationFlowByClient:', error);
    return res.status(400).json({ error: error.message });
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
      if (service.active === false) {
        return res.status(400).json({ error: 'Servicio inactivo: activa el servicio o reasigna el contacto antes de guardar' });
      }
    }

    const contact = new Contact(payload);
    await contact.save();
    await contact.populate(CONTACT_SERVICE_POPULATE);
    await syncDirectoryContact({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      organization: contact.organization,
      role: contact.role,
      favorite: contact.favorite,
      isMailingList: contact.isMailingList
    });

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
        isMailingList: contact.isMailingList,
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
      if (service.active === false) {
        return res.status(400).json({ error: 'Servicio inactivo: activa el servicio o reasigna el contacto antes de guardar' });
      }
    }

    Object.assign(existingContact, payload);
    await existingContact.save();
    await existingContact.populate(CONTACT_SERVICE_POPULATE);
    await syncDirectoryContact({
      name: existingContact.name,
      email: existingContact.email,
      phone: existingContact.phone,
      organization: existingContact.organization,
      role: existingContact.role,
      favorite: existingContact.favorite,
      isMailingList: existingContact.isMailingList
    });

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
        isMailingList: existingContact.isMailingList,
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
        await syncDirectoryContact({
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          organization: existing.organization,
          role: existing.role,
          favorite: existing.favorite,
          isMailingList: existing.isMailingList
        });
        updated += 1;
      } else {
        const createdContact = await Contact.create(row);
        await syncDirectoryContact({
          name: createdContact.name,
          email: createdContact.email,
          phone: createdContact.phone,
          organization: createdContact.organization,
          role: createdContact.role,
          favorite: createdContact.favorite,
          isMailingList: createdContact.isMailingList
        });
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

    await audit(req, {
      event: 'escalation.admin.raci.read',
      result: { success: true },
      metadata: {
        clientId: clientId || null,
        serviceId: serviceId || null,
        topic: topic || null,
        count: visibleEntries.length
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de RACI admin');
    });

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
    await syncManyDirectoryContacts([
      { ...(data.responsible || {}), type: 'External' },
      { ...(data.accountable || {}), type: 'External' },
      { ...(data.consulted || {}), type: 'External' },
      { ...(data.informed || {}), type: 'External' }
    ]);

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
    await syncManyDirectoryContacts([
      { ...(data.responsible || {}), type: 'External' },
      { ...(data.accountable || {}), type: 'External' },
      { ...(data.consulted || {}), type: 'External' },
      { ...(data.informed || {}), type: 'External' }
    ]);

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

    await audit(req, {
      event: 'escalation.admin.rules.read',
      result: { success: true },
      metadata: {
        serviceId: serviceId || null,
        count: visibleRules.length
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de reglas de escalación');
    });

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
    await restoreExpiredAbsencePauses();

    const { roleCode, fromDate, toDate, limit } = req.query;
    const filter = {};
    if (roleCode) {
      filter.roleCode = roleCode;
    }
    if (fromDate || toDate) {
      const startLimit = fromDate ? new Date(fromDate) : null;
      const endLimit = toDate ? new Date(toDate) : null;

      // Se define filtro de solapamiento para asegurar que se incluyan asignaciones de largo aliento
      const dateConditions = [];
      if (startLimit && endLimit) {
        dateConditions.push(
          { weekStartDate: { $gte: startLimit, $lte: endLimit } },
          { weekEndDate: { $gte: startLimit, $lte: endLimit } },
          { weekStartDate: { $lte: startLimit }, weekEndDate: { $gte: endLimit } }
        );
      } else if (startLimit) {
        dateConditions.push(
          { weekEndDate: { $gte: startLimit } },
          { weekStartDate: { $gte: startLimit } }
        );
      } else if (endLimit) {
        dateConditions.push(
          { weekStartDate: { $lte: endLimit } }
        );
      }

      if (dateConditions.length > 0) {
        filter.$or = dateConditions;
      }
    }
    filter.isPaused = { $ne: true };

    const parsedLimit = parsePositiveInt(limit, 0, 1000);
    let query = ShiftAssignment.find(filter)
      .populate('userId', 'fullName email phone cargoLabel')
      .populate('externalPersonId', 'name email phone position')
      .sort({ weekStartDate: -1 });
    if (parsedLimit > 0) {
      query = query.limit(parsedLimit);
    }
    const assignments = await query;

    await audit(req, {
      event: 'escalation.admin.assignments.read',
      result: { success: true },
      metadata: {
        roleCode: roleCode || null,
        fromDate: fromDate || null,
        toDate: toDate || null,
        limit: parsedLimit || null,
        count: assignments.length
      }
    }).catch((auditError) => {
      logger.warn({ err: auditError }, 'No se pudo registrar auditoría de asignaciones de turno');
    });

    res.json(assignments);
  } catch (error) {
    logger.error('Error in getAssignments:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.downloadAssignmentTemplateCsv = async (_req, res) => {
  const csv = formatShiftAssignmentsTemplateCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="turnos-internos-template.csv"');
  return res.status(200).send(`\ufeff${csv}`);
};

exports.importAssignmentsCsv = async (req, res) => {
  try {
    await restoreExpiredAbsencePauses();

    const csvText = req.file?.buffer
      ? req.file.buffer.toString('utf8')
      : String(req.body?.csvText || '');

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'Adjunta un archivo CSV válido' });
    }

    const parsed = parseShiftAssignmentsCsv(csvText);
    if (parsed.errors.length > 0 && parsed.rows.length === 0) {
      return res.status(400).json({ error: parsed.errors[0].message, errors: parsed.errors });
    }

    const results = {
      created: 0,
      updated: 0,
      errorCount: parsed.errors.length,
      errors: [...parsed.errors]
    };

    for (const row of parsed.rows) {
      try {
        let rawRol = String(row.rol || row.rolecode || '').trim().toUpperCase();
        if (rawRol === 'TELETRABAJO') rawRol = 'TELEWORK';
        if (rawRol === 'CHARLA/CAPACITACION' || rawRol === 'CHARLA/CAPACITACIÓN' || rawRol === 'CAPACITACION' || rawRol === 'CAPACITACIÓN' || rawRol === 'CHARLA') rawRol = 'OL';
        if (rawRol === 'VACACIONES') rawRol = 'VACATION';
        if (rawRol === 'LICENCIA MEDICA' || rawRol === 'LICENCIA MÉDICA' || rawRol === 'LICENCIA_MEDICA') rawRol = 'MEDICAL_LEAVE';
        if (rawRol === 'TRAMITE MEDICO' || rawRol === 'TRÁMITE MÉDICO' || rawRol === 'TRAMITE_MEDICO' || rawRol === 'TRÁMITE MEDICO') rawRol = 'MEDICAL_APPOINTMENT';
        const roleCode = rawRol === 'N1' ? 'N1_NO_HABIL' : rawRol;
        // Validar que la condición ingresada esté dentro del listado permitido de valores administrativos y técnicos
        if (!['N2', 'TI', 'N1_NO_HABIL', 'TELEWORK', 'OL', 'VACATION', 'MEDICAL_LEAVE', 'MEDICAL_APPOINTMENT'].includes(roleCode)) {
          throw new Error(`Condición inválida: ${rawRol}. Usa N1, N2, TI, Teletrabajo, Charla/Capacitación (OL), Vacaciones, Trámite Médico o Licencia médica`);
        }

        const weekStartDate = buildAssignmentDateTime(row.fechainicio || row.weekstartdate, row.horainicio || row.weekstarttime);
        const weekEndDate = buildAssignmentDateTime(row.fechafin || row.weekenddate, row.horafin || row.weekendtime);

        if (!weekStartDate || !weekEndDate) {
          throw new Error('Fechas u horas inválidas. Usa formato YYYY-MM-DD y HH:MM');
        }

        if (weekEndDate <= weekStartDate) {
          throw new Error('La fecha/hora de término debe ser mayor a la de inicio');
        }

        const assignee = await resolveAssignmentAssignee(row);
        if (assignee.user && !cargoMatchesRoleCode(assignee.user.cargoLabel, roleCode)) {
          throw new Error(`El usuario ${assignee.label} no tiene cargo compatible con el rol ${roleCode}`);
        }

        const assigneeFilter = assignee.userId ? { userId: assignee.userId } : { externalPersonId: assignee.externalPersonId };

        if (roleCode === ROLE_MEDICAL_LEAVE) {
          const overlappingMedicalLeave = await findOverlappingMedicalLeave({
            assigneeFilter,
            weekStartDate,
            weekEndDate
          });
          if (overlappingMedicalLeave) {
            throw new Error('El analista ya tiene una Licencia médica registrada en este período.');
          }
        } else if (roleCode === ROLE_VACATION) {
          const medicalLeave = await findOverlappingMedicalLeave({
            assigneeFilter,
            weekStartDate,
            weekEndDate
          });
          if (medicalLeave) {
            throw new Error('El analista está en Licencia médica en este período.');
          }

          await ShiftAssignment.deleteMany({
            ...assigneeFilter,
            roleCode: { $ne: ROLE_MEDICAL_LEAVE },
            weekStartDate: { $lt: weekEndDate },
            weekEndDate: { $gt: weekStartDate }
          });
        } else {
          // Si no es ausencia, validar que no tenga ausencias en el período solicitado
          const onAbsence = await ShiftAssignment.findOne({
            ...assigneeFilter,
            roleCode: { $in: ABSENCE_ROLE_CODES },
            isPaused: { $ne: true },
            weekStartDate: { $lt: weekEndDate },
            weekEndDate: { $gt: weekStartDate }
          });
          if (onAbsence) {
            const absenceLabel = onAbsence.roleCode === 'MEDICAL_LEAVE' ? 'Licencia médica' : 'Vacaciones';
            throw new Error(`El analista está en ${absenceLabel} en este período.`);
          }
        }

        const payload = {
          roleCode,
          weekStartDate,
          weekEndDate,
          userId: assignee.userId,
          externalPersonId: assignee.externalPersonId
        };

        const existing = await findAssignmentConflict({ roleCode, weekStartDate, weekEndDate });
        let savedAssignment = null;
        if (existing) {
          savedAssignment = await ShiftAssignment.findByIdAndUpdate(existing._id, payload, { new: true, runValidators: true });
          results.updated += 1;
        } else {
          const assignment = new ShiftAssignment(payload);
          await assignment.save();
          savedAssignment = assignment;
          results.created += 1;
        }

        if (roleCode === ROLE_MEDICAL_LEAVE && savedAssignment?._id) {
          await pauseAssignmentsForMedicalLeave({
            medicalLeaveId: savedAssignment._id,
            assigneeFilter,
            weekStartDate,
            weekEndDate
          });
        }
      } catch (error) {
        results.errorCount += 1;
        results.errors.push({ row: row.rowNumber, message: error.message });
      }
    }

    await audit(req, {
      event: 'directory.assignment.import_csv',
      level: results.errorCount > 0 ? 'warn' : 'info',
      result: {
        success: results.created > 0 || results.updated > 0,
        reason: results.errorCount > 0 ? 'CSV import completed with observations' : 'CSV import completed'
      },
      metadata: {
        created: results.created,
        updated: results.updated,
        errorCount: results.errorCount
      }
    });

    return res.status(200).json({
      message: 'CSV de turnos procesado',
      ...results
    });
  } catch (error) {
    logger.error('Error in importAssignmentsCsv:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.createAssignment = async (req, res) => {
  try {
    await restoreExpiredAbsencePauses();

    const weekStartDate = new Date(req.body.weekStartDate);
    const weekEndDate = new Date(req.body.weekEndDate);

    if (Number.isNaN(weekStartDate.getTime()) || Number.isNaN(weekEndDate.getTime())) {
      return res.status(400).json({ error: 'Fechas de asignación inválidas' });
    }

    const assigneeFilter = req.body.userId ? { userId: req.body.userId } : { externalPersonId: req.body.externalPersonId };

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

    // Reglas de compatibilidad por tipo de condición
    if (req.body.roleCode === ROLE_MEDICAL_LEAVE) {
      const overlappingMedicalLeave = await findOverlappingMedicalLeave({
        assigneeFilter,
        weekStartDate,
        weekEndDate
      });

      if (overlappingMedicalLeave) {
        return res.status(409).json({
          error: `El analista ya tiene una Licencia médica registrada en este período (${new Date(overlappingMedicalLeave.weekStartDate).toLocaleDateString('es-CL')} - ${new Date(overlappingMedicalLeave.weekEndDate).toLocaleDateString('es-CL')}).`
        });
      }
    } else if (req.body.roleCode === ROLE_VACATION) {
      const medicalLeave = await findOverlappingMedicalLeave({
        assigneeFilter,
        weekStartDate,
        weekEndDate
      });

      if (medicalLeave) {
        return res.status(409).json({
          error: `El analista está en Licencia médica en este período (${new Date(medicalLeave.weekStartDate).toLocaleDateString('es-CL')} - ${new Date(medicalLeave.weekEndDate).toLocaleDateString('es-CL')}).`
        });
      }
    } else {
      const onAbsence = await ShiftAssignment.findOne({
        ...assigneeFilter,
        roleCode: { $in: ABSENCE_ROLE_CODES },
        isPaused: { $ne: true },
        weekStartDate: { $lte: weekEndDate },
        weekEndDate: { $gte: weekStartDate }
      });
      if (onAbsence) {
        const absenceLabel = onAbsence.roleCode === 'MEDICAL_LEAVE' ? 'Licencia médica' : 'Vacaciones';
        return res.status(409).json({
          error: `El analista ya está registrado en ${absenceLabel} en este período (${new Date(onAbsence.weekStartDate).toLocaleDateString('es-CL')} - ${new Date(onAbsence.weekEndDate).toLocaleDateString('es-CL')}).`
        });
      }
    }

    let absenceAutoCleaned = false;
    let pausedAssignmentsCount = 0;

    const conflict = await findAssignmentConflict({
      roleCode: req.body.roleCode,
      weekStartDate,
      weekEndDate
    });

    let assignment;
    if (conflict) {
      // Si ya existe una asignación conflictiva, se sobrescribe (actualiza)
      assignment = await ShiftAssignment.findByIdAndUpdate(conflict._id, req.body, { new: true, runValidators: true });
    } else {
      assignment = new ShiftAssignment(req.body);
      await assignment.save();
    }

    if (req.body.roleCode === ROLE_MEDICAL_LEAVE) {
      pausedAssignmentsCount = await pauseAssignmentsForMedicalLeave({
        medicalLeaveId: assignment._id,
        assigneeFilter,
        weekStartDate,
        weekEndDate
      });

      if (pausedAssignmentsCount > 0) {
        absenceAutoCleaned = true;
      }
    } else if (req.body.roleCode === ROLE_VACATION) {
      pausedAssignmentsCount = await pauseAssignmentsForVacation({
        vacationId: assignment._id,
        assigneeFilter,
        weekStartDate,
        weekEndDate
      });

      if (pausedAssignmentsCount > 0) {
        absenceAutoCleaned = true;
      }
    }

    await assignment.populate('userId', 'fullName email phone cargoLabel');
    await assignment.populate('externalPersonId', 'name email phone position');
    logger.info('Shift assignment created:', { assignmentId: assignment._id, roleCode: assignment.roleCode });

    const responseObj = assignment.toObject();
    if (absenceAutoCleaned) {
      responseObj.vacationAutoCleaned = true;
      responseObj.absenceAutoCleaned = true;
      responseObj.pausedAssignmentsCount = pausedAssignmentsCount;
      if (req.body.roleCode === ROLE_MEDICAL_LEAVE) {
        responseObj.message = `Licencia médica registrada. Se pausaron automáticamente ${pausedAssignmentsCount} turno(s) previo(s) del analista en este período.`;
      } else {
        responseObj.message = `Turno de vacaciones registrado. Se pausaron automáticamente ${pausedAssignmentsCount} turno(s) previo(s) del analista en este período.`;
      }
    }

    res.status(201).json(responseObj);
  } catch (error) {
    logger.error('Error in createAssignment:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    await restoreExpiredAbsencePauses();

    const { id } = req.params;

    const existing = await ShiftAssignment.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Shift assignment not found' });
    }

    const roleCode = req.body.roleCode || existing.roleCode;
    const weekStartDate = req.body.weekStartDate ? new Date(req.body.weekStartDate) : new Date(existing.weekStartDate);
    const weekEndDate = req.body.weekEndDate ? new Date(req.body.weekEndDate) : new Date(existing.weekEndDate);
    const userId = req.body.userId !== undefined ? req.body.userId : existing.userId;
    const externalPersonId = req.body.externalPersonId !== undefined ? req.body.externalPersonId : existing.externalPersonId;

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

    const assigneeFilter = userId ? { userId: userId } : { externalPersonId: externalPersonId };

    // Reglas de compatibilidad por tipo de condición
    if (roleCode === ROLE_MEDICAL_LEAVE) {
      const overlappingMedicalLeave = await findOverlappingMedicalLeave({
        assigneeFilter,
        weekStartDate,
        weekEndDate,
        excludeId: id
      });

      if (overlappingMedicalLeave) {
        return res.status(409).json({
          error: `El analista ya tiene una Licencia médica registrada en este período (${new Date(overlappingMedicalLeave.weekStartDate).toLocaleDateString('es-CL')} - ${new Date(overlappingMedicalLeave.weekEndDate).toLocaleDateString('es-CL')}).`
        });
      }
    } else if (roleCode === ROLE_VACATION) {
      const medicalLeave = await findOverlappingMedicalLeave({
        assigneeFilter,
        weekStartDate,
        weekEndDate,
        excludeId: id
      });

      if (medicalLeave) {
        return res.status(409).json({
          error: `El analista está en Licencia médica en este período (${new Date(medicalLeave.weekStartDate).toLocaleDateString('es-CL')} - ${new Date(medicalLeave.weekEndDate).toLocaleDateString('es-CL')}).`
        });
      }
    } else {
      const onAbsence = await ShiftAssignment.findOne({
        ...assigneeFilter,
        roleCode: { $in: ABSENCE_ROLE_CODES },
        isPaused: { $ne: true },
        weekStartDate: { $lte: weekEndDate },
        weekEndDate: { $gte: weekStartDate },
        _id: { $ne: id }
      });
      if (onAbsence) {
        const absenceLabel = onAbsence.roleCode === 'MEDICAL_LEAVE' ? 'Licencia médica' : 'Vacaciones';
        return res.status(409).json({
          error: `El analista ya está registrado en ${absenceLabel} en este período (${new Date(onAbsence.weekStartDate).toLocaleDateString('es-CL')} - ${new Date(onAbsence.weekEndDate).toLocaleDateString('es-CL')}).`
        });
      }
    }

    let absenceAutoCleaned = false;
    let pausedAssignmentsCount = 0;
    let restoredAssignmentsCount = 0;

    // Si esta asignación era licencia médica o vacaciones, restaurar primero su estado pausado anterior
    if (existing.roleCode === ROLE_MEDICAL_LEAVE) {
      restoredAssignmentsCount = await restoreAssignmentsPausedByMedicalLeave(existing._id);
    } else if (existing.roleCode === ROLE_VACATION) {
      restoredAssignmentsCount = await restoreAssignmentsPausedByVacation(existing._id);
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
      .populate('userId', 'fullName email phone cargoLabel')
      .populate('externalPersonId', 'name email phone position');

    // Si la asignación final es licencia médica o vacaciones, volver a pausar según su nuevo rango.
    if (roleCode === ROLE_MEDICAL_LEAVE) {
      pausedAssignmentsCount = await pauseAssignmentsForMedicalLeave({
        medicalLeaveId: assignment._id,
        assigneeFilter,
        weekStartDate,
        weekEndDate
      });
    } else if (roleCode === ROLE_VACATION) {
      pausedAssignmentsCount = await pauseAssignmentsForVacation({
        vacationId: assignment._id,
        assigneeFilter,
        weekStartDate,
        weekEndDate
      });
    }

    if (pausedAssignmentsCount > 0 || restoredAssignmentsCount > 0) {
      absenceAutoCleaned = true;
    }

    logger.info('Shift assignment updated:', { assignmentId: assignment._id, roleCode: assignment.roleCode });

    const responseObj = assignment.toObject();
    if (absenceAutoCleaned) {
      responseObj.vacationAutoCleaned = true;
      responseObj.absenceAutoCleaned = true;
      responseObj.pausedAssignmentsCount = pausedAssignmentsCount;
      responseObj.restoredAssignmentsCount = restoredAssignmentsCount;
      if (roleCode === ROLE_MEDICAL_LEAVE) {
        responseObj.message = `Licencia médica actualizada. Se pausaron ${pausedAssignmentsCount} turno(s) y se reactivaron ${restoredAssignmentsCount} turno(s) previos según el nuevo período.`;
      } else if (roleCode === ROLE_VACATION) {
        responseObj.message = `Turno de vacaciones actualizado. Se pausaron ${pausedAssignmentsCount} turno(s) y se reactivaron ${restoredAssignmentsCount} turno(s) previos según el nuevo período.`;
      } else if ((existing.roleCode === ROLE_MEDICAL_LEAVE || existing.roleCode === ROLE_VACATION) && restoredAssignmentsCount > 0) {
        responseObj.message = `Asignación actualizada. Se reactivaron ${restoredAssignmentsCount} turno(s) que estaban en pausa por la ausencia anterior.`;
      }
    }

    res.json(responseObj);
  } catch (error) {
    logger.error('Error in updateAssignment:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const assignment = await ShiftAssignment.findById(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Shift assignment not found' });
    }

    let restoredAssignmentsCount = 0;
    if (assignment.roleCode === ROLE_MEDICAL_LEAVE) {
      restoredAssignmentsCount = await restoreAssignmentsPausedByMedicalLeave(assignment._id);
    } else if (assignment.roleCode === ROLE_VACATION) {
      restoredAssignmentsCount = await restoreAssignmentsPausedByVacation(assignment._id);
    }

    await ShiftAssignment.findByIdAndDelete(id);

    logger.info('Shift assignment deleted:', { assignmentId: assignment._id });
    if (restoredAssignmentsCount > 0) {
      const typeLabel = assignment.roleCode === ROLE_MEDICAL_LEAVE ? 'Licencia médica' : 'Vacación';
      return res.json({
        message: `${typeLabel} eliminada. Se reactivaron ${restoredAssignmentsCount} turno(s) que estaban en pausa.`,
        restoredAssignmentsCount
      });
    }

    res.json({ message: 'Shift assignment deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteAssignment:', error);
    res.status(500).json({ error: error.message });
  }
};

// Elimina múltiples asignaciones de forma segura restaurando pausas asociadas a licencias médicas o vacaciones
exports.bulkDeleteAssignments = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Lista de IDs inválida o vacía' });
    }

    const assignments = await ShiftAssignment.find({ _id: { $in: ids } });
    if (assignments.length === 0) {
      return res.status(404).json({ error: 'No se encontraron asignaciones para eliminar' });
    }

    let restoredAssignmentsCount = 0;
    const foundIds = assignments.map(a => String(a._id));

    // Restaurar turnos pausados para todas las ausencias que van a ser eliminadas
    for (const assignment of assignments) {
      if (assignment.roleCode === ROLE_MEDICAL_LEAVE) {
        const count = await restoreAssignmentsPausedByMedicalLeave(assignment._id);
        restoredAssignmentsCount += count;
      } else if (assignment.roleCode === ROLE_VACATION) {
        const count = await restoreAssignmentsPausedByVacation(assignment._id);
        restoredAssignmentsCount += count;
      }
    }

    const deleteResult = await ShiftAssignment.deleteMany({ _id: { $in: foundIds } });

    logger.info('Shift assignments bulk deleted:', { count: deleteResult.deletedCount, restoredCount: restoredAssignmentsCount });

    res.json({
      message: `Se eliminaron correctamente ${deleteResult.deletedCount} asignación(es).${restoredAssignmentsCount > 0 ? ` Se reactivaron ${restoredAssignmentsCount} turno(s) pausado(s).` : ''}`,
      deletedCount: deleteResult.deletedCount,
      restoredCount: restoredAssignmentsCount
    });
  } catch (error) {
    logger.error('Error in bulkDeleteAssignments:', error);
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
    await syncDirectoryContact({
      name: person.name,
      email: person.email,
      phone: person.phone,
      position: person.position,
      type: 'External'
    });
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
    await syncDirectoryContact({
      name: person.name,
      email: person.email,
      phone: person.phone,
      position: person.position,
      type: 'External'
    });
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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📅 AUTOMATIZACIÓN DE TURNOS (ESC-SHIFT-111)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Endpoint manual para disparar el envío de turnos
 */
exports.triggerEscalationScheduleSend = async (req, res) => {
  try {
    const config = await AppConfig.findOne();
    if (!config) {
      return res.status(400).json({ error: 'La aplicación no ha sido configurada aún. Contacta a un administrador.' });
    }

    const automation = config.escalationScheduleAutomation || {};

    // Allow frontend to pass recipients override (e.g. from unsaved form state)
    const parseEmailList = (raw) => {
      if (Array.isArray(raw)) return raw.map((s) => String(s || '').trim().toLowerCase()).filter((s) => s.includes('@'));
      if (typeof raw === 'string') return raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
      return [];
    };

    const recipients = req.body?.recipients
      ? parseEmailList(req.body.recipients)
      : parseEmailList(automation.recipients);
    const ccRecipients = req.body?.ccRecipients
      ? parseEmailList(req.body.ccRecipients)
      : parseEmailList(automation.ccRecipients);

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No hay destinatarios válidos configurados para el envío automático.' });
    }

    const result = await exports.sendEscalationScheduleInternal({
      recipients,
      ccRecipients,
      frequency: automation.frequency || 'weekly'
    });

    if (result.success) {
      // Actualizar última fecha de envío
      await AppConfig.updateOne({}, { 
        $set: { 'escalationScheduleAutomation.lastSentAt': new Date() } 
      });
      
      return res.json({ message: 'Envío de turnos procesado correctamente', messageId: result.messageId });
    } else {
      return res.status(500).json({ error: 'Error al enviar el correo de turnos', details: result.error });
    }
  } catch (error) {
    logger.error('Error in triggerEscalationScheduleSend:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Lógica compartida para generar y enviar el reporte de turnos
 */
exports.sendEscalationScheduleInternal = async ({ name, recipients, ccRecipients, frequency = 'weekly', roleFilter = [] }) => {
  try {
    await restoreExpiredMedicalLeavePauses();

    const now = new Date();
    let startDate = new Date(now);
    let endDate = new Date(now);

    if (frequency === 'monthly') {
      // Mes calendario actual
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else {
      // Semana operativa real: lunes actual 09:00 al lunes subsiguiente 08:59
      const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
      
      startDate.setDate(now.getDate() + daysToMonday);
      startDate.setHours(9, 0, 0, 0); // Lunes 09:00
      
      endDate.setDate(now.getDate() + daysToSunday + 1); // Lunes subsiguiente
      endDate.setHours(8, 59, 59, 999); // Lunes subsiguiente a las 08:59
    }

    const periodLabel = frequency === 'monthly'
      ? `Periodo Mensual: ${startDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}`
      : `Periodo Semanal: ${startDate.toLocaleDateString('es-CL')} - ${new Date(endDate.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('es-CL')}`; // Etiqueta muestra Lun - Dom

    const appConfig = await AppConfig.findOne().select('logoUrl appTitle').lean();
    const brandName = String(appConfig?.appTitle || 'Bitácora CDC').trim() || 'Bitácora CDC';
    const logoWebPath = resolveUploadedLogoWebPath(appConfig?.logoUrl);
    const attachments = [];
    let logoCid = null;

    if (logoWebPath) {
      const logoBuffer = await readUploadedLogoFromWebPath(logoWebPath);
      if (logoBuffer && logoBuffer.length) {
        const logoContentType = contentTypeFromLogoFilename(logoWebPath);
        const logoExtension = logoContentType === 'image/jpeg'
          ? 'jpg'
          : logoContentType === 'image/webp'
            ? 'webp'
            : logoContentType === 'image/gif'
              ? 'gif'
              : logoContentType === 'image/svg+xml'
                ? 'svg'
                : 'png';
        const logoContentId = 'bitacora_escalation_logo@bitacora';
        attachments.push({
          filename: `logo-escalation.${logoExtension}`,
          content: logoBuffer,
          cid: logoContentId,
          contentType: logoContentType,
          contentDisposition: 'inline'
        });
        logoCid = `cid:${logoContentId}`;
      }
    }

    // Obtener asignaciones en el rango
    const assignments = await ShiftAssignment.find({
      isPaused: { $ne: true },
      $or: [
        { weekStartDate: { $gte: startDate, $lte: endDate } },
        { weekEndDate: { $gte: startDate, $lte: endDate } },
        { weekStartDate: { $lte: startDate }, weekEndDate: { $gte: endDate } }
      ]
    })
    .populate('userId', 'fullName cargoLabel')
    .populate('externalPersonId', 'name email')
    .sort({ weekStartDate: 1 });

    // Filtrar asignaciones según los roles especificados en la programación de notificaciones.
    // Si no se define filtro, por compatibilidad retrospectiva se asumen los roles de guardia tradicionales.
    const targetRoles = (Array.isArray(roleFilter) && roleFilter.length > 0)
      ? roleFilter.map(r => String(r || '').toUpperCase())
      : INTERNAL_SHIFT_ROLE_CODES;

    // Generar etiqueta de categorías dinámicas agrupadas en base al filtro seleccionado para el correo
    const categoriesList = [];
    const hasGuardRoles = Array.isArray(roleFilter) && roleFilter.some(r => ['N2', 'TI', 'N1_NO_HABIL'].includes(r));
    if (hasGuardRoles) {
      categoriesList.push('GUARDIA');
    }
    if (Array.isArray(roleFilter)) {
      if (roleFilter.includes('TELEWORK')) {
        categoriesList.push('TELETRABAJO');
      }
      if (roleFilter.includes('OL')) {
        categoriesList.push('CHARLA/CAPACITACIÓN');
      }
      if (roleFilter.includes('VACATION')) {
        categoriesList.push('VACACIONES');
      }
      if (roleFilter.includes('MEDICAL_LEAVE')) {
        categoriesList.push('LICENCIA MÉDICA');
      }
      if (roleFilter.includes('MEDICAL_APPOINTMENT')) {
        categoriesList.push('TRÁMITE MÉDICO');
      }
    }

    const categoriesLabel = categoriesList.length > 0
      ? categoriesList.join(' / ')
      : 'CALENDARIO';

    // Identificar IDs de analistas con licencias médicas o vacaciones activas en este periodo
    const absentUserIds = new Set();
    const absentExtIds = new Set();

    assignments.forEach(asg => {
      const isAbsence = ['MEDICAL_LEAVE', 'VACATION'].includes(String(asg.roleCode || '').toUpperCase());
      if (isAbsence) {
        if (asg.userId) absentUserIds.add(String(asg.userId._id || asg.userId));
        if (asg.externalPersonId) absentExtIds.add(String(asg.externalPersonId._id || asg.externalPersonId));
      }
    });

    const filterHasVacation = targetRoles.includes('VACATION');
    const filterHasMedical = targetRoles.includes('MEDICAL_LEAVE');

    const overlappingInternalAssignments = assignments.filter((assignment) => {
      const overlapsRequestedPeriod = assignment.weekStartDate <= endDate && assignment.weekEndDate >= startDate;
      const isTargetRole = targetRoles.includes(String(assignment.roleCode || '').toUpperCase());
      const hasAssignedPerson = !!assignment.userId || !!assignment.externalPersonId;
      
      if (!overlapsRequestedPeriod || !isTargetRole || !hasAssignedPerson) return false;

      // Omitir el registro de ausencia en sí mismo de este reporte general solo si el filtro NO las incluye explícitamente
      const isAbsence = ['VACATION', 'MEDICAL_LEAVE'].includes(String(assignment.roleCode || '').toUpperCase());
      if (isAbsence && !filterHasVacation && !filterHasMedical) return false;

      // Omitir cualquier turno regular a nombre de una persona ausente (licencia o vacaciones) en este periodo
      // solo si el reporte NO tiene como objetivo listar ausencias.
      const userId = assignment.userId?._id || assignment.userId;
      const extId = assignment.externalPersonId?._id || assignment.externalPersonId;
      const isRegularShift = !isAbsence;
      if (isRegularShift && (!filterHasVacation || !filterHasMedical)) {
        if (userId && absentUserIds.has(String(userId))) return false;
        if (extId && absentExtIds.has(String(extId))) return false;
      }

      return true;
    });

    // Mantener todos los turnos legítimos sin deduplicación destructiva
    let selectedAssignments = [...overlappingInternalAssignments];

    selectedAssignments.sort((left, right) => {
      const leftOrder = SHIFT_ROLE_ORDER[String(left.roleCode || '').toUpperCase()] || 99;
      const rightOrder = SHIFT_ROLE_ORDER[String(right.roleCode || '').toUpperCase()] || 99;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return new Date(left.weekStartDate).getTime() - new Date(right.weekStartDate).getTime();
    });

    const scheduleData = selectedAssignments.map((assignment) => {
      const isCurrent = assignment.weekStartDate <= now && assignment.weekEndDate >= now;
      let analystName = 'Pendiente';
      let cargoLabel = assignment.roleCode || '-';
      
      if (assignment.userId) {
        analystName = assignment.userId.fullName || 'Pendiente';
        cargoLabel = assignment.userId.cargoLabel || assignment.roleCode || '-';
      } else if (assignment.externalPersonId) {
        analystName = assignment.externalPersonId.name || 'Pendiente';
        cargoLabel = assignment.roleCode || '-';
      }

      return {
        analystName,
        startDate: assignment.weekStartDate,
        endDate: assignment.weekEndDate,
        cargoLabel,
        roleCode: assignment.roleCode,
        isCurrent
      };
    });

    const reportTitle = name || 'Turnos de Escalamiento SOC';
    const emailSubject = `[${brandName}] ${reportTitle} - ${periodLabel}`;

    logger.info('Generación de reporte automatizado de turnos', {
      reportTitle,
      periodLabel,
      assignmentsFound: assignments.length,
      overlappingInternalAssignments: overlappingInternalAssignments.length,
      selectedAssignments: selectedAssignments.length,
      scheduleDataMapped: scheduleData.length,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    if (scheduleData.length === 0) {
      logger.warn('No hay turnos programados para el periodo', { periodLabel });
      const emptyScheduleData = [{
        analystName: 'Sin asignaciones',
        startDate: startDate,
        endDate: endDate,
        cargoLabel: '-',
        isCurrent: false
      }];
      
      const emptyScheduleEmailBuild = await buildEscalationScheduleEmail({
        schedule: emptyScheduleData,
        periodLabel,
        logoCid,
        brandName,
        title: reportTitle,
        categoriesLabel
      });

      const emailResult = await sendEmail({
        to: recipients,
        cc: ccRecipients,
        subject: emailSubject,
        html: emptyScheduleEmailBuild.html,
        attachments: attachments.length ? attachments : undefined,
        auditContext: {
          sourceModule: 'escalation-automation',
          triggerType: 'schedule',
          status: 'empty_schedule'
        }
      });
      
      return { success: true, messageId: emailResult.messageId, warning: 'No hay turnos para este periodo' };
    }

    const emailBuild = await buildEscalationScheduleEmail({
      schedule: scheduleData,
      periodLabel,
      logoCid,
      brandName,
      title: reportTitle,
      categoriesLabel
    });

    if (emailBuild.errors && emailBuild.errors.length > 0) {
      logger.warn('Advertencias de compilación MJML para correo de turnos', {
        errors: emailBuild.errors,
        scheduleDataCount: scheduleData.length
      });
    }

    const { html } = emailBuild;

    const emailResult = await sendEmail({
      to: recipients,
      cc: ccRecipients,
      subject: emailSubject,
      html,
      attachments: attachments.length ? attachments : undefined,
      auditContext: {
        sourceModule: 'escalation-automation',
        triggerType: 'schedule'
      }
    });

    return { success: true, messageId: emailResult.messageId };
  } catch (error) {
    logger.error('Error en sendEscalationScheduleInternal:', error);
    return { success: false, error: error.message };
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 CRUD ADMIN - Programación de Notificaciones de Turnos (ShiftNotificationSchedule)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Obtiene la lista completa de todas las programaciones de notificaciones de turnos.
 */
exports.getNotificationSchedules = async (req, res) => {
  try {
    const schedules = await ShiftNotificationSchedule.find().sort({ createdAt: -1 });
    res.json(schedules);
  } catch (error) {
    logger.error('Error en getNotificationSchedules:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Crea una nueva programación de notificación automatizada.
 */
exports.createNotificationSchedule = async (req, res) => {
  try {
    const { name, enabled, frequency, dayOfWeek, time, recipients, ccRecipients, roleFilter } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }

    const schedule = new ShiftNotificationSchedule({
      name,
      enabled: enabled ?? true,
      frequency: frequency || 'weekly',
      dayOfWeek: dayOfWeek ?? 1,
      time: time || '09:00',
      recipients: Array.isArray(recipients) ? recipients : [],
      ccRecipients: Array.isArray(ccRecipients) ? ccRecipients : [],
      roleFilter: Array.isArray(roleFilter) ? roleFilter : []
    });

    await schedule.save();

    await audit(req, {
      event: 'escalation.notification_schedule.create',
      result: { success: true },
      metadata: { id: schedule._id, name: schedule.name }
    }).catch(auditError => logger.warn({ err: auditError }, 'Error al registrar auditoría de creación de notificación'));

    res.status(201).json(schedule);
  } catch (error) {
    logger.error('Error en createNotificationSchedule:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Actualiza los campos de una programación de notificación existente por su ID.
 */
exports.updateNotificationSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, enabled, frequency, dayOfWeek, time, recipients, ccRecipients, roleFilter } = req.body;

    const schedule = await ShiftNotificationSchedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ error: 'Programación no encontrada' });
    }

    if (name !== undefined) schedule.name = name;
    if (enabled !== undefined) schedule.enabled = enabled;
    if (frequency !== undefined) schedule.frequency = frequency;
    if (dayOfWeek !== undefined) schedule.dayOfWeek = dayOfWeek;
    if (time !== undefined) schedule.time = time;
    if (recipients !== undefined) schedule.recipients = Array.isArray(recipients) ? recipients : [];
    if (ccRecipients !== undefined) schedule.ccRecipients = Array.isArray(ccRecipients) ? ccRecipients : [];
    if (roleFilter !== undefined) schedule.roleFilter = Array.isArray(roleFilter) ? roleFilter : [];

    await schedule.save();

    await audit(req, {
      event: 'escalation.notification_schedule.update',
      result: { success: true },
      metadata: { id: schedule._id, name: schedule.name }
    }).catch(auditError => logger.warn({ err: auditError }, 'Error al registrar auditoría de actualización de notificación'));

    res.json(schedule);
  } catch (error) {
    logger.error('Error en updateNotificationSchedule:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Elimina de manera lógica/física una programación de notificación por su ID.
 */
exports.deleteNotificationSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await ShiftNotificationSchedule.findByIdAndDelete(id);
    if (!schedule) {
      return res.status(404).json({ error: 'Programación no encontrada' });
    }

    await audit(req, {
      event: 'escalation.notification_schedule.delete',
      result: { success: true },
      metadata: { id: schedule._id, name: schedule.name }
    }).catch(auditError => logger.warn({ err: auditError }, 'Error al registrar auditoría de eliminación de notificación'));

    res.json({ message: 'Programación eliminada correctamente' });
  } catch (error) {
    logger.error('Error en deleteNotificationSchedule:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Dispara manualmente el envío de una programación de turnos específica.
 */
exports.triggerNotificationScheduleSend = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await ShiftNotificationSchedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ error: 'Programación no encontrada' });
    }

    // Procesar listas de correos pasadas temporalmente para sobrescribir (caso de pruebas)
    const parseEmailList = (raw) => {
      if (Array.isArray(raw)) return raw.map((s) => String(s || '').trim().toLowerCase()).filter((s) => s.includes('@'));
      if (typeof raw === 'string') return raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
      return [];
    };

    const recipients = req.body?.recipients
      ? parseEmailList(req.body.recipients)
      : schedule.recipients;
    const ccRecipients = req.body?.ccRecipients
      ? parseEmailList(req.body.ccRecipients)
      : schedule.ccRecipients;

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No hay destinatarios válidos configurados.' });
    }

    const name = req.body?.name || schedule.name;
    const roleFilter = req.body?.roleFilter || schedule.roleFilter;

    const result = await exports.sendEscalationScheduleInternal({
      name,
      recipients,
      ccRecipients,
      frequency: schedule.frequency,
      roleFilter
    });

    if (result.success) {
      const isTest = req.body?.isTest === true;
      if (!isTest) {
        // Actualizar la fecha del último envío real si no es de prueba
        schedule.lastSentAt = new Date();
        await schedule.save();
      }

      await audit(req, {
        event: 'escalation.notification_schedule.trigger_send',
        result: { success: true },
        metadata: { id: schedule._id, name: schedule.name, recipients }
      }).catch(auditError => logger.warn({ err: auditError }, 'Error al registrar auditoría de envío de notificación'));

      return res.json({ message: 'Envío de turnos procesado correctamente', messageId: result.messageId });
    } else {
      return res.status(500).json({ error: 'Error al enviar el correo de turnos', details: result.error });
    }
  } catch (error) {
    logger.error('Error en triggerNotificationScheduleSend:', error);
    return res.status(500).json({ error: error.message });
  }
};
