/**
 * File Purpose: backend/src/utils/font-parser.js
 * Responsibilities: Analiza binariamente archivos TTF/OTF (formatos SFNT) para extraer metadatos de la tabla 'name'.
 * QA Notes: Soporta formatos UTF-16BE y ASCII.
 */

const fs = require('fs').promises;

/**
 * Decodifica un buffer con codificación UTF-16BE a un string en JavaScript.
 * Dado que Node.js no soporta 'utf16be' nativamente en Buffer.toString(),
 * se implementa esta lectura binaria manual donde cada caracter está compuesto por 2 bytes.
 * @param {Buffer} buffer - Buffer de bytes en UTF-16BE.
 * @returns {string} String decodificado.
 */
function decodeUTF16BE(buffer) {
  let str = '';
  for (let i = 0; i < buffer.length; i += 2) {
    if (i + 1 < buffer.length) {
      const code = (buffer[i] << 8) | buffer[i + 1];
      str += String.fromCharCode(code);
    }
  }
  return str;
}

/**
 * Extrae el nombre de la familia tipográfica (Font Family Name) de un archivo TTF u OTF.
 * @param {string} filePath - Ruta absoluta del archivo de la fuente física.
 * @returns {Promise<string>} Nombre detectado de la familia tipográfica.
 */
async function getFontName(filePath) {
  const buffer = await fs.readFile(filePath);

  if (buffer.length < 12) {
    throw new Error('El archivo de fuente es demasiado corto o corrupto');
  }

  // numTables está ubicado en los bytes 4-5 de la cabecera del archivo SFNT
  const numTables = buffer.readUInt16BE(4);
  
  let nameTableOffset = 0;
  let nameTableLength = 0;

  // Buscar la tabla 'name' en el directorio de tablas (comienza en byte 12, cada registro mide 16 bytes)
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 16 > buffer.length) break;

    const tag = buffer.toString('ascii', offset, offset + 4);
    if (tag === 'name') {
      nameTableOffset = buffer.readUInt32BE(offset + 8);
      nameTableLength = buffer.readUInt32BE(offset + 12);
      break;
    }
  }

  if (nameTableOffset === 0 || nameTableOffset + nameTableLength > buffer.length) {
    throw new Error('No se encontró la tabla de nombres (name table) en la fuente');
  }

  // Estructura de la tabla 'name':
  // - format: 2 bytes
  // - count (número de registros): 2 bytes (en offset + 2)
  // - stringOffset: 2 bytes (en offset + 4)
  const count = buffer.readUInt16BE(nameTableOffset + 2);
  const stringOffset = buffer.readUInt16BE(nameTableOffset + 4);

  let fontFamily = '';

  // Buscar a través de los registros de nombres (cada uno mide 12 bytes)
  for (let i = 0; i < count; i++) {
    const recordOffset = nameTableOffset + 6 + i * 12;
    if (recordOffset + 12 > nameTableOffset + nameTableLength) break;

    const platformID = buffer.readUInt16BE(recordOffset);
    const nameID = buffer.readUInt16BE(recordOffset + 6);
    const length = buffer.readUInt16BE(recordOffset + 8);
    const offset = buffer.readUInt16BE(recordOffset + 10);

    // nameID = 1 representa la familia de la fuente (Font Family)
    // nameID = 4 representa el nombre completo de la fuente (Full Font Name)
    if (nameID === 1 || (nameID === 4 && !fontFamily)) {
      const stringStart = nameTableOffset + stringOffset + offset;
      const stringEnd = stringStart + length;
      if (stringEnd > buffer.length) continue;

      let str = '';
      if (platformID === 3 || platformID === 0) {
        // Codificación de Windows / Unicode: Formato UTF-16BE (2 bytes por caracter)
        const subBuffer = buffer.subarray(stringStart, stringEnd);
        str = decodeUTF16BE(subBuffer);
      } else if (platformID === 1) {
        // Codificación de Macintosh: Formato ASCII / MacRoman (1 byte por caracter)
        str = buffer.toString('ascii', stringStart, stringEnd);
      }

      // Remover caracteres nulos de la codificación y espacios sobrantes
      str = str.replace(/\0/g, '').trim();

      if (str) {
        // Se le da prioridad al nombre de la familia (nameID = 1)
        if (nameID === 1) {
          fontFamily = str;
          break;
        } else {
          fontFamily = str;
        }
      }
    }
  }

  if (!fontFamily) {
    throw new Error('No se pudo extraer la familia tipográfica interna de la fuente');
  }

  return fontFamily;
}

module.exports = { getFontName };
