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
const AppConfig = require('../models/AppConfig');
const { sendEmail } = require('./email');
const { logger } = require('./logger');

const POLL_INTERVAL_MS = 1 * 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Santiago';
const FIXED_TOLERANCE_MINUTES = 1;

// ─── Helpers de tiempo ────────────────────────────────────────────────────

function isTimeInRange(time, start, end) {
  if (!time || !start || !end) return false;
  if (end <= start) {
    return time >= start || time < end;
  }
  return time >= start && time < end;
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

// ─── Email HTML ───────────────────────────────────────────────────────────

function buildReminderHtml({ appTitle, reminderText }) {
  const safeTitle = (appTitle || 'Bitácora SOC').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeText = (reminderText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" width="560" style="border-collapse:collapse;margin:24px auto;background:#ffffff;border:1px solid #ddd;border-radius:4px;">
    <tr>
      <td style="background:#1565c0;padding:20px 24px;">
        <p style="margin:0;font-size:13px;color:#bbdefb;">${safeTitle}</p>
        <h2 style="margin:4px 0 0 0;color:#ffffff;font-size:20px;">Recordatorio de Turno</h2>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 24px;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#111111;line-height:1.4;">${safeText}</p>
        <p style="margin:24px 0 0 0;font-size:12px;color:#888888;">
          Este es un recordatorio automático generado por ${safeTitle}. No responder a este correo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Lógica principal ─────────────────────────────────────────────────────

async function runShiftReminder() {
  try {
    const reminders = await ShiftReminder.find({ enabled: true }).lean();
    if (!reminders.length) return;

    const config = await AppConfig.findOne().lean();
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

        // Fuente principal: WorkShiftAssignment (vinculaciones operativas gestionadas desde UI)
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

        // Fallback legacy: solo si WorkShiftAssignment no tiene ningún destinatario
        if (recipientSet.size === 0 && Array.isArray(shift.assignedUserIds)) {
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

        if (recipientSet.size === 0) {
          logger.debug(`[shiftReminder] Turno "${shift.name}" sin destinatarios activos, omitiendo.`);
          continue;
        }

        const recipients = [...recipientSet.keys()];
        const html = buildReminderHtml({
          appTitle: config?.appTitle || 'Bitácora SOC',
          reminderText: reminder.reminderText
        });

        await sendEmail({
          to: recipients,
          subject: `[${config?.appTitle || 'Bitácora SOC'}] ${reminder.label}`,
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

// ─── Arranque ─────────────────────────────────────────────────────────────

function startShiftReminderScheduler() {
  runShiftReminder();
  setInterval(runShiftReminder, POLL_INTERVAL_MS);
  logger.info('✅ Shift reminder scheduler started (polling cada 5 min)');
}

module.exports = { startShiftReminderScheduler };
