/**
 * File Purpose: backend/src/utils/boolean-helper.js
 * Responsibilities: Proveer funciones de parseo de booleanos de manera unificada.
 * QA Notes: Todos los comentarios dentro del código deben escribirse en español de forma profesional.
 */

/**
 * Parsea un valor a un booleano compatible.
 * Admite cadenas como 'true', '1', 'yes', 'si', 'sí', 'activo', 'on'.
 * @param {any} value - Valor a parsear.
 * @param {boolean} fallback - Valor por defecto si no es parseable.
 * @returns {boolean} Booleano parseado.
 */
function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'si', 'sí', 'activo', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'inactivo', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

module.exports = {
  parseBooleanLike,
  parseBooleanFlag: parseBooleanLike // Alias para mantener retrocompatibilidad
};
