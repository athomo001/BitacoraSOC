/**
 * File Purpose: backend/src/routes/reports.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de Reportes y Análisis SOC
 *
 * Endpoints:
 *   GET  /api/reports/overview               - KPIs y métricas SOC
 *   GET  /api/reports/export-entries          - Exportar entradas a CSV (admin)
 *   GET  /api/reports/tags-trend              - Tendencia de tags
 *   GET  /api/reports/heatmap                 - Mapa de calor día/hora
 *   GET  /api/reports/entries-by-logsource    - Entradas por Log Source
 *   POST /api/reports/newsletter/send         - Envío de Boletín de Seguridad (1:1 o agrupado por dominio)
 *
 * Reglas SOC:
 *   - Todos los endpoints requieren autenticación.
 *   - El envío de boletines respeta privacidad: 1 correo por destinatario (nunca CC masivo).
 *   - Timezone para aggregations: America/Santiago.
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const router = express.Router();
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const User = require('../models/User');
const AppConfig = require('../models/AppConfig');
const { authenticate, authorize } = require('../middleware/auth');
const AuditLog = require('../models/AuditLog');
const { audit } = require('../utils/audit');
const { sendEmail } = require('../utils/email');
const { analyzeRecipientEmails } = require('../utils/contactDirectory');
const { buildIncidentEmail } = require('../utils/incidentEmailTemplate');

/**
 * CID estable para multipart/related (imagen inline). Debe coincidir con el atributo src del HTML.
 * Gmail muestra mal o bloquea data: en HTML; lo correcto es MIME inline + CID.
 */
const NEWSLETTER_LOGO_CID = 'bitacora_newsletter_logo@bitacora';
// Mantener trazas de newsletter siempre activas para diagnóstico continuo.
const NEWSLETTER_DEBUG_LOGS = true;

const normalizeAnalyticsLabel = (value, fallback = 'Sin dato') => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

const parseBooleanFlag = (value, defaultValue = false) => {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'si', 'sí', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const extractEmailDomain = (email) => {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at >= value.length - 1) return '';
  return value.slice(at + 1);
};

const buildRecipientBatches = (recipients = [], groupByDomain = true) => {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!groupByDomain) {
    return list.map((email) => ({
      key: email,
      domain: extractEmailDomain(email) || null,
      to: [email]
    }));
  }

  const buckets = new Map();
  list.forEach((email) => {
    const domain = extractEmailDomain(email) || '__sin_dominio__';
    if (!buckets.has(domain)) buckets.set(domain, []);
    buckets.get(domain).push(email);
  });

  return Array.from(buckets.entries()).map(([domain, to]) => ({
    key: domain,
    domain: domain === '__sin_dominio__' ? null : domain,
    to
  }));
};

const normalizeCriticalityLabel = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) return null;
  if (normalized === 'critica' || normalized === 'critico' || normalized === 'critical') return 'Crítico';
  if (normalized === 'alta' || normalized === 'high') return 'Alto';
  if (normalized === 'media' || normalized === 'medio' || normalized === 'medium') return 'Medio';
  if (normalized === 'baja' || normalized === 'bajo' || normalized === 'low') return 'Bajo';
  return null;
};

const incrementCounter = (map, label, amount = 1) => {
  const key = normalizeAnalyticsLabel(label);
  map.set(key, (map.get(key) || 0) + amount);
};

const mapToSeries = (map, limit = 10) => Array.from(map.entries())
  .sort((left, right) => right[1] - left[1])
  .slice(0, limit)
  .map(([name, value]) => ({ name, value }));

const getDayBucket = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const getHourBucket = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return String(date.getHours()).padStart(2, '0');
};

const detectMailAnalyticsType = (log) => {
  const metadata = log.metadata || {};
  const triggerType = String(metadata.triggerType || '').toLowerCase();
  if (triggerType === 'manual_newsletter') return 'newsletter';
  if (triggerType === 'manual_incident_report') return 'incident';

  const explicitType = String(metadata.type || '').toLowerCase();
  if (explicitType.includes('newsletter') || explicitType.includes('boletin')) return 'newsletter';
  if (explicitType.includes('incident') || explicitType.includes('incidente')) return 'incident';

  if (String(log.event || '').includes('incident')) return 'incident';
  return null;
};

const detectMailAnalyticsStatus = (eventName) => {
  if (eventName === 'mail.send.success' || eventName === 'mail.incident.sent') return 'success';
  if (eventName === 'mail.send.fail' || eventName === 'mail.incident.fail') return 'fail';
  if (eventName === 'mail.incident.attempt') return 'attempt';
  return null;
};

const resolveClientLabelFromMetadata = (metadata = {}) => {
  const fromMetadata = [
    metadata.clientName,
    metadata.client,
    metadata.clientLabel,
    metadata.logSource,
    metadata.ofensa,
    metadata.customer,
    metadata.company,
    metadata.account
  ]
    .map((value) => String(value || '').trim())
    .find(Boolean);

  if (fromMetadata) {
    return normalizeAnalyticsLabel(fromMetadata, 'Sin cliente');
  }

  return null;
};

const UPLOADS_LOGOS_DIR = path.resolve(path.join(__dirname, '../../uploads/logos'));

function extensionFromContentType(ct) {
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/svg+xml') return 'svg';
  return 'png';
}

function newsletterDebug(event, details = {}) {
  if (!NEWSLETTER_DEBUG_LOGS) return;
  const safe = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined) safe[k] = v;
    else if (typeof v === 'string') safe[k] = v.length > 240 ? `${v.slice(0, 240)}...` : v;
    else safe[k] = v;
  }
  console.log(`[newsletter/send][debug] ${event}`, safe);
}

/** Texto plano mínimo para multipart/alternative (mejor tránsito por relays tipo Exchange). */
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

function extractFirstImgSrc(html) {
  const str = String(html);
  const r = locateFirstImgSrcRange(str);
  return r ? str.slice(r.valueStart, r.valueEnd).trim() : null;
}

function replaceFirstImgSrc(html, newSrc) {
  const str = String(html);
  const r = locateFirstImgSrcRange(str);
  if (!r) return str;
  return str.slice(0, r.valueStart) + String(newSrc) + str.slice(r.valueEnd);
}

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

