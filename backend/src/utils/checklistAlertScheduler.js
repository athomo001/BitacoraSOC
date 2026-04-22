const AppConfig = require('../models/AppConfig');
const ShiftCheck = require('../models/ShiftCheck');
const ShiftAssignment = require('../models/ShiftAssignment');
const ShiftOverride = require('../models/ShiftOverride');
const User = require('../models/User');
const { logger } = require('./logger');
const { sendChecklistAlertEmail, sendEscalationInternalReminderEmail } = require('../routes/smtp');

const DEFAULT_ALERT_TIME = '09:30';
const DEFAULT_ESCALATION_REMINDER_HOUR = 9;
const DEFAULT_ESCALATION_REMINDER_DAYS_AHEAD = 7;
const INTERNAL_ESCALATION_ROLE_CODES = ['N2', 'TI', 'N1_NO_HABIL'];

const isSameDay = (a, b) => a && b && a.toDateString() === b.toDateString();

const buildCutoffTime = (now, time) => {
  const [hourStr, minuteStr] = (time || DEFAULT_ALERT_TIME).split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const cutoff = new Date(now);
  cutoff.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 30, 0, 0);
  return cutoff;
};

const resolveShiftAssignee = async (roleCode, now) => {
  const override = await ShiftOverride.findOne({
    roleCode,
    active: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  }).populate('replacementUserId', 'fullName username email role cargoLabel');

  if (override && override.replacementUserId?.email) {
    return {
      email: override.replacementUserId.email,
      name: override.replacementUserId.fullName || override.replacementUserId.username || 'Usuario'
    };
  }

  const assignment = await ShiftAssignment.findOne({
    roleCode,
    weekStartDate: { $lte: now },
    weekEndDate: { $gte: now }
  }).populate('userId', 'fullName username email role cargoLabel')
    .populate('externalPersonId', 'name email');

  if (assignment?.userId?.email) {
    return {
      email: assignment.userId.email,
      name: assignment.userId.fullName || assignment.userId.username || 'Usuario'
    };
  }

  if (assignment?.externalPersonId?.email) {
    return {
      email: assignment.externalPersonId.email,
      name: assignment.externalPersonId.name || 'Persona externa'
    };
  }

  return null;
};

const getChecklistAlertRecipients = async (now) => {
  const recipients = new Map();

  const n1Assignee = await resolveShiftAssignee('N1_NO_HABIL', now);
  if (n1Assignee?.email) {
    recipients.set(n1Assignee.email, n1Assignee.name);
  }

  const n2Users = await User.find({
    isActive: true,
    cargoLabel: { $regex: /^N2$/i }
  }).select('email fullName username role cargoLabel');

  n2Users.forEach(user => {
    if (!user.email) return;
    recipients.set(user.email, user.fullName || user.username || 'Usuario');
  });

  return Array.from(recipients.keys());
};

