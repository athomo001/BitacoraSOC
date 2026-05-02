/**
 * File Purpose: backend/src/utils/encryption.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Utilidad de Cifrado AES-256-GCM
 * 
 * Funcionalidad:
 *   - Cifrar/descifrar passwords SMTP con AES-256-GCM (authenticated encryption)
 *   - Migración: legacy crypto-js → crypto nativo Node.js
 * 
 * Seguridad:
 *   - Require ENCRYPTION_KEY: 64 hex chars (32 bytes) generada con openssl
 *   - IV aleatorio por operación (previene ataques de diccionario)
 *   - AuthTag: detecta manipulación del ciphertext (integridad)
 * 
 * Formato almacenado:
 *   iv:authTag:encrypted (3 segmentos separados por ':')
 * 
 * Legacy fallback:
 *   - Si no tiene formato nuevo, intenta descifrar con crypto-js (compatibilidad)
 */
const crypto = require('crypto');

// 🔒 CRÍTICO: Validar que ENCRYPTION_KEY esté configurada (no usar default)
// Genera con: openssl rand -hex 32
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
  console.error('⚠️ ENCRYPTION_KEY no configurada o muy corta. Usa: openssl rand -hex 32');
  process.exit(1);
}

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const ALGORITHM = 'aes-256-gcm';

/**
 * Cifrar texto con AES-256-GCM
 * 
 * Input: texto plano (ej: password SMTP)
 * Output: "iv:authTag:ciphertext" (formato string)
 * 
 * Proceso:
 *   1. Generar IV aleatorio de 16 bytes (único por operación)
 *   2. Crear cipher con AES-256-GCM
 *   3. Cifrar texto (utf8 → hex)
 *   4. Extraer authTag (firma de integridad)
 *   5. Concatenar iv:authTag:encrypted para almacenamiento
 * 
 * Seguridad:
 *   - IV único previene ataques de diccionario
 *   - AuthTag detecta manipulación del ciphertext
 */
const encrypt = (text) => {
  if (!text) return '';
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Formato: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

/**
 * Descifrar texto con AES-256-GCM (+ fallback legacy)
 * 
 * Input: "iv:authTag:ciphertext" (formato string)
 * Output: texto plano descifrado
 * 
 * Proceso:
 *   1. Parsear formato iv:authTag:encrypted
 *   2. Recrear decipher con IV original
 *   3. Validar authTag (falla si ciphertext manipulado)
 *   4. Descifrar (hex → utf8)
 * 
 * Legacy Fallback:
 *   - Si ciphertext no tiene formato nuevo (sin ':')
 *   - Intenta descifrar con crypto-js (migración suave)
 *   - Permite leer passwords antiguos sin perder datos
 */
const decrypt = (ciphertext) => {
  if (!ciphertext) return '';
  
  try {
    const parts = ciphertext.split(':');
    
    // Legacy fallback: si no tiene formato nuevo, intentar crypto-js
    if (parts.length !== 3) {
      const CryptoJS = require('crypto-js');
      const bytes = CryptoJS.AES.decrypt(ciphertext, process.env.ENCRYPTION_KEY || 'default-key-change-me!!!!!!!!');
      return bytes.toString(CryptoJS.enc.Utf8);
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Error al descifrar:', error.message);
    return '';
  }
};

module.exports = {
  encrypt,
  decrypt
};
