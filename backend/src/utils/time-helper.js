/**
 * File Purpose: backend/src/utils/time-helper.js
 * Responsibilities: Proveer funciones auxiliares relacionadas con la validación y operaciones horarias.
 * QA Notes: Todos los comentarios dentro del código deben escribirse en español de forma profesional.
 */

/**
 * Determina si una hora dada se encuentra dentro del rango horario especificado (permite rangos que cruzan la medianoche).
 * @param {string} time - Hora actual en formato 'HH:mm'.
 * @param {string} start - Hora de inicio en formato 'HH:mm'.
 * @param {string} end - Hora de fin en formato 'HH:mm'.
 * @returns {boolean} True si está dentro del rango, false en caso contrario.
 */
const isTimeInRange = (time, start, end) => {
  // Retorna falso si alguno de los parámetros de tiempo es nulo, indefinido o vacío
  if (!time || !start || !end) return false;

  if (start < end) {
    return time >= start && time < end;
  }
  // Manejo de rangos que cruzan la medianoche (ej: de 22:00 a 06:00)
  return time >= start || time < end;
};

module.exports = {
  isTimeInRange
};
