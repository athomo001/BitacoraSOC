/**
 * File Purpose: backend/src/utils/cookie-helper.js
 * Responsibilities: Proveer funciones auxiliares para la obtención y manipulación de cookies.
 * QA Notes: Todos los comentarios dentro del código deben escribirse en español de forma profesional.
 */

/**
 * Extrae el valor del token JWT de la cookie 'auth_token'.
 * @param {Object} req - Objeto de solicitud de Express.
 * @returns {string|null} El token JWT descifrado o null si no se encuentra.
 */
const getTokenFromCookie = (req) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  // Buscar la cookie 'auth_token' de forma segura
  const authCookie = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('auth_token='));

  if (!authCookie) {
    return null;
  }

  const tokenValue = authCookie.substring('auth_token='.length);
  return tokenValue ? decodeURIComponent(tokenValue) : null;
};

module.exports = {
  getTokenFromCookie
};
