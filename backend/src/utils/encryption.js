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
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const SECRETS_DIR = path.join(__dirname, '../../secrets');
const KEYRING_PATH = path.join(SECRETS_DIR, 'encryption-keyring.json');

const normalizeHexKey = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(raw) ? raw : '';
};

const readKeyringHexKeys = () => {
  try {
    if (!fs.existsSync(KEYRING_PATH)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(KEYRING_PATH, 'utf8'));
    const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
    const normalized = keys.map(normalizeHexKey).filter(Boolean);
    return Array.from(new Set(normalized));
  } catch (error) {
    console.error('Error leyendo keyring de cifrado:', error.message);
    return [];
  }
};

const writeKeyringHexKeys = (keys) => {
  try {
    fs.mkdirSync(SECRETS_DIR, { recursive: true });
    fs.writeFileSync(
      KEYRING_PATH,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        keys
      }, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    console.error('Error escribiendo keyring de cifrado:', error.message);
    return false;
  }
};

const getAvailableHexKeys = () => {
  const envKey = normalizeHexKey(process.env.ENCRYPTION_KEY);
  const keyringKeys = readKeyringHexKeys();
  const ordered = [];

  if (envKey) ordered.push(envKey);
  for (const key of keyringKeys) {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered;
};

const getAvailableBufferKeys = () => getAvailableHexKeys().map((hex) => Buffer.from(hex, 'hex'));

const bootstrapKeyring = () => {
  const envKey = normalizeHexKey(process.env.ENCRYPTION_KEY);
  const keyringKeys = readKeyringHexKeys();

  if (!envKey && keyringKeys.length === 0) {
    console.error('⚠️ ENCRYPTION_KEY inválida o ausente y sin keyring persistente. Usa: openssl rand -hex 32');
    process.exit(1);
  }

  if (envKey && !keyringKeys.includes(envKey)) {
    writeKeyringHexKeys([envKey, ...keyringKeys]);
  }
};

bootstrapKeyring();

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

  const keys = getAvailableBufferKeys();
  if (keys.length === 0) {
    throw new Error('No hay llaves válidas para cifrar');
  }
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, keys[0], iv);
  
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
      console.log(`[DECRYPT] Formato legacy detectado (${parts.length} partes), intentando crypto-js...`);
      const CryptoJS = require('crypto-js');
      const candidateKeys = getAvailableHexKeys();
      console.log(`[DECRYPT] Intentando ${candidateKeys.length} llaves candidatas`);

      for (let i = 0; i < candidateKeys.length; i++) {
        const candidate = candidateKeys[i];
        try {
          const bytes = CryptoJS.AES.decrypt(ciphertext, candidate);
          const decoded = bytes.toString(CryptoJS.enc.Utf8);
          // Validar que el descifrado sea realmente válido UTF-8 (no basura)
          if (decoded && /^[\x20-\x7E\t\n\r]*$/.test(decoded)) {
            console.log(`[DECRYPT] ✓ Llave ${i} funcionó (crypto-js legacy)`);
            return decoded;
          }
          console.log(`[DECRYPT] ✗ Llave ${i} descifró basura (${decoded.substring(0, 20)}...)`);
        } catch (e) {
          console.log(`[DECRYPT] ✗ Llave ${i} error: ${e.message}`);
        }
      }

      try {
        console.log(`[DECRYPT] Intentando ENCRYPTION_KEY de env...`);
        const bytes = CryptoJS.AES.decrypt(ciphertext, process.env.ENCRYPTION_KEY || 'default-key-change-me!!!!!!!!');
        const decoded = bytes.toString(CryptoJS.enc.Utf8);
        if (decoded && /^[\x20-\x7E\t\n\r]*$/.test(decoded)) {
          console.log(`[DECRYPT] ✓ ENCRYPTION_KEY funcionó`);
          return decoded;
        }
        console.log(`[DECRYPT] ✗ ENCRYPTION_KEY descifró basura`);
        return '';
      } catch (e) {
        console.log(`[DECRYPT] ✗ ENCRYPTION_KEY error: ${e.message}`);
        return '';
      }
    }
    
    console.log(`[DECRYPT] Formato AES-256-GCM detectado, intentando ${getAvailableHexKeys().length} llaves...`);
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const candidateKeys = getAvailableBufferKeys();
    for (let i = 0; i < candidateKeys.length; i++) {
      const key = candidateKeys[i];
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        if (decrypted && /^[\x20-\x7E\t\n\r]*$/.test(decrypted)) {
          console.log(`[DECRYPT] ✓ Llave ${i} funcionó (AES-256-GCM)`);
          return decrypted;
        }
        console.log(`[DECRYPT] ✗ Llave ${i} descifró basura`);
      } catch (authTagError) {
        // AuthTag mismatch o llave incorrecta, probar siguiente
        console.log(`[DECRYPT] ✗ Llave ${i} error: ${authTagError.message}`);
      }
    }

    console.error(`[DECRYPT] ✗ No se encontró llave válida para descifrar`);
    return '';
  } catch (error) {
    console.error('Error al descifrar:', error.message);
    return '';
  }
};

module.exports = {
  encrypt,
  decrypt
};
