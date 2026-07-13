/**
 * File Purpose: backend/src/utils/shiftReminderScheduler.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * shiftReminderScheduler.js — MAIL-REM-043 (v3)
 *
 * Procesa TODOS los recordatorios habilitados en la colección ShiftReminder.
 * Por cada recordatorio verifica qué turnos están activos en el momento
 * actual, calcula la clave de deduplicación y envía el correo si corresponde.
 */

const moment = require('moment-timezone');
const ShiftReminder = require('../models/ShiftReminder');
const AvisoLog = require('../models/AvisoLog');
const WorkShift = require('../models/WorkShift');
const WorkShiftAssignment = require('../models/WorkShiftAssignment');
const User = require('../models/User');
const { getBrandingSnapshot, formatBrandedSubject, getAppTitleForText } = require('./branding');
const { sendEmail } = require('./email');
const { logger } = require('./logger');

const POLL_INTERVAL_MS = 1 * 60 * 1000;
const { DEFAULT_TIMEZONE } = require('./date-utils');
const FIXED_TOLERANCE_MINUTES = 1;

// ─── Helpers de tiempo ────────────────────────────────────────────────────

function isTimeInRange(time, start, end) {
  // Delegar la evaluación de rango horario al helper centralizado
  const { isTimeInRange: checkTimeRange } = require('./time-helper');
  return checkTimeRange(time, start, end);
}

function currentTimeStr(timezone, now) {
  return moment.tz(now, timezone || DEFAULT_TIMEZONE).format('HH:mm');
}

function localDateLabel(timezone, now) {
  return moment.tz(now, timezone || DEFAULT_TIMEZONE).format('YYYY-MM-DD');
}

function hoursBlockKey(reminderId, timezone, now, intervalHours) {
  const m = moment.tz(now, timezone || DEFAULT_TIMEZONE);
  const block = Math.floor(m.hours() / intervalHours);
  const date = m.format('YYYY-MM-DD');
  return `rem-${reminderId}-hours-${date}-block${block}`;
}

// ─── Email HTML (Importado desde plantillas centralizadas) ──────────────────

const { buildReminderHtml, formatReminderTextForEmail } = require('../templates/email');

// ─── Lógica principal ─────────────────────────────────────────────────────

