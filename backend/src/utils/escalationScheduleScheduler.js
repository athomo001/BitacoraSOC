/**
 * File Purpose: backend/src/utils/escalationScheduleScheduler.js
 * Responsibilities: Orchestrate background jobs for escalation schedule automation.
 */

const cron = require('node-cron');
const AppConfig = require('../models/AppConfig');
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
      const config = await AppConfig.findOne();
      if (!config) return;

      const automation = config.escalationScheduleAutomation;
      if (!automation || !automation.enabled) return;

      const now = new Date();
      const currentDay = now.getDay(); // 0-6 (Domingo-Sábado)
      const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // "HH:mm"

      // 1. Verificar si coincide el día y la hora
      const dayMatches = automation.frequency === 'monthly' 
        ? now.getDate() === 1 // Primer día del mes
        : currentDay === automation.dayOfWeek;

      const timeMatches = currentTime === automation.time;

      if (dayMatches && timeMatches) {
        // 2. Verificar si ya se envió hoy (evitar múltiples envíos en el mismo minuto)
        const lastSentAt = automation.lastSentAt;
        const alreadySentToday = lastSentAt && 
          lastSentAt.getDate() === now.getDate() && 
          lastSentAt.getMonth() === now.getMonth() &&
          lastSentAt.getFullYear() === now.getFullYear();

        if (alreadySentToday) return;

        logger.info('🚀 Triggering automated escalation schedule send...', { 
          frequency: automation.frequency,
          recipients: automation.recipients?.length
        });

        const recipients = automation.recipients || [];
        const ccRecipients = automation.ccRecipients || [];

        if (recipients.length === 0) {
          logger.warn('⚠️ Automated send skipped: No recipients configured.');
          return;
        }

        const result = await escalationController.sendEscalationScheduleInternal({
          recipients,
          ccRecipients,
          frequency: automation.frequency
        });

        if (result.success) {
          logger.info('✅ Automated escalation schedule sent successfully.');
          // Actualizar última fecha de envío
          await AppConfig.updateOne({}, { 
            $set: { 'escalationScheduleAutomation.lastSentAt': now } 
          });
        } else {
          logger.error('❌ Error in automated escalation schedule send:', result.error);
        }
      }
    } catch (error) {
      logger.error('Error in escalationScheduleScheduler loop:', error);
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