function contentTypeFromLogoFilename(filename) {
  const e = path.extname(filename || '').toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  if (e === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function contentTypeFromDataSubtype(sub) {
  const s = String(sub || '').toLowerCase();
  if (s === 'jpeg' || s === 'jpg') return 'image/jpeg';
  if (s === 'png') return 'image/png';
  if (s === 'gif') return 'image/gif';
  if (s === 'webp') return 'image/webp';
  if (s === 'svg+xml') return 'image/svg+xml';
  return 'image/png';
}

async function readUploadedLogoFromWebPath(webPath) {
  if (!webPath || typeof webPath !== 'string') return null;
  const clean = webPath.split('?')[0].trim();
  if (!clean.startsWith('/uploads/logos/')) return null;
  const base = path.basename(clean);
  if (!base || base === '.' || base === '..' || base.includes('..')) return null;
  const full = path.resolve(path.join(UPLOADS_LOGOS_DIR, base));
  if (!full.startsWith(UPLOADS_LOGOS_DIR)) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}

function resolveUploadedLogoWebPath(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;

  const clean = logoUrl.trim();
  if (!clean) return null;

  if (clean.startsWith('/uploads/logos/')) {
    return clean.split('?')[0];
  }

  if (/^https?:\/\//i.test(clean)) {
    try {
      const parsed = new URL(clean);
      if (parsed.pathname && parsed.pathname.startsWith('/uploads/logos/')) {
        return parsed.pathname.split('?')[0];
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function buildIncidentEmailLogoVariant(buffer, contentType) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) return null;

  const safeContentType = /^image\//.test(String(contentType || '')) ? contentType : 'image/png';

  try {
    const source = sharp(buffer, { animated: false, density: 300 });
    const meta = await source.metadata();
    const width = Math.max(1, Math.min(meta.width || 320, 1600));
    const height = Math.max(1, Math.min(meta.height || 120, 1600));
    const sourceDataUri = `data:${safeContentType};base64,${buffer.toString('base64')}`;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width + 4}" height="${height + 4}" viewBox="0 0 ${width + 4} ${height + 4}">
        <defs>
          <filter id="logo-outline" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
            <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="outline-alpha" />
            <feFlood flood-color="#FFFFFF" result="outline-color" />
            <feComposite in="outline-color" in2="outline-alpha" operator="in" result="outline-fill" />
            <feMerge>
              <feMergeNode in="outline-fill" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <image
          x="2"
          y="2"
          width="${width}"
          height="${height}"
          href="${sourceDataUri}"
          preserveAspectRatio="xMidYMid meet"
          filter="url(#logo-outline)"
        />
      </svg>`;

    const outlinedBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return {
      buffer: outlinedBuffer,
      contentType: 'image/png',
      extension: 'png'
    };
  } catch (error) {
    newsletterDebug('incident.logo_outline.failed', {
      contentType: safeContentType,
      message: error?.message || 'unknown error'
    });
    return {
      buffer,
      contentType: safeContentType,
      extension: extensionFromContentType(safeContentType)
    };
  }
}

/**
 * Resuelve bytes del logo desde HTML (data:, URL interna, cid previo) o adjunto cliente (legacy).
 */
async function resolveNewsletterLogoBuffer(html, clientLogoAttachments, configLogoUrl) {
  let buf = null;
  let ct = 'image/png';
  newsletterDebug('resolve_logo_buffer.start', {
    htmlLength: String(html || '').length,
    hasClientInlineArray: Array.isArray(clientLogoAttachments),
    clientInlineCount: Array.isArray(clientLogoAttachments) ? clientLogoAttachments.length : 0,
    hasConfigLogoUrl: Boolean(configLogoUrl)
  });

  if (Array.isArray(clientLogoAttachments) && clientLogoAttachments.length === 1) {
    const a = clientLogoAttachments[0];
    newsletterDebug('resolve_logo_buffer.client_inline.detected', {
      hasContentBase64: Boolean(a?.contentBase64),
      contentBase64Length: a?.contentBase64 ? String(a.contentBase64).length : 0,
      hasBufferContent: Boolean(a?.content && Buffer.isBuffer(a.content)),
      contentType: a?.contentType || null
    });
    if (a?.contentBase64 && typeof a.contentBase64 === 'string') {
      const b64 = String(a.contentBase64).replace(/\s/g, '');
      if (b64.length > 900000) {
        buf = null;
        newsletterDebug('resolve_logo_buffer.client_inline.skipped_too_large', { b64Length: b64.length });
      } else {
        try {
          buf = Buffer.from(b64, 'base64');
          ct = /^image\//.test(String(a.contentType || '')) ? a.contentType : 'image/png';
          newsletterDebug('resolve_logo_buffer.client_inline.loaded_base64', {
            bufferLength: buf.length,
            contentType: ct
          });
        } catch {
          buf = null;
          newsletterDebug('resolve_logo_buffer.client_inline.base64_decode_failed');
        }
      }
    } else if (a?.content && Buffer.isBuffer(a.content) && a.content.length) {
      buf = a.content;
      ct = /^image\//.test(String(a.contentType || '')) ? a.contentType : 'image/png';
      newsletterDebug('resolve_logo_buffer.client_inline.loaded_buffer', {
        bufferLength: buf.length,
        contentType: ct
      });
    }
  }

  const src = extractFirstImgSrc(html);
  newsletterDebug('resolve_logo_buffer.first_img_src', {
    hasSrc: Boolean(src),
    srcType: src
      ? (/^data:/i.test(src) ? 'data' : /^cid:/i.test(src) ? 'cid' : /^https?:/i.test(src) ? 'http' : 'other')
      : 'none'
  });

  if ((!buf || !buf.length) && src) {
    if (/^data:image\//i.test(src)) {
      const dataM = src.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,([\s\S]+)$/i);
      if (dataM) {
        try {
          buf = Buffer.from(String(dataM[2]).replace(/\s/g, ''), 'base64');
          ct = contentTypeFromDataSubtype(dataM[1]);
          newsletterDebug('resolve_logo_buffer.data_src_loaded', {
            bufferLength: buf.length,
            contentType: ct
          });
        } catch {
          buf = null;
          newsletterDebug('resolve_logo_buffer.data_src_decode_failed');
        }
      }
    } else if (/^cid:/i.test(src)) {
      // Si viene cid en HTML, ya intentamos primero desde configLogoUrl.
      newsletterDebug('resolve_logo_buffer.src_is_cid_without_buffer');
    } else {
      let webPath = null;
      if (src.startsWith('/uploads/logos/')) {
        webPath = src.split('?')[0];
      } else if (/^https?:\/\//i.test(src)) {
        try {
          const u = new URL(src);
          if (u.pathname.startsWith('/uploads/logos/')) {
            webPath = u.pathname.split('?')[0];
          }
        } catch {
          /* ignore */
        }
      }
      if (webPath) {
        buf = await readUploadedLogoFromWebPath(webPath);
        if (buf && buf.length) ct = contentTypeFromLogoFilename(webPath);
        newsletterDebug('resolve_logo_buffer.webpath_attempt', {
          webPath,
          loaded: Boolean(buf && buf.length),
          bufferLength: buf ? buf.length : 0,
          contentType: ct
        });
      }
    }
  }

  // Fallback final: usar logo de branding configurado si no se pudo resolver desde el HTML.
  if (
    (!buf || !buf.length) &&
    configLogoUrl &&
    typeof configLogoUrl === 'string' &&
    configLogoUrl.startsWith('/uploads/logos/')
  ) {
    const logoPath = configLogoUrl.split('?')[0];
    buf = await readUploadedLogoFromWebPath(logoPath);
    if (buf && buf.length) ct = contentTypeFromLogoFilename(logoPath);
    newsletterDebug('resolve_logo_buffer.config_logo_attempt', {
      logoPath,
      loaded: Boolean(buf && buf.length),
      bufferLength: buf ? buf.length : 0,
      contentType: ct
    });
  }

  if (buf && buf.length > 800000) {
    newsletterDebug('resolve_logo_buffer.final_skip_too_large', { bufferLength: buf.length, contentType: ct });
    return { buffer: null, contentType: ct };
  }
  newsletterDebug('resolve_logo_buffer.done', {
    hasBuffer: Boolean(buf && buf.length),
    bufferLength: buf ? buf.length : 0,
    contentType: ct
  });
  return { buffer: buf && buf.length ? buf : null, contentType: ct };
}

/**
 * Prepara HTML + adjuntos para boletín.
 * - Gmail suele NO mostrar data: en HTML; usa CID + multipart/related (estándar).
 * - Si defines NEWSLETTER_LOGO_BASE_URL (HTTPS público, solo para el logo), se usa URL absoluta (máxima compatibilidad con Gmail).
 * - Además del inline CID, se adjunta el mismo archivo: si un relay aplana MIME, el destinatario aún tiene el logo como archivo.
 */
async function prepareNewsletterEmailPayload(html, clientLogoAttachments) {
  const rawHtml = String(html);
  const config = await AppConfig.findOne();
  const logoUrl = config?.logoUrl;
  const publicBase = String(process.env.NEWSLETTER_LOGO_BASE_URL || '').trim().replace(/\/$/, '');
  newsletterDebug('prepare_payload.start', {
    rawHtmlLength: rawHtml.length,
    hasImgTag: /<img\b/i.test(rawHtml),
    hasConfigLogoUrl: Boolean(logoUrl),
    hasPublicBase: Boolean(publicBase)
  });

  // ─── Helper: convierte data: URIs de evidencias a CID ─────────────────────
  function processEvidenceImages(htmlIn, attachmentsArr) {
    const dataImageRegex = /<img\b[^>]*\ssrc=["']data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)["'][^>]*>/gi;
    let evidenceIndex = 0;
    let finalHtml = htmlIn;
    let match;
    const regexCopy = new RegExp(dataImageRegex.source, dataImageRegex.flags);
    while ((match = regexCopy.exec(htmlIn)) !== null) {
      evidenceIndex++;
      const imgTag = match[0];
      const imageType = match[1];
      const base64Data = match[2].replace(/\s/g, '');
      try {
        const evidenceBuffer = Buffer.from(base64Data, 'base64');
        if (evidenceBuffer.length > 5 * 1024 * 1024) {
          newsletterDebug('prepare_payload.evidence_skip_too_large', { index: evidenceIndex, size: evidenceBuffer.length });
          continue;
        }
        const evidenceCid = `evidence-${evidenceIndex}@bitacora-newsletter`;
        const evidenceExt = imageType === 'jpeg' || imageType === 'jpg' ? 'jpg' : imageType;
        const evidenceFilename = `evidence-${evidenceIndex}.${evidenceExt}`;
        const evidenceContentType = `image/${imageType === 'jpg' ? 'jpeg' : imageType}`;
        attachmentsArr.push({
          filename: evidenceFilename,
          content: evidenceBuffer,
          cid: evidenceCid,
          contentType: evidenceContentType,
          contentDisposition: 'inline'
        });
        const newImgTag = imgTag.replace(/src=["']data:image\/[^"']+["']/i, `src="cid:${evidenceCid}"`);
        finalHtml = finalHtml.replace(imgTag, newImgTag);
        newsletterDebug('prepare_payload.evidence_processed', {
          index: evidenceIndex, cid: evidenceCid, filename: evidenceFilename,
          size: evidenceBuffer.length, contentType: evidenceContentType
        });
      } catch (err) {
        newsletterDebug('prepare_payload.evidence_decode_failed', { index: evidenceIndex, error: err.message });
      }
    }
    return { finalHtml, evidenceCount: evidenceIndex };
  }
  // ──────────────────────────────────────────────────────────────────────────

  if (publicBase && logoUrl && typeof logoUrl === 'string' && logoUrl.startsWith('/uploads/logos/')) {
    const absolute = `${publicBase}${logoUrl}`;
    let htmlWithPublicLogo = /^<img\b/i.test(rawHtml) ? replaceFirstImgSrc(rawHtml, absolute) : rawHtml;
    htmlWithPublicLogo = removeLeadingDataImageTags(htmlWithPublicLogo);
    const attachments = [];
    const { finalHtml } = processEvidenceImages(htmlWithPublicLogo, attachments);
    newsletterDebug('prepare_payload.use_public_url', { absolute });
    return { html: finalHtml, attachments };
  }

  const { buffer: buf, contentType: ct } = await resolveNewsletterLogoBuffer(
    rawHtml,
    clientLogoAttachments,
    logoUrl
  );

  const attachments = [];

  if (!buf || !buf.length || !/<img\b/i.test(rawHtml)) {
    let out = rawHtml;
    const s = extractFirstImgSrc(out);
    if (s && (/^cid:/i.test(s) || /^data:/i.test(s))) {
      out = removeFirstImgTag(out);
      newsletterDebug('prepare_payload.removed_first_img', {
        reason: !buf || !buf.length ? 'no_logo_buffer' : 'no_img_tag',
        originalSrcType: /^cid:/i.test(s) ? 'cid' : 'data'
      });
    }
    newsletterDebug('prepare_payload.return_without_logo', {
      hasBuffer: Boolean(buf && buf.length),
      hasImgTag: /<img\b/i.test(rawHtml)
    });
    // Aún así convertir evidencias en el HTML restante
    const { finalHtml, evidenceCount } = processEvidenceImages(out, attachments);
    newsletterDebug('prepare_payload.done', { totalAttachments: attachments.length, evidenceImagesProcessed: evidenceCount });
    return { html: finalHtml, attachments };
  }

  const ext = extensionFromContentType(ct);
  const filename = `logo.${ext}`;
  const cid = NEWSLETTER_LOGO_CID;
  let htmlOut = replaceFirstImgSrc(rawHtml, `cid:${cid}`);
  htmlOut = removeLeadingDataImageTags(htmlOut);
  newsletterDebug('prepare_payload.use_cid', { cid, filename, contentType: ct, bufferLength: buf.length });

  attachments.push(
    { filename, content: buf, cid, contentType: ct, contentDisposition: 'inline' },
    { filename, content: buf, contentType: ct, contentDisposition: 'attachment' }
  );

  const { finalHtml, evidenceCount } = processEvidenceImages(htmlOut, attachments);

  newsletterDebug('prepare_payload.done', {
    totalAttachments: attachments.length,
    evidenceImagesProcessed: evidenceCount
  });

  return { html: finalHtml, attachments };
}

// GET /api/reports/overview - Vista general de KPIs
router.get('/overview', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);

    // 1. Total de entradas por tipo
    const entriesByType = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$entryType', count: { $sum: 1 } } }
    ]);

    // 2. Top usuarios por total de entradas (operativa + incidente)
    const incidentsByUser = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$createdByUsername', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // 3. Top tags
    const topTags = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);

    // 4. Checks con rojos por servicio
    const redsByService = await ShiftCheck.aggregate([
      { $match: { createdAt: { $gte: startDate }, hasRedServices: true } },
      { $unwind: '$services' },
      { $match: { 'services.status': 'rojo' } },
      { $group: { _id: '$services.serviceTitle', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // 5. Tendencia de entradas (últimos 30 días)
    const entriesTrend = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Santiago' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 6. Total usuarios activos
    const totalUsers = await User.countDocuments({ isActive: true });

    // 7. Total checks de turno
    const totalChecks = await ShiftCheck.countDocuments({ createdAt: { $gte: startDate } });

    await audit(req, {
      event: 'user.reports.overview.view',
      level: 'info',
      result: { success: true },
      metadata: { days: parsedDays }
    });

    res.json({
      period: `${days} días`,
      entriesByType: entriesByType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      incidentsByUser,
      topTags,
      redsByService,
      entriesTrend,
      totalUsers,
      totalChecks
    });
  } catch (error) {
    console.error('Error al generar reporte:', error);
    res.status(500).json({ message: 'Error al generar reporte' });
  }
});

// GET /api/reports/export-entries - Exportar entradas a CSV
// Solo admin puede exportar archivos
router.get('/export-entries', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const entries = await Entry.find(filter)
      .populate('createdBy', 'username fullName')
      .sort({ createdAt: -1 })
      .lean();

    // Generar CSV
    const csvHeader = 'ID,Fecha,Hora,Tipo,Contenido,Tags,Usuario,Es Invitado,Creado\n';
    const csvRows = entries.map(e => {
      const content = `"${(e.content || '').replace(/"/g, '""')}"`;
      const tags = e.tags.join('; ');
      return `${e._id},${e.entryDate.toISOString().split('T')[0]},${e.entryTime},${e.entryType},${content},${tags},${e.createdByUsername},${e.isGuestEntry},${e.createdAt.toISOString()}`;
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="entradas_${Date.now()}.csv"`);
    res.send('\ufeff' + csv); // BOM para UTF-8

    await audit(req, {
      event: 'user.reports.export.entries',
      level: 'info',
      result: { success: true },
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        exportedCount: entries.length
      }
    });
  } catch (error) {
    console.error('Error al exportar:', error);
    res.status(500).json({ message: 'Error al exportar datos' });
  }
});

// GET /api/reports/tags-trend - Tendencia de tags específicos
router.get('/tags-trend', authenticate, async (req, res) => {
  try {
    const { days = 30, tags } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    
    const tagsList = tags ? tags.split(',') : [];
    
    if (tagsList.length === 0) {
      return res.json([]);
    }
    
    // Tendencia para cada tag
    const trendsPromises = tagsList.map(async (tag) => {
      const trend = await Entry.aggregate([
        { 
          $match: { 
            createdAt: { $gte: startDate },
            tags: tag.trim()
          } 
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Santiago' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      
      return {
        tag: tag.trim(),
        trend
      };
    });
    
    const results = await Promise.all(trendsPromises);

    await audit(req, {
      event: 'user.reports.tags_trend.view',
      level: 'info',
      result: { success: true },
      metadata: {
        days: parsedDays,
        tagsCount: tagsList.length
      }
    });

    res.json(results);
  } catch (error) {
    console.error('Error al obtener tendencias de tags:', error);
    res.status(500).json({ message: 'Error al obtener tendencias de tags' });
  }
});

// GET /api/reports/heatmap - Mapa de calor día/hora
router.get('/heatmap', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    
    const heatmapData = await Entry.aggregate([
      {
        $match: {
          entryDate: { $gte: startDate },
          entryTime: { $regex: /^\d{2}:\d{2}/ }
        }
      },
      {
        $addFields: {
          entryDateTime: {
            $dateFromParts: {
              year: { $year: '$entryDate' },
              month: { $month: '$entryDate' },
              day: { $dayOfMonth: '$entryDate' },
              hour: { $toInt: { $substr: ['$entryTime', 0, 2] } },
              minute: { $toInt: { $substr: ['$entryTime', 3, 2] } },
              timezone: 'America/Santiago'
            }
          }
        }
      },
      {
        $group: {
          _id: {
            dayOfWeek: { $dayOfWeek: { date: '$entryDateTime', timezone: 'America/Santiago' } },
            hour: { $hour: { date: '$entryDateTime', timezone: 'America/Santiago' } }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          dayOfWeek: { $subtract: ['$_id.dayOfWeek', 1] },
          hour: '$_id.hour',
          count: '$count'
        }
      },
      { $sort: { dayOfWeek: 1, hour: 1 } }
    ]);

    await audit(req, {
      event: 'user.reports.heatmap.view',
      level: 'info',
      result: { success: true },
      metadata: {
        days: parsedDays,
        buckets: heatmapData.length
      }
    });
    
    res.json(heatmapData);
  } catch (error) {
    console.error('Error al generar heatmap:', error);
    res.status(500).json({ message: 'Error al generar heatmap' });
  }
});

// GET /api/reports/entries-by-logsource - Entradas por Log Source (Cliente)
router.get('/entries-by-logsource', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    
    const entriesBySource = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$clientName',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);
    
    // Transformar para NGX-Charts (name, value)
    const data = entriesBySource.map(item => ({
      name: item._id || 'Sin asignar',
      value: item.count
    }));

    await audit(req, {
      event: 'user.reports.entries_by_logsource.view',
      level: 'info',
      result: { success: true },
      metadata: {
        days: parsedDays,
        items: data.length
      }
    });
    
    res.json(data);
  } catch (error) {
    console.error('Error al obtener entradas por log source:', error);
    res.status(500).json({ message: 'Error al obtener entradas por log source' });
  }
});

// GET /api/reports/mail-analytics - Analítica de envíos de boletines y reportes
router.get('/mail-analytics', authenticate, async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await AuditLog.find({
      timestamp: { $gte: startDate },
      $or: [
        {
          event: { $in: ['mail.send.success', 'mail.send.fail'] },
          $or: [
            { 'metadata.sourceModule': 'ReportGenerator' },
            { 'metadata.triggerType': { $in: ['manual_newsletter', 'manual_incident_report'] } },
            { 'metadata.type': { $in: ['newsletter', 'incident_mjml'] } }
          ]
        },
        { event: { $in: ['mail.incident.attempt', 'mail.incident.sent', 'mail.incident.fail'] } }
      ]
    })
      .select('event timestamp metadata')
      .sort({ timestamp: -1 })
      .lean();

    const sentMessages = { newsletter: 0, incident: 0, combined: 0 };
    const recipientCounts = { newsletter: 0, incident: 0, combined: 0 };
    const uniqueRecipientSet = new Set();
    const statusSummary = { success: 0, fail: 0, attempt: 0 };
    const statusByType = {
      newsletter: { success: 0, fail: 0, attempt: 0 },
      incident: { success: 0, fail: 0, attempt: 0 }
    };

    const topRecipients = {
      newsletter: new Map(),
      incident: new Map(),
      combined: new Map()
    };
    const topDomains = {
      newsletter: new Map(),
      incident: new Map(),
      combined: new Map()
    };
    const topClients = {
      incident: new Map(),
      combined: new Map()
    };
    const criticality = {
      newsletter: new Map(),
      incident: new Map(),
      combined: new Map()
    };
    const generationByDay = {
      newsletter: new Map(),
      incident: new Map()
    };
    const deliveryByDay = {
      success: new Map(),
      fail: new Map()
    };
    const activityByHour = new Map();

    let criticalityKnown = 0;
    let criticalityMissing = 0;
    let clientKnown = 0;
    let clientMissing = 0;

    for (const log of logs) {
      const metadata = log.metadata || {};
      const type = detectMailAnalyticsType(log);
      if (!type) continue;

      const status = detectMailAnalyticsStatus(log.event);
      if (status) {
        statusSummary[status] += 1;
        statusByType[type][status] += 1;
      }

      const isCanonicalDeliveryEvent = log.event === 'mail.send.success' || log.event === 'mail.send.fail';
      const dayBucket = getDayBucket(log.timestamp);
      if (dayBucket) {
        if (isCanonicalDeliveryEvent && status === 'success') {
          incrementCounter(generationByDay[type], dayBucket);
        }
        if (isCanonicalDeliveryEvent && (status === 'success' || status === 'fail')) {
          incrementCounter(deliveryByDay[status], dayBucket);
        }
      }

      const hourBucket = getHourBucket(log.timestamp);
      if (hourBucket !== null && isCanonicalDeliveryEvent) {
        incrementCounter(activityByHour, `${hourBucket}:00`);
      }

      if (status !== 'success' || log.event !== 'mail.send.success') {
        continue;
      }

      const recipients = Array.isArray(metadata.toMasked)
        ? metadata.toMasked.filter(Boolean)
        : Array.isArray(metadata.resolvedRecipientsPreview)
          ? metadata.resolvedRecipientsPreview.filter(Boolean)
          : [];
      const recipientsCount = Number(
        metadata.resolvedRecipientsCount
        || metadata.recipientsCount
        || metadata.toCount
        || recipients.length
        || 0
      );

      sentMessages[type] += 1;
      sentMessages.combined += 1;
      recipientCounts[type] += recipientsCount;
      recipientCounts.combined += recipientsCount;

      recipients.forEach((recipient) => {
        incrementCounter(topRecipients[type], recipient);
        incrementCounter(topRecipients.combined, recipient);
        uniqueRecipientSet.add(recipient);

        const domain = String(recipient).includes('@')
          ? String(recipient).split('@').pop()
          : 'Sin dominio';
        incrementCounter(topDomains[type], domain);
        incrementCounter(topDomains.combined, domain);
      });

      const criticalityLabel = normalizeCriticalityLabel(metadata.criticality || metadata.criticidad);
      if (criticalityLabel) {
        incrementCounter(criticality[type], criticalityLabel);
        incrementCounter(criticality.combined, criticalityLabel);
        criticalityKnown += 1;
      } else {
        criticalityMissing += 1;
      }

      if (type === 'incident') {
        const clientLabel = resolveClientLabelFromMetadata(metadata);
        if (clientLabel) {
          incrementCounter(topClients.incident, clientLabel);
          incrementCounter(topClients.combined, clientLabel);
          clientKnown += 1;
        } else {
          clientMissing += 1;
        }
      }
    }

    const comparisonOrder = ['Crítico', 'Alto', 'Medio', 'Bajo'];
    const criticalityComparison = comparisonOrder
      .map((label) => ({
        name: label,
        series: [
          { name: 'Boletines', value: criticality.newsletter.get(label) || 0 },
          { name: 'Incidentes', value: criticality.incident.get(label) || 0 }
        ]
      }));

    const allDays = Array.from(new Set([
      ...Array.from(generationByDay.newsletter.keys()),
      ...Array.from(generationByDay.incident.keys()),
      ...Array.from(deliveryByDay.success.keys()),
      ...Array.from(deliveryByDay.fail.keys())
    ])).sort();

    const generationTrend = [
      {
        name: 'Boletines',
        series: allDays.map((day) => ({ name: day, value: generationByDay.newsletter.get(day) || 0 }))
      },
      {
        name: 'Incidentes',
        series: allDays.map((day) => ({ name: day, value: generationByDay.incident.get(day) || 0 }))
      }
    ];

    const deliveryStatusTrend = [
      {
        name: 'Envíos exitosos',
        series: allDays.map((day) => ({ name: day, value: deliveryByDay.success.get(day) || 0 }))
      },
      {
        name: 'Envíos fallidos',
        series: allDays.map((day) => ({ name: day, value: deliveryByDay.fail.get(day) || 0 }))
      }
    ];

    const hourlyActivity = Array.from({ length: 24 }, (_, hour) => {
      const label = `${String(hour).padStart(2, '0')}:00`;
      return { name: label, value: activityByHour.get(label) || 0 };
    });

    const deliveryStatusSummary = [
      { name: 'Exitosos', value: statusSummary.success },
      { name: 'Fallidos', value: statusSummary.fail },
      { name: 'Intentos', value: statusSummary.attempt }
    ];

    const statusByTypeSeries = [
      {
        name: 'Boletines',
        series: [
          { name: 'Exitosos', value: statusByType.newsletter.success },
          { name: 'Fallidos', value: statusByType.newsletter.fail },
          { name: 'Intentos', value: statusByType.newsletter.attempt }
        ]
      },
      {
        name: 'Incidentes',
        series: [
          { name: 'Exitosos', value: statusByType.incident.success },
          { name: 'Fallidos', value: statusByType.incident.fail },
          { name: 'Intentos', value: statusByType.incident.attempt }
        ]
      }
    ];

    return res.json({
      period: `${days} días`,
      sentMessages,
      recipientCounts,
      uniqueRecipients: uniqueRecipientSet.size,
      statusSummary,
      statusByType,
      recipientBreakdown: {
        newsletter: mapToSeries(topRecipients.newsletter, 10),
        incident: mapToSeries(topRecipients.incident, 10),
        combined: mapToSeries(topRecipients.combined, 10)
      },
      domainBreakdown: {
        newsletter: mapToSeries(topDomains.newsletter, 10),
        incident: mapToSeries(topDomains.incident, 10),
        combined: mapToSeries(topDomains.combined, 10)
      },
      clientBreakdown: {
        incident: mapToSeries(topClients.incident, 10),
        combined: mapToSeries(topClients.combined, 10)
      },
      criticalityBreakdown: {
        newsletter: mapToSeries(criticality.newsletter, 10),
        incident: mapToSeries(criticality.incident, 10),
        combined: mapToSeries(criticality.combined, 10)
      },
      criticalityComparison,
      generationTrend,
      deliveryStatusTrend,
      hourlyActivity,
      deliveryStatusSummary,
      statusByTypeSeries,
      metadataQuality: {
        criticalityKnown,
        criticalityMissing,
        clientKnown,
        clientMissing
      }
    });
  } catch (error) {
    console.error('Error generando analítica de correo:', error);
    return res.status(500).json({ message: 'Error generando analítica de correo' });
  }
});

// POST /api/reports/newsletter/validate - Validación previa de destinatarios
router.post('/newsletter/validate', authenticate, async (req, res) => {
  try {
    const analysis = analyzeRecipientEmails(req.body?.recipients || []);
    res.json({
      validRecipients: analysis.valid,
      invalidRecipients: analysis.invalid,
      duplicateRecipients: analysis.duplicates,
      validCount: analysis.valid.length,
      invalidCount: analysis.invalid.length,
      duplicateCount: analysis.duplicates.length,
      totalSubmitted: analysis.totalSubmitted
    });
  } catch (error) {
    res.status(400).json({
      message: 'No se pudo validar la lista de destinatarios',
      detail: error.message
    });
  }
});

// POST /api/reports/newsletter/send - Envío de boletines (1:1 o agrupado por dominio con CC compartido)
router.post('/newsletter/send', authenticate, async (req, res) => {
  try {
    const { recipients, cc, subject, html, analytics } = req.body;
    const groupByDomain = parseBooleanFlag(req.body?.groupByDomain, true);
    const sendMode = 'real';
    const analysis = analyzeRecipientEmails(recipients || []);

    if (analysis.valid.length === 0) {
      return res.status(400).json({
        message: 'Se requiere al menos un destinatario válido',
        detail: 'Corrige los correos inválidos o duplicados antes de enviar.'
      });
    }

    if (!html) {
      return res.status(400).json({ message: 'Se requiere el contenido HTML del boletín' });
    }

    // Validar y deduplicar lista de CC
    const ccAnalysis = analyzeRecipientEmails(Array.isArray(cc) ? cc : []);
    const validCcBase = ccAnalysis.valid; // lista CC sin filtrar por destinatario

    const toSet = new Set(analysis.valid.map((email) => email.toLowerCase()));
    const overlapRecipients = validCcBase.filter((email) => toSet.has(email.toLowerCase()));
    if (overlapRecipients.length > 0) {
      return res.status(400).json({
        message: 'No se permite repetir correos entre Para y CC',
        detail: `Corrige estos correos repetidos: ${overlapRecipients.join(', ')}`,
        overlapRecipients
      });
    }

    const recipientBatches = buildRecipientBatches(analysis.valid, groupByDomain);

    const prepared = await prepareNewsletterEmailPayload(html, req.body.inlineAttachments);
    const emailHtml = prepared.html;
    const newsletterAttachments = prepared.attachments;
    const plainText = htmlToBasicPlainText(emailHtml);

    // Envío secuencial por lote: por dominio cuando groupByDomain=true,
    // o 1:1 cuando groupByDomain=false.
    let successCount = 0;
    let failCount = 0;
    let lastError = null;
    let successGroups = 0;
    let failGroups = 0;

    for (const batch of recipientBatches) {
      // Excluir del CC cualquier correo que ya esté en Para dentro del lote actual.
      const toSetBatch = new Set(batch.to.map((email) => email.toLowerCase()));
      const ccForThis = validCcBase.filter(c => !toSetBatch.has(c.toLowerCase()));
      try {
        const sendResult = await sendEmail({
          to: batch.to,
          cc: ccForThis.length ? ccForThis : undefined,
          subject: subject || 'Boletín de Seguridad',
          html: emailHtml,
          text: plainText,
          attachments: newsletterAttachments.length ? newsletterAttachments : undefined,
          auditContext: {
            sourceModule: 'ReportGenerator',
            triggerType: 'manual_newsletter',
            extra: {
              type: 'newsletter',
              mode: sendMode,
              criticality: String(analytics?.criticality || '').trim().toLowerCase() || null,
              bulletinTitle: String(analytics?.title || subject || '').trim() || null,
              vendor: String(analytics?.vendor || '').trim() || null,
              newsletterAttachmentParts: newsletterAttachments.length,
              duplicateCount: analysis.duplicates.length,
              invalidCount: analysis.invalid.length,
              ccCount: ccForThis.length,
              groupedByDomain: groupByDomain,
              recipientBatchDomain: batch.domain,
              recipientBatchSize: batch.to.length
            }
          }
        });

        const attemptedSet = new Set(batch.to.map((email) => email.toLowerCase()));
        const acceptedSet = new Set(
          (Array.isArray(sendResult?.acceptedTo) ? sendResult.acceptedTo : [])
            .map((email) => String(email || '').toLowerCase())
            .filter((email) => attemptedSet.has(email))
        );
        const rejectedSet = new Set(
          (Array.isArray(sendResult?.rejectedTo) ? sendResult.rejectedTo : [])
            .map((email) => String(email || '').toLowerCase())
            .filter((email) => attemptedSet.has(email))
        );

        // Si el transport no informa accepted/rejected por destinatario, asumimos éxito total del lote.
        const acceptedCount = acceptedSet.size > 0 ? acceptedSet.size : batch.to.length;
        const unresolvedCount = Math.max(0, batch.to.length - acceptedCount - rejectedSet.size);
        const failCountForBatch = rejectedSet.size + unresolvedCount;

        successCount += acceptedCount;
        failCount += failCountForBatch;
        if (acceptedCount > 0) successGroups += 1;
        if (failCountForBatch > 0) failGroups += 1;
      } catch (err) {
        console.error(`[newsletter/send] Error al enviar lote ${batch.key}:`, err.message);
        lastError = err.message;
        failCount += batch.to.length;
        failGroups += 1;
      }
    }

    if (successCount === 0 && failCount > 0) {
      return res.status(500).json({
        message: 'Error SMTP al enviar boletín',
        detail: lastError || 'Error desconocido — revisa la configuración SMTP en Admin.'
      });
    }

    res.json({
      success: true,
      mode: sendMode,
      groupByDomain,
      successCount,
      failCount,
      successGroups,
      failGroups,
      processedGroups: recipientBatches.length,
      ccCount: validCcBase.length,
      duplicateCount: analysis.duplicates.length,
      invalidCount: analysis.invalid.length,
      processedRecipients: analysis.valid.length,
      message: `Boletín enviado: ${successCount} correctos, ${failCount} fallidos`
    });
  } catch (error) {
    console.error('[newsletter/send] Error inesperado:', error);
    res.status(500).json({
      message: 'Error interno al enviar boletines',
      detail: error.message
    });
  }
});
// POST /api/reports/incident/preview - Previsualización MJML del reporte (sin envío)
router.post('/incident/preview', authenticate, async (req, res) => {
  try {
    const { reportData, images } = req.body;
    if (!reportData) return res.status(400).json({ message: 'Se requiere reportData' });

    const config  = await AppConfig.findOne();
    const logoUrl = config?.logoUrl;
    const brandName = config?.appTitle || 'Bitácora SOC';
    let logoCid = null;
    const attachments = [];

    const logoWebPath = resolveUploadedLogoWebPath(logoUrl);
    if (logoWebPath) {
      const logoBuf = await readUploadedLogoFromWebPath(logoWebPath);
      if (logoBuf && logoBuf.length) {
        const ct = contentTypeFromLogoFilename(logoWebPath);
        const outlinedLogo = await buildIncidentEmailLogoVariant(logoBuf, ct);
        // Para preview: embebemos el logo como data URI en el HTML
        logoCid = `data:${outlinedLogo.contentType};base64,${outlinedLogo.buffer.toString('base64')}`;
        void attachments; // no se usan en preview
      }
    }

    // Para preview: reemplazar CIDs de evidencias con data URIs reales
    const imgList = Array.isArray(images) ? images : [];
    // Modificamos buildIncidentEmail para que use data URIs directamente en preview
    const previewImages = imgList.map((img, idx) => ({
      ...img,
      _previewSrc: img.contentBase64
        ? `data:${/^image\//.test(img.contentType) ? img.contentType : 'image/png'};base64,${img.contentBase64}`
        : null
    }));

    const autor = req.user?.fullName || req.user?.username || 'Analista SOC';

    // Compilar MJML con data URIs para que el preview sea visible en el navegador
    const { buildIncidentEmailPreview } = require('../utils/incidentEmailTemplate');
    const paletteKey = config?.incidentEmailPaletteKey || 'cdc-verde';
    const { html, errors } = await buildIncidentEmailPreview({
      reportData, images: previewImages, logoCid, autor, brandName, paletteKey
    });

    if (errors && errors.length > 0) console.warn('[incident/preview] MJML warnings:', errors);

    res.json({ html: html || '' });
  } catch (error) {
    console.error('[incident/preview] Error:', error);
    res.status(500).json({ message: 'Error al generar preview', detail: error.message });
  }
});