async function runShiftReminder() {
  try {
    const reminders = await ShiftReminder.find({ enabled: true }).lean();
    if (!reminders.length) return;

    const config = await getBrandingSnapshot();
    const now = new Date();

    for (const reminder of reminders) {
      const remIdStr = String(reminder._id);
      const frequencyType = reminder.frequencyType || 'hours';
      const intervalHours = Number.isFinite(reminder.intervalHours) ? reminder.intervalHours : 4;
      const fixedTimes = Array.isArray(reminder.fixedTimes) ? reminder.fixedTimes : [];
      const targetShiftIds = Array.isArray(reminder.targetShiftIds)
        ? reminder.targetShiftIds.map(String)
        : [];

      const shiftFilter = { active: true };
      if (targetShiftIds.length > 0) {
        shiftFilter._id = { $in: targetShiftIds };
      }

      const shifts = await WorkShift.find(shiftFilter)
        .populate('assignedUserIds', 'email fullName username isActive')
        .lean();

      for (const shift of shifts) {
        if (!shift.startTime || !shift.endTime) continue;

        const shiftTz = (shift.timezone || DEFAULT_TIMEZONE).trim();
        const nowTime = currentTimeStr(shiftTz, now);

        if (!isTimeInRange(nowTime, shift.startTime, shift.endTime)) {
          logger.warn(`[shiftReminder] "${reminder.label}" → turno "${shift.name}": hora actual ${nowTime} fuera del rango ${shift.startTime}-${shift.endTime}, omitiendo.`);
          continue;
        }

        let triggerKey;
        if (frequencyType === 'hours') {
          triggerKey = hoursBlockKey(remIdStr, shiftTz, now, intervalHours);
        } else {
          if (fixedTimes.length === 0) {
            logger.warn(`[shiftReminder] "${reminder.label}" (${remIdStr}): frecuencia 'fixed' sin horas configuradas, omitiendo.`);
            continue;
          }
          const nowMoment = moment.tz(now, shiftTz);
          const nowMinutes = nowMoment.hours() * 60 + nowMoment.minutes();
          const matchedTime = fixedTimes.find((t) => {
            const [h, m] = (t || '').split(':').map(Number);
            if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
            const targetMinutes = h * 60 + m;
            return Math.abs(nowMinutes - targetMinutes) <= FIXED_TOLERANCE_MINUTES;
          });
          if (!matchedTime) continue;
          const dateLabel = localDateLabel(shiftTz, now);
          triggerKey = `rem-${remIdStr}-fixed-${matchedTime}-${dateLabel}`;
        }

        const alreadySent = await AvisoLog.exists({ shiftId: shift._id, triggerKey });
        if (alreadySent) continue;

        const recipientSet = new Map();

        // Revisar si el turno ha sido migrado al nuevo sistema de asignaciones
        const totalAssignmentsCount = await WorkShiftAssignment.countDocuments({
          workShiftId: shift._id,
          active: true
        });

        if (totalAssignmentsCount > 0) {
          // Fuente principal: WorkShiftAssignment (vinculaciones operativas)
          const currentDow = moment.tz(now, shiftTz).day(); // 0=Domingo … 6=Sábado
          const operativeAssignments = await WorkShiftAssignment.find({
            workShiftId: shift._id,
            active: true,
            weekdays: currentDow
          }).populate('userId', 'email fullName username isActive').lean();
          
          for (const asg of operativeAssignments) {
            const u = asg.userId;
            if (u?.email && u.isActive !== false) {
              recipientSet.set(u.email.toLowerCase(), u.fullName || u.username || u.email);
            }
          }
        } else {
          // Fallback legacy: solo si WorkShiftAssignment no tiene asignaciones activas para este turno
          if (Array.isArray(shift.assignedUserIds)) {
            for (const user of shift.assignedUserIds) {
              if (user?.email && user.isActive !== false) {
                recipientSet.set(user.email.toLowerCase(), user.fullName || user.username || user.email);
              }
            }
          }

          if (recipientSet.size === 0 && shift.assignedUserId) {
            const legacyUser = await User.findById(shift.assignedUserId)
              .select('email fullName username isActive')
              .lean();
            if (legacyUser?.email && legacyUser.isActive !== false) {
              recipientSet.set(legacyUser.email.toLowerCase(), legacyUser.fullName || legacyUser.username || legacyUser.email);
            }
          }
        }

        if (recipientSet.size === 0) {
          logger.debug(`[shiftReminder] Turno "${shift.name}" sin destinatarios activos, omitiendo.`);
          continue;
        }

        const recipients = [...recipientSet.keys()];
        const html = buildReminderHtml({
          appTitle: config?.appTitle,
          reminderText: reminder.reminderText
        });

        await sendEmail({
          to: recipients,
          subject: formatBrandedSubject(config?.appTitle, reminder.label),
          text: reminder.reminderText,
          html,
          auditContext: {
            sourceModule: 'shiftReminderScheduler',
            triggerType: 'scheduled',
            triggerContext: `reminder:${remIdStr} shift:${shift.code || String(shift._id)}`,
            shiftId: shift._id,
            resolvedRecipientsCount: recipients.length,
            resolvedRecipientsPreview: recipients.map(e => e.replace(/^(.{2}).*@/, '$1***@')).join(', '),
            extra: { frequencyType, triggerKey, shiftCode: shift.code, reminderId: remIdStr }
          }
        });

        await AvisoLog.create({
          type: 'shift_reminder',
          shiftId: shift._id,
          shiftName: shift.name || '',
          recipients,
          recipientsCount: recipients.length,
          reminderText: reminder.reminderText,
          frequencyType,
          triggerKey,
          sentAt: now
        });

        logger.info(`[shiftReminder] "${reminder.label}" → "${shift.name}" → ${recipients.length} dest. [${triggerKey}]`);
      }
    }
  } catch (error) {
    logger.error('[shiftReminderScheduler] Error:', error);
  }
}

let shiftReminderInterval = null;

function startShiftReminderScheduler() {
  if (shiftReminderInterval) {
    clearInterval(shiftReminderInterval);
    shiftReminderInterval = null;
  }
  runShiftReminder();
  shiftReminderInterval = setInterval(runShiftReminder, POLL_INTERVAL_MS);
  logger.info('✅ Shift reminder scheduler started (polling cada 1 min)');
}

function stopShiftReminderScheduler() {
  if (shiftReminderInterval) {
    clearInterval(shiftReminderInterval);
    shiftReminderInterval = null;
    logger.info('✅ Stopped Shift reminder scheduler.');
  }
}

module.exports = { startShiftReminderScheduler, stopShiftReminderScheduler, buildReminderHtml, formatReminderTextForEmail };
