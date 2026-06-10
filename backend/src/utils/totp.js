/**
 * File Purpose: backend/src/utils/totp.js
 * Responsibilities: Implementación nativa de TOTP (RFC 6238) y codificación/decodificación Base32.
 * QA Notes: Sin dependencias externas pesadas para mantener la simplicidad y robustez criptográfica.
 */

const crypto = require('crypto');

/**
 * Decodifica una cadena en formato Base32 a un Buffer de bytes
 * @param {string} base32 - Cadena codificada en Base32
 * @returns {Buffer} Buffer de bytes resultante
 */
function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanStr = String(base32 || '').replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  const len = cleanStr.length;
  let bits = 0;
  let val = 0;
  let index = 0;
  
  // Tamaño estimado en bytes
  const buf = Buffer.alloc(Math.floor((len * 5) / 8));
  
  for (let i = 0; i < len; i++) {
    const idx = alphabet.indexOf(cleanStr[i]);
    if (idx === -1) {
      throw new Error('Caracter Base32 inválido en secreto de MFA');
    }
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (index < buf.length) {
        buf[index++] = (val >>> bits) & 0xff;
      }
    }
  }
  return buf;
}

/**
 * Genera un secreto aleatorio compatible con Google Authenticator (Base32)
 * @param {number} length - Longitud en bytes del secreto original (default: 20 bytes/160 bits)
 * @returns {string} Secreto en Base32
 */
function generateSecret(length = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const randomBytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < randomBytes.length; i++) {
    secret += alphabet[randomBytes[i] % 32];
  }
  return secret;
}

/**
 * Genera un código TOTP de 6 dígitos para un secreto y un contador de tiempo específicos
 * @param {string} secret - Secreto Base32 del usuario
 * @param {number} timeStep - Ventana de tiempo en segundos (default: 30)
 * @param {number} counter - Contador de tiempo (default: tiempo actual / timeStep)
 * @returns {string} Código de 6 dígitos con ceros a la izquierda si es necesario
 */
function generateTOTP(secret, timeStep = 30, counter = Math.floor(Date.now() / 1000 / timeStep)) {
  const key = base32Decode(secret);
  
  // Escribir el contador como un entero de 64 bits
  const buffer = Buffer.alloc(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    buffer[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buffer);
  const hmacResult = hmac.digest();
  
  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
    
  const otp = code % 1000000;
  return String(otp).padStart(6, '0');
}

/**
 * Verifica si un código TOTP es válido en base al tiempo actual y una ventana de tolerancia
 * @param {string} token - Token de 6 dígitos ingresado por el usuario
 * @param {string} secret - Secreto Base32 del usuario
 * @param {number} window - Ventana de tolerancia (atrás/adelante) para desincronizaciones leves de reloj (default: 1)
 * @returns {boolean} Verdadero si es válido
 */
function verifyTOTP(token, secret, window = 1) {
  if (!token || !secret) return false;
  const cleanToken = String(token).trim();
  if (cleanToken.length !== 6 || !/^\d+$/.test(cleanToken)) return false;
  
  const currentCounter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const computed = generateTOTP(secret, 30, currentCounter + i);
    if (computed === cleanToken) {
      return true;
    }
  }
  return false;
}

module.exports = {
  generateSecret,
  verifyTOTP
};
