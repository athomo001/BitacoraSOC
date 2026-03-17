const cron = require('node-cron');
const WorkShift = require('../models/WorkShift');
const { sendShiftReport } = require('./shift-report');
const { logger } = require('./logger');

/**
 * Scheduler automático para envío de reportes al finalizar turno
 * 
 * Se ejecuta cada minuto y verifica si algún turno acaba de terminar.
 * Si el turno tiene emailReportConfig.enabled = true, envía el reporte.
 */

let schedulerTask = null;
let lastCheckedMinute = '';

/**
 * Inicia el scheduler
 */
function startScheduler() {
  if (schedulerTask) {
    logger.warn('Shift scheduler already running');
    return;
  }

  // Ejecutar cada minuto
  schedulerTask = cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      // Evitar procesar el mismo minuto múltiples veces
      if (currentTime === lastCheckedMinute) {
        return;
      }
      lastCheckedMinute = currentTime;

      // Buscar turnos regulares activos con reenvío habilitado
      const shifts = await WorkShift.find({
        type: 'regular',
        active: true,
        'emailReportConfig.enabled': true
      });

      for (const shift of shifts) {
        // Verificar si el turno acaba de terminar (hora actual == hora de fin)
        if (shift.endTime === currentTime) {
          logger.info(`Shift ${shift.name} ended, sending report...`, {
            shiftId: shift._id,
            endTime: shift.endTime
          });

          try {
            const result = await sendShiftReport(shift._id, now);

            if (result?.success) {
              logger.info(`Automatic report sent for ${shift.name}`, {
                shiftId: shift._id,
                recipients: result.recipients,
                success: result.success
              });
            } else if (result?.deferredByClosure) {
              logger.info(`Automatic report deferred for ${shift.name}`, {
                shiftId: shift._id,
                reason: 'PENDIENTE_POR_CIERRE',
                message: result.message
              });
            } else {
              logger.warn(`Automatic report not sent for ${shift.name}`, {
                shiftId: shift._id,
                message: result?.message || 'Unknown reason'
              });
            }
          } catch (error) {
            logger.error(`Error sending automatic report for ${shift.name}:`, {
              shiftId: shift._id,
              error: error.message
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error in shift scheduler:', error);
    }
  });

  logger.info('✅ Shift report scheduler started');
}

/**
 * Detiene el scheduler
 */
function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Shift report scheduler stopped');
  }
}

/**
 * Obtiene estado del scheduler
 */
function getSchedulerStatus() {
  return {
    running: schedulerTask !== null,
    lastCheckedMinute
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  getSchedulerStatus
};