const shouldSendAlert = async (now, config) => {
  if (!config?.checklistAlertEnabled) return false;

  const cutoff = buildCutoffTime(now, config.checklistAlertTime || DEFAULT_ALERT_TIME);
  if (now < cutoff) return false;

  if (config.lastChecklistAlertDate && isSameDay(config.lastChecklistAlertDate, now)) {
    return false;
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const hasCheck = await ShiftCheck.exists({
    type: 'inicio',
    createdAt: { $gte: start, $lte: end }
  });

  return !hasCheck;
};

const runChecklistAlert = async () => {
  try {
    const config = await AppConfig.findOne();
    const now = new Date();

    if (!config) return;
    const shouldSend = await shouldSendAlert(now, config);
    if (!shouldSend) return;

    const recipients = await getChecklistAlertRecipients(now);

    await sendChecklistAlertEmail({
      recipients,
      alertTime: config.checklistAlertTime || DEFAULT_ALERT_TIME,
      dateLabel: now.toLocaleDateString('es-CL')
    });

    config.lastChecklistAlertDate = now;
    await config.save();
  } catch (error) {
    logger.error({ err: error }, 'Error ejecutando alerta de checklist');
  }
};

const normalizeCargoLabel = (value) => String(value || '').trim().toUpperCase();

const toStartOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getStartOfWeekMonday = (value) => {
  const date = toStartOfDay(value);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
};

const getEndOfWeekSunday = (weekStart) => {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};

const getEscalationReminderDaysAhead = (config) => {
  const parsed = Number.parseInt(config?.escalationReminderDaysAhead, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return DEFAULT_ESCALATION_REMINDER_DAYS_AHEAD;
  }
  return Math.min(parsed, 60);
};

const getEscalationReminderRecipients = async (cargoLabels) => {
  const normalized = (cargoLabels || [])
    .map(normalizeCargoLabel)
    .filter(Boolean);

  if (normalized.length === 0) {
    return [];
  }

  const users = await User.find({
    isActive: true,
    email: { $exists: true, $ne: '' },
    cargoLabel: { $exists: true, $ne: '' }
  }).select('email cargoLabel fullName username');

  return users
    .filter((user) => normalized.includes(normalizeCargoLabel(user.cargoLabel)))
    .map((user) => user.email);
};

const resolveFutureWeekGap = async (now, config) => {
  const daysAhead = getEscalationReminderDaysAhead(config);
  const currentWeekStart = getStartOfWeekMonday(now);

  // Calcula el próximo lunes a partir de ahora + daysAhead
  const anchorDate = new Date(now);
  anchorDate.setDate(anchorDate.getDate() + daysAhead);
  
  // Normaliza a inicio del día
  anchorDate.setHours(0, 0, 0, 0);
  
  // Encuentra el próximo lunes desde anchorDate
  const dayOfWeek = anchorDate.getDay(); // 0=domingo, 1=lunes, etc
  let daysToNextMonday = 0;
  
  if (dayOfWeek === 0) {
    // Si es domingo, el próximo lunes es mañana (+1)
    daysToNextMonday = 1;
  } else if (dayOfWeek === 1) {
    // Si ya es lunes, usa este lunes (mismo día)
    daysToNextMonday = 0;
  } else {
    // Si es martes-sábado, calcula días hasta el próximo lunes
    daysToNextMonday = (8 - dayOfWeek);
  }
  
  let targetWeekStart = new Date(anchorDate);
  targetWeekStart.setDate(targetWeekStart.getDate() + daysToNextMonday);
  
  // Asegúrate que no sea la semana actual o anterior
  if (targetWeekStart <= currentWeekStart) {
    targetWeekStart = new Date(currentWeekStart);
    targetWeekStart.setDate(targetWeekStart.getDate() + 7);
  }

  const targetWeekEnd = getEndOfWeekSunday(targetWeekStart);
  const assignments = await ShiftAssignment.find({
    roleCode: { $in: INTERNAL_ESCALATION_ROLE_CODES },
    weekStartDate: { $lte: targetWeekEnd },
    weekEndDate: { $gte: targetWeekStart }
  }).select('roleCode weekStartDate weekEndDate');

  const missingRoleCodes = INTERNAL_ESCALATION_ROLE_CODES.filter((roleCode) => {
    return !assignments.some((assignment) => {
      return assignment.roleCode === roleCode
        && assignment.weekStartDate <= targetWeekStart
        && assignment.weekEndDate >= targetWeekEnd;
    });
  });

  if (missingRoleCodes.length === 0) {
    return null;
  }

  return {
    daysAhead,
    weekStart: targetWeekStart,
    weekEnd: targetWeekEnd,
    missingRoleCodes
  };
};

const shouldSendEscalationReminder = (now, config, futureWeekGap) => {
  if (!config?.escalationReminderEnabled) return false;
  if (!futureWeekGap) return false;

  if (config.lastEscalationReminderDate && isSameDay(config.lastEscalationReminderDate, now)) {
    return false;
  }

  if (config.lastEscalationReminderWeekStartDate) {
    const lastWeekStart = toStartOfDay(config.lastEscalationReminderWeekStartDate);
    const targetWeekStart = toStartOfDay(futureWeekGap.weekStart);
    if (lastWeekStart.getTime() === targetWeekStart.getTime()) {
      return false;
    }
  }

  return now.getHours() >= DEFAULT_ESCALATION_REMINDER_HOUR;
};

const runEscalationInternalReminder = async () => {
  try {
    const config = await AppConfig.findOne();
    const now = new Date();
    if (!config) return;

    const futureWeekGap = await resolveFutureWeekGap(now, config);
    if (!shouldSendEscalationReminder(now, config, futureWeekGap)) {
      if (futureWeekGap?.missingRoleCodes?.length) {
        logger.info({
          event: 'escalation.reminder.skipped',
          reason: 'not_due_yet_or_already_sent',
          targetWeekStart: futureWeekGap.weekStart.toISOString(),
          targetWeekEnd: futureWeekGap.weekEnd.toISOString(),
          missingRoleCodes: futureWeekGap.missingRoleCodes
        }, 'Recordatorio de escalacion interna omitido');
      }
      return;
    }

    const cargoLabels = Array.isArray(config.escalationReminderCargoLabels)
      ? config.escalationReminderCargoLabels
      : ['N2'];

    const recipients = await getEscalationReminderRecipients(cargoLabels);
    if (recipients.length === 0) {
      logger.warn({
        event: 'escalation.reminder.skipped',
        reason: 'no_recipients',
        cargoLabels,
        missingRoleCodes: futureWeekGap.missingRoleCodes,
        targetWeekStart: futureWeekGap.weekStart.toISOString(),
        targetWeekEnd: futureWeekGap.weekEnd.toISOString()
      }, 'Recordatorio de escalacion interna sin destinatarios');
      return;
    }

    await sendEscalationInternalReminderEmail({
      recipients,
      cargoLabels,
      dateLabel: now.toLocaleDateString('es-CL'),
      targetWeekStartLabel: futureWeekGap.weekStart.toLocaleDateString('es-CL'),
      targetWeekEndLabel: futureWeekGap.weekEnd.toLocaleDateString('es-CL'),
      daysAhead: futureWeekGap.daysAhead
    });

    config.lastEscalationReminderDate = now;
    config.lastEscalationReminderWeekStartDate = futureWeekGap.weekStart;
    await config.save();

    logger.info({
      event: 'escalation.reminder.sent',
      recipients,
      cargoLabels,
      missingRoleCodes: futureWeekGap.missingRoleCodes,
      targetWeekStart: futureWeekGap.weekStart.toISOString(),
      targetWeekEnd: futureWeekGap.weekEnd.toISOString(),
      daysAhead: futureWeekGap.daysAhead
    }, 'Recordatorio de escalacion interna enviado');
  } catch (error) {
    logger.error({ err: error }, 'Error ejecutando recordatorio de escalación interna');
  }
};

const startChecklistAlertScheduler = () => {
  const intervalMs = 5 * 60 * 1000;
  logger.info({
    event: 'checklist.scheduler.start',
    intervalMs,
    includesEscalationReminder: true
  }, 'Checklist/escalacion scheduler started');
  runChecklistAlert();
  runEscalationInternalReminder();
  setInterval(() => {
    runChecklistAlert();
    runEscalationInternalReminder();
  }, intervalMs);
};

module.exports = {
  startChecklistAlertScheduler,
  runChecklistAlert,
  runEscalationInternalReminder
};
