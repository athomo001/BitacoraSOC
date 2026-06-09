/**
 * File Purpose: backend/src/utils/date-utils.js
 * Responsibilities: Proveer la zona horaria predeterminada de la aplicación y utilidades de formateo.
 * QA Notes: Todos los comentarios dentro del código deben escribirse en español de forma profesional.
 */

// Zona horaria por defecto utilizada en toda la aplicación (Chile)
const DEFAULT_TIMEZONE = 'America/Santiago';

/**
 * Retorna la zona horaria por defecto.
 * @returns {string} Zona horaria por defecto.
 */
function getDefaultTimezone() {
  return DEFAULT_TIMEZONE;
}

module.exports = {
  DEFAULT_TIMEZONE,
  getDefaultTimezone
};
