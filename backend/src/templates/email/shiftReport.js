/**
 * File Purpose: backend/src/templates/email/shiftReport.js
 * Responsibilities: Contain the template generation bridge for shift reports.
 */

// Importamos la función original de generación de reporte HTML
const { generateReportHTML } = require('../../utils/shift-report');

/**
 * Genera el cuerpo de correo en formato HTML para el reporte de turno.
 * @param {Object} opts - Datos del turno a procesar.
 * @returns {Promise<string>} HTML final listo para envío.
 */
async function buildShiftReportEmail(opts) {
  return generateReportHTML(opts);
}

module.exports = { buildShiftReportEmail };
