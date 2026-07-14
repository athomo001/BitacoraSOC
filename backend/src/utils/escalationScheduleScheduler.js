/**
 * File Purpose: backend/src/utils/escalationScheduleScheduler.js
 * Responsibilities: Orchestrate background jobs for escalation schedule automation.
 */

const cron = require('node-cron');
const AppConfig = require('../models/AppConfig');
const ShiftNotificationSchedule = require('../models/ShiftNotificationSchedule');
const escalationController = require('../controllers/escalationController');
const { logger } = require('./logger');

let escalationCronTask = null;

/**
 * Inicializa el scheduler de automatización de turnos
 */
function initEscalationScheduleScheduler() {
  logger.info('📅 Initializing Escalation Schedule Scheduler (ESC-SHIFT-111)...');

  // Detener tarea previa si ya está corriendo para evitar fugas
  if (escalationCronTask) {
    escalationCronTask.stop();
    escalationCronTask = null;
  }

  // Ejecutar cada minuto para mayor precisión en la hora configurada
  escalationCronTask = cron.schedule('* * * * *', async () => {
    try {
      // 1. Ejecutar migración única de datos antiguos si aplica
      const count = await ShiftNotificationSchedule.countDocuments();
      if (count === 0) {
        const config = await AppConfig.findOne();
        if (config && config.escalationScheduleAutomation) {
          const auto = config.escalationScheduleAutomation;
          if (auto.recipients && auto.recipients.length > 0) {
            logger.info('📦 Migrating legacy escalation email automation to new notification schedules model...');
            const defaultSchedule = new ShiftNotificationSchedule({
              name: 'Envío General de Guardia',
              enabled: auto.enabled ?? false,
              frequency: auto.frequency || 'weekly',
              dayOfWeek: auto.dayOfWeek ?? 1,
              time: auto.time || '09:00',
              recipients: auto.recipients || [],
              ccRecipients: auto.ccRecipients || [],
              roleFilter: ['N2', 'N1_NO_HABIL'], // Roles predeterminados legacy (se excluye TI por defecto)
              lastSentAt: auto.lastSentAt
            });
            await defaultSchedule.save();

            // Deshabilitar el antiguo para prevenir duplicidad en futuras migraciones
            await AppConfig.updateOne({}, {
              $set: { 'escalationScheduleAutomation.enabled': false }
            });
            logger.info('✅ Legacy email automation successfully migrated (without TI by default).');
          }
        }
      }

      // Limpieza proactiva única: remover TI del schedule predeterminado si existe para que no aparezca por defecto
      await ShiftNotificationSchedule.updateMany(
        { name: 'Envío General de Guardia', roleFilter: 'TI' },
        { $pull: { roleFilter: 'TI' } }
      );

      // 2. Consultar todas las notificaciones programadas y habilitadas
      const activeSchedules = await ShiftNotificationSchedule.find({ enabled: true });
      if (activeSchedules.length === 0) return;

      const now = new Date();
      
      // Obtener el día de la semana, día del mes y la hora actual en formato de 24 horas forzando la zona horaria de Chile (America/Santiago)
      const santiagoStr = now.toLocaleString('en-US', { timeZone: 'America/Santiago' });
      const santiagoDate = new Date(santiagoStr);
      const currentDay = santiagoDate.getDay(); // 0 (Domingo) a 6 (Sábado)
      const currentMonthDay = santiagoDate.getDate();
      const currentTime = now.toLocaleTimeString('en-GB', { 
        timeZone: 'America/Santiago', 
        hour: '2-digit', 
        minute: '2-digit' 
      }); // Formato HH:mm estable de 24 horas

      for (const schedule of activeSchedules) {
        // Verificar si coincide el día y la hora
        const dayMatches = schedule.frequency === 'monthly'
          ? currentMonthDay === 1 // Primer día del mes
          : currentDay === schedule.dayOfWeek;

        const timeMatches = currentTime === schedule.time;

        if (dayMatches && timeMatches) {
          // Verificar si ya se envió hoy (evitar múltiples envíos en el mismo minuto) comparando la fecha en la zona horaria chilena
          let alreadySentToday = false;
          if (schedule.lastSentAt) {
            const lastSentDateStr = new Date(schedule.lastSentAt).toLocaleDateString('en-US', { timeZone: 'America/Santiago' });
            const nowDateStr = now.toLocaleDateString('en-US', { timeZone: 'America/Santiago' });
            alreadySentToday = lastSentDateStr === nowDateStr;
          }

          if (alreadySentToday) continue;

          logger.info(`🚀 Triggering automated send for schedule: "${schedule.name}"`, { 
            id: schedule._id,
            frequency: schedule.frequency,
            recipients: schedule.recipients?.length,
            roleFilter: schedule.roleFilter
          });

          const recipients = schedule.recipients || [];
          const ccRecipients = schedule.ccRecipients || [];

          if (recipients.length === 0) {
            logger.warn(`⚠️ Automated send skipped for "${schedule.name}": No recipients configured.`);
            continue;
          }

          const result = await escalationController.sendEscalationScheduleInternal({
            name: schedule.name,
            recipients,
            ccRecipients,
            frequency: schedule.frequency,
            roleFilter: schedule.roleFilter
          });

          if (result.success) {
            logger.info(`✅ Automated schedule "${schedule.name}" sent successfully.`);
            // Actualizar última fecha de envío de esta notificación específica
            await ShiftNotificationSchedule.updateOne({ _id: schedule._id }, { 
              $set: { lastSentAt: now } 
            });
          } else {
            logger.error(`❌ Error in automated schedule "${schedule.name}" send:`, result.error);
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Error in escalationScheduleScheduler loop');
    }
  });
}

/**
 * Detiene y limpia la tarea del scheduler si está activa
 */
function stopEscalationScheduleScheduler() {
  if (escalationCronTask) {
    escalationCronTask.stop();
    escalationCronTask = null;
    logger.info('📅 Stopped Escalation Schedule Scheduler.');
  }
}

module.exports = { initEscalationScheduleScheduler, stopEscalationScheduleScheduler };
