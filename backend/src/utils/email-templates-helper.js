/**
 * File Purpose: backend/src/utils/email-templates-helper.js
 * Responsibilities: Proveer utilidades para manipulación de HTML y procesamiento de imágenes en correos electrónicos.
 * QA Notes: Todos los comentarios dentro del código deben escribirse en español de forma profesional.
 */

const path = require('path');

/**
 * Convierte código HTML en texto plano básico para correos alternativos.
 * @param {string} html - Código HTML a procesar.
 * @returns {string} Texto plano resultante.
 */
function htmlToBasicPlainText(html) {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 200000);
}

/**
 * Localiza los índices de inicio y fin del valor del atributo src de la primera etiqueta img.
 * @param {string} html - Código HTML.
 * @returns {{valueStart: number, valueEnd: number}|null} Índices o nulo si no se encuentra.
 */
function locateFirstImgSrcRange(html) {
  const str = String(html);
  const imgIdx = str.search(/<img\b/i);
  if (imgIdx === -1) return null;
  const lower = str.toLowerCase();
  let i = imgIdx + 4;

  while (i < str.length) {
    const idxSrc = lower.indexOf('src', i);
    if (idxSrc === -1) return null;

    let j = idxSrc + 3;
    while (j < str.length && /\s/.test(str[j])) j++;
    if (str[j] !== '=') {
      i = idxSrc + 1;
      continue;
    }
    j++;
    while (j < str.length && /\s/.test(str[j])) j++;

    const q = str[j];
    if (q !== '"' && q !== "'") {
      i = idxSrc + 1;
      continue;
    }

    const valueStart = j + 1;
    const valueEnd = str.indexOf(q, valueStart);
    if (valueEnd === -1) return null;
    return { valueStart, valueEnd };
  }

  return null;
}

/**
 * Extrae la URL/URI del atributo src de la primera etiqueta img en el HTML.
 * @param {string} html - Código HTML.
 * @returns {string|null} URL/URI de la imagen o nulo.
 */
function extractFirstImgSrc(html) {
  const str = String(html);
  const r = locateFirstImgSrcRange(str);
  return r ? str.slice(r.valueStart, r.valueEnd).trim() : null;
}

/**
 * Reemplaza el src de la primera etiqueta img por un nuevo valor.
 * @param {string} html - Código HTML.
 * @param {string} newSrc - Nuevo valor para el atributo src.
 * @returns {string} HTML modificado.
 */
function replaceFirstImgSrc(html, newSrc) {
  const str = String(html);
  const r = locateFirstImgSrcRange(str);
  if (!r) return str;
  return str.slice(0, r.valueStart) + String(newSrc) + str.slice(r.valueEnd);
}

/**
 * Remueve la primera etiqueta img del HTML.
 * @param {string} html - Código HTML.
 * @returns {string} HTML sin la primera etiqueta img.
 */
function removeFirstImgTag(html) {
  const str = String(html);
  const idx = str.search(/<img\b/i);
  if (idx === -1) return str;

  let i = idx;
  let inQuote = null;
  while (i < str.length) {
    const c = str[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === '>') {
      return str.slice(0, idx) + str.slice(i + 1);
    }
    i++;
  }

  return str;
}

/**
 * Remueve etiquetas img consecutivas si su atributo src contiene imágenes embebidas en base64 (data:image/).
 * @param {string} html - Código HTML.
 * @returns {string} HTML filtrado.
 */
function removeLeadingDataImageTags(html) {
  let out = String(html);
  let guard = 0;
  while (guard < 10) {
    const src = extractFirstImgSrc(out);
    if (!src || !/^data:image\//i.test(src)) break;
    out = removeFirstImgTag(out);
    guard++;
  }
  return out;
}

/**
 * Determina el tipo de contenido mime a partir de la extensión del archivo.
 * @param {string} filename - Nombre del archivo de imagen.
 * @returns {string} Tipo mime correspondiente.
 */
function contentTypeFromLogoFilename(filename) {
  const e = path.extname(filename || '').toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  if (e === '.svg') return 'image/svg+xml';
  return 'image/png';
}

/**
 * Determina el tipo de contenido mime a partir del subtipo de datos de la URI base64.
 * @param {string} sub - Subtipo (ej. png, jpeg).
 * @returns {string} Tipo mime correspondiente.
 */
function contentTypeFromDataSubtype(sub) {
  const s = String(sub || '').toLowerCase();
  if (s === 'jpeg' || s === 'jpg') return 'image/jpeg';
  if (s === 'png') return 'image/png';
  if (s === 'gif') return 'image/gif';
  if (s === 'webp') return 'image/webp';
  if (s === 'svg+xml') return 'image/svg+xml';
  return 'image/png';
}

module.exports = {
  htmlToBasicPlainText,
  locateFirstImgSrcRange,
  extractFirstImgSrc,
  replaceFirstImgSrc,
  removeFirstImgTag,
  removeLeadingDataImageTags,
  contentTypeFromLogoFilename,
  contentTypeFromDataSubtype
};
