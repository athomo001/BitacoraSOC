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

  const anchorDate = new Date(now);
  anchorDate.setDate(anchorDate.getDate() + daysAhead);

  let targetWeekStart = getStartOfWeekMonday(anchorDate);
  if (targetWeekStart <= currentWeekStart) {
    targetWeekStart = new Date(currentWeekStart);
    targetWeekStart.setDate(targetWeekStart.getDate() + 7);
  }

  const targetWeekEnd = getEndOfWeekSunday(targetWeekStart);
  const hasAnyAssignment = await ShiftAssignment.exists({
    weekStartDate: { $lte: targetWeekEnd },
    weekEndDate: { $gte: targetWeekStart }
  });

  if (hasAnyAssignment) {
    return null;
  }

  return {
    daysAhead,
    weekStart: targetWeekStart,
    weekEnd: targetWeekEnd
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
    if (!shouldSendEscalationReminder(now, config, futureWeekGap)) return;

    const cargoLabels = Array.isArray(config.escalationReminderCargoLabels)
      ? config.escalationReminderCargoLabels
      : ['N2'];

    const recipients = await getEscalationReminderRecipients(cargoLabels);
    if (recipients.length === 0) return;

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
  } catch (error) {
    logger.error({ err: error }, 'Error ejecutando recordatorio de escalación interna');
  }
};

const startChecklistAlertScheduler = () => {
  const intervalMs = 5 * 60 * 1000;
  runChecklistAlert();
  runEscalationInternalReminder();
  setInterval(() => {
    runChecklistAlert();
    runEscalationInternalReminder();
  }, intervalMs);
};

module.exports = {
  startChecklistAlertScheduler
};