// POST /api/reports/incident/send - Envío de reporte de incidente (MJML)
router.post('/incident/send', authenticate, async (req, res) => {
  const { to, cc, subject, reportData, images } = req.body;
  try {

    // Validar destinatario
    const analysisTo = analyzeRecipientEmails(to || []);
    if (analysisTo.valid.length === 0) {
      return res.status(400).json({
        message: 'Se requiere al menos un destinatario válido en Para',
        detail: 'Corrige los correos inválidos antes de enviar.'
      });
    }
    const validCc = analyzeRecipientEmails(cc || []).valid;

    if (!reportData) {
      return res.status(400).json({ message: 'Se requiere reportData con los campos del incidente' });
    }

    const reportClient = String(reportData?.logSource || reportData?.clientName || reportData?.cliente || '').trim();
    if (!reportClient) {
      return res.status(400).json({
        message: 'Se requiere cliente / logSource para enviar reporte de incidente',
        detail: 'Selecciona un cliente (Log Source) antes de enviar para mantener trazabilidad.'
      });
    }

    // ── Registro de intento (siempre se guarda, antes de cualquier procesamiento) ──
    await audit(req, {
      event: 'mail.incident.attempt',
      level: 'info',
      result: { success: true, reason: 'Intento de envío de reporte de incidente iniciado' },
      metadata: {
        toCount: analysisTo.valid.length,
        ccCount: validCc.length,
        subject: subject || 'Reporte de Incidente de Seguridad',
        reportFields: Object.keys(reportData || {}),
        imageCount: Array.isArray(images) ? images.length : 0,
        invalidToCount: analysisTo.invalid?.length || 0,
        duplicateToCount: analysisTo.duplicates?.length || 0,
      }
    }).catch(err => console.error('[incident/send] audit attempt error:', err.message));

    // Resolver logo desde config
    const config = await AppConfig.findOne();
    const logoUrl = config?.logoUrl;
    let logoCid = null;
    const attachments = [];

    const logoWebPath = resolveUploadedLogoWebPath(logoUrl);
    if (logoWebPath) {
      const logoBuf = await readUploadedLogoFromWebPath(logoWebPath);
      if (logoBuf && logoBuf.length) {
        const logoCidStr = NEWSLETTER_LOGO_CID;
        const logoCt = contentTypeFromLogoFilename(logoWebPath);
        const outlinedLogo = await buildIncidentEmailLogoVariant(logoBuf, logoCt);
        attachments.push({
          filename: `logo-email.${outlinedLogo.extension}`,
          content: outlinedLogo.buffer,
          cid: logoCidStr,
          contentType: outlinedLogo.contentType,
          contentDisposition: 'inline'
        });
        logoCid = `cid:${logoCidStr}`;
      }
    }

    // Procesar imágenes de evidencia
    const imgList = Array.isArray(images) ? images : [];
    imgList.forEach((img, idx) => {
      if (!img.contentBase64) return;
      try {
        const buf = Buffer.from(String(img.contentBase64).replace(/\s/g, ''), 'base64');
        if (!buf.length || buf.length > 6 * 1024 * 1024) return;
        const ct  = /^image\//.test(img.contentType) ? img.contentType : 'image/png';
        const ext = ct === 'image/jpeg' ? 'jpg' : 'png';
        const cid = `evidence-${idx + 1}@bitacora-incident`;
        attachments.push({
          filename: img.name || `evidence-${idx + 1}.${ext}`,
          content: buf,
          cid,
          contentType: ct,
          contentDisposition: 'inline'
        });
      } catch { /* ignorar imágenes corruptas */ }
    });

    // Obtener nombre del analista y nombre de la bitácora
    const autor     = req.user?.fullName || req.user?.username || 'Analista SOC';
    const brandName = config?.appTitle || 'Bitácora SOC';

    // Compilar MJML -> HTML
    const paletteKey = config?.incidentEmailPaletteKey || 'cdc-verde';
    const { html: emailHtml, errors: mjmlErrors } = await buildIncidentEmail({
      reportData,
      images: imgList,
      logoCid,
      autor,
      brandName,
      paletteKey
    });

    if (mjmlErrors && mjmlErrors.length > 0) {
      console.warn('[incident/send] MJML warnings:', mjmlErrors);
    }

    const plainText = htmlToBasicPlainText(emailHtml);

    try {
      await sendEmail({
        to: analysisTo.valid,
        cc: validCc,
        subject: subject || 'Reporte de Incidente de Seguridad',
        html: emailHtml,
        text: plainText,
        attachments: attachments.length ? attachments : undefined,
        auditContext: {
          sourceModule: 'ReportGenerator',
          triggerType: 'manual_incident_report',
          extra: {
            type: 'incident_mjml',
            criticality: String(reportData?.criticidad || '').trim().toLowerCase() || null,
            clientName: String(reportData?.clientName || reportData?.cliente || reportData?.logSource || '').trim() || null,
            client: String(reportData?.clientName || reportData?.cliente || reportData?.ofensa || '').trim() || null,
            ofensa: String(reportData?.ofensa || '').trim() || null,
            logSource: String(reportData?.logSource || '').trim() || null,
            eventName: String(reportData?.nombreEvento || '').trim() || null,
            attachmentParts: attachments.length,
            toCount: analysisTo.valid.length,
            ccCount: validCc.length
          }
        }
      });

      await audit(req, {
        event: 'mail.incident.sent',
        level: 'info',
        result: { success: true, reason: 'Reporte de incidente enviado correctamente' },
        metadata: {
          toCount: analysisTo.valid.length,
          ccCount: validCc.length,
          subject: subject || 'Reporte de Incidente de Seguridad',
          attachmentParts: attachments.length,
          paletteKey,
        }
      }).catch(err => console.error('[incident/send] audit sent error:', err.message));

      res.json({
        success: true,
        message: 'Reporte de incidente enviado correctamente',
        toCount: analysisTo.valid.length,
        ccCount: validCc.length
      });
    } catch (err) {
      console.error('[incident/send] Error SMTP:', err.message);
      await audit(req, {
        event: 'mail.incident.fail',
        level: 'warn',
        result: { success: false, reason: err.message },
        metadata: {
          toCount: analysisTo.valid.length,
          ccCount: validCc.length,
          subject: subject || 'Reporte de Incidente de Seguridad',
          error: err.message,
        }
      }).catch(e => console.error('[incident/send] audit fail error:', e.message));
      return res.status(500).json({
        message: 'Error SMTP al enviar el reporte',
        detail: err.message || 'Error desconocido — revisa la configuración SMTP en Admin.'
      });
    }
  } catch (error) {
    console.error('[incident/send] Error inesperado:', error);
    await audit(req, {
      event: 'mail.incident.fail',
      level: 'error',
      result: { success: false, reason: error.message },
      metadata: {
        subject: subject || 'Reporte de Incidente de Seguridad',
        error: error.message,
        phase: 'pre-send',
      }
    }).catch(e => console.error('[incident/send] audit unexpected error:', e.message));
    res.status(500).json({
      message: 'Error interno al enviar el reporte',
      detail: error.message
    });
  }
});

module.exports = router;
