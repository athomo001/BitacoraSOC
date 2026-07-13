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
const { parseBooleanFlag } = require('../utils/boolean-helper');
const router = express.Router();
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const ShiftAssignment = require('../models/ShiftAssignment');
const User = require('../models/User');
const Contact = require('../models/Contact');
const DirectoryContact = require('../models/DirectoryContact');
const AppConfig = require('../models/AppConfig');
const ReportHistory = require('../models/ReportHistory');
const { authenticate, authorize } = require('../middleware/auth');
const AuditLog = require('../models/AuditLog');
const { audit } = require('../utils/audit');
const { sendEmail, getSMTPConfig } = require('../utils/email');
const { analyzeRecipientEmails } = require('../utils/contactDirectory');
const { buildIncidentEmail } = require('../utils/incidentEmailTemplate');
const {
  htmlToBasicPlainText,
  locateFirstImgSrcRange,
  extractFirstImgSrc,
  replaceFirstImgSrc,
  removeFirstImgTag,
  removeLeadingDataImageTags,
  contentTypeFromLogoFilename,
  contentTypeFromDataSubtype
} = require('../utils/email-templates-helper');

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

/**
 * Obtiene dinámicamente la lista de dominios de email válidos del SOC
 * a partir de la configuración SMTP, usuarios registrados y directorio de contactos.
 * @returns {Promise<Set<string>>} Conjunto de dominios válidos en minúsculas
 */
const getValidSOCDomains = async () => {
  const domains = new Set();
  
  // 1. Dominio del remitente SMTP configurado
  try {
    const smtpConfig = await getSMTPConfig();
    if (smtpConfig) {
      if (smtpConfig.from) {
        const fromEmail = smtpConfig.from.includes('<') ? smtpConfig.from.match(/<\s*([^>]+)\s*>/)?.[1] : smtpConfig.from;
        if (fromEmail && fromEmail.includes('@')) {
          domains.add(fromEmail.split('@')[1].toLowerCase().trim());
        }
      }
      if (smtpConfig.user && smtpConfig.user.includes('@')) {
        domains.add(smtpConfig.user.split('@')[1].toLowerCase().trim());
      }
    }
  } catch (err) {
    console.error('[getValidSOCDomains] Error leyendo dominio SMTP:', err.message);
  }

  // 2. Dominios de usuarios, contactos y directorio de contactos
  try {
    const [users, contacts, dirContacts] = await Promise.all([
      User.find({}, 'email').lean(),
      Contact.find({ active: true }, 'email'),
      DirectoryContact.find({}, 'email')
    ]);

    const addEmailDomain = (email) => {
      if (email && email.includes('@')) {
        const parts = email.split('@');
        if (parts[1]) {
          domains.add(parts[1].toLowerCase().trim());
        }
      }
    };

    users.forEach(u => addEmailDomain(u.email));
    contacts.forEach(c => addEmailDomain(c.email));
    dirContacts.forEach(d => addEmailDomain(d.email));
  } catch (err) {
    console.error('[getValidSOCDomains] Error al consultar colecciones:', err.message);
  }

  return domains;
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

const parseHistoryLimit = (rawLimit) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(parsed, 1), 100);
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

// Nota: Las funciones auxiliares de procesamiento HTML e imágenes de correo
// fueron modularizadas y se importan desde backend/src/utils/email-templates-helper.js

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

// GET /api/reports/history - Historial compartido de reportes/boletines
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = parseHistoryLimit(req.query.limit);

    const [items, total] = await Promise.all([
      ReportHistory.find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean(),
      ReportHistory.countDocuments({})
    ]);

    res.json({
      items: items.map((item) => ({
        id: String(item._id),
        type: item.type,
        title: item.title,
        timestamp: item.timestamp,
        html: item.html,
        createdBy: item.createdBy || null,
        createdByUsername: item.createdByUsername || ''
      })),
      total
    });
  } catch (error) {
    console.error('Error loading reports history:', error);
    res.status(500).json({ message: 'Error al obtener historial de reportes' });
  }
});

// POST /api/reports/history - Registrar item en historial compartido
router.post('/history', authenticate, authorize('admin', 'user', 'auditor'), async (req, res) => {
  try {
    const type = String(req.body?.type || '').trim();
    const title = String(req.body?.title || '').trim();
    const html = String(req.body?.html || '').trim();
    const timestamp = req.body?.timestamp ? new Date(req.body.timestamp) : new Date();

    if (!['report', 'newsletter'].includes(type)) {
      return res.status(400).json({ message: 'Tipo de historial inválido' });
    }

    if (!title) {
      return res.status(400).json({ message: 'El título del historial es obligatorio' });
    }

    if (!html) {
      return res.status(400).json({ message: 'El contenido del historial es obligatorio' });
    }

    if (Number.isNaN(timestamp.getTime())) {
      return res.status(400).json({ message: 'Timestamp inválido' });
    }

    const item = await ReportHistory.create({
      type,
      title,
      html,
      timestamp,
      createdBy: req.user._id,
      createdByUsername: req.user.username || ''
    });

    res.status(201).json({
      id: String(item._id),
      type: item.type,
      title: item.title,
      timestamp: item.timestamp,
      html: item.html,
      createdBy: item.createdBy,
      createdByUsername: item.createdByUsername
    });
  } catch (error) {
    console.error('Error saving reports history:', error);
    res.status(500).json({ message: 'Error al guardar historial de reportes' });
  }
});

// DELETE /api/reports/history/:id - Eliminar item de historial (solo admin)
router.delete('/history/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const removed = await ReportHistory.findByIdAndDelete(req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Registro de historial no encontrado' });
    }
    res.json({ message: 'Registro eliminado del historial' });
  } catch (error) {
    console.error('Error deleting history item:', error);
    res.status(500).json({ message: 'Error al eliminar registro del historial' });
  }
});

// DELETE /api/reports/history - Limpiar historial completo (solo admin)
router.delete('/history', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const result = await ReportHistory.deleteMany({});
    res.json({ message: 'Historial limpiado', deletedCount: result.deletedCount || 0 });
  } catch (error) {
    console.error('Error clearing reports history:', error);
    res.status(500).json({ message: 'Error al limpiar historial de reportes' });
  }
});

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
router.get('/export-entries', authenticate, authorize('admin', 'auditor'), async (req, res) => {
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

    // Generar CSV sanitizado contra inyecciones de fórmulas (mitigación de CSV Injection)
    const escapeCsvValue = (val) => {
      let strVal = String(val === null || val === undefined ? '' : val);
      if (strVal.startsWith('=') || strVal.startsWith('+') || strVal.startsWith('-') || strVal.startsWith('@')) {
        strVal = `'` + strVal;
      }
      return strVal;
    };

    const csvHeader = 'ID,Fecha,Hora,Tipo,Contenido,Tags,Usuario,Es Invitado,Creado\n';
    const csvRows = entries.map(e => {
      const id = escapeCsvValue(e._id);
      const date = e.entryDate ? e.entryDate.toISOString().split('T')[0] : '';
      const time = escapeCsvValue(e.entryTime);
      const type = escapeCsvValue(e.entryType);
      const rawContent = escapeCsvValue(e.content || '');
      const content = `"${rawContent.replace(/"/g, '""')}"`;
      const tags = escapeCsvValue(e.tags ? e.tags.join('; ') : '');
      const username = escapeCsvValue(e.createdByUsername);
      const isGuest = escapeCsvValue(e.isGuestEntry);
      const createdAt = e.createdAt ? e.createdAt.toISOString() : '';

      return `${id},${date},${time},${type},${content},${tags},${username},${isGuest},${createdAt}`;
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

/**
 * Ejecuta una lista de tareas asíncronas de forma concurrente con un límite máximo
 * @param {Array<Function>} tasks - Funciones que devuelven promesas
 * @param {number} limit - Límite máximo de concurrencia activa
 * @returns {Promise<Array>} Resultados de todas las promesas
 */
const limitConcurrency = async (tasks, limit) => {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
};

// POST /api/reports/newsletter/send - Envío de boletines (1:1 o agrupado por dominio con CC compartido)
router.post('/newsletter/send', authenticate, authorize('admin', 'user', 'auditor'), async (req, res) => {
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

    // Validar abusos de SMTP Relay: dominios autorizados del SOC
    const validDomains = await getValidSOCDomains();
    const allDestEmails = [...new Set([...analysis.valid, ...validCcBase])].map(email => String(email || '').toLowerCase().trim());
    
    for (const email of allDestEmails) {
      if (!email.includes('@')) continue;
      const domain = email.split('@')[1];
      if (!validDomains.has(domain)) {
        return res.status(400).json({
          message: 'Destinatario no autorizado',
          detail: `El dominio del correo ${email} no pertenece a los destinatarios válidos del SOC.`
        });
      }
    }

    const toSet = new Set(analysis.valid.map((email) => email.toLowerCase()));
    const overlapRecipients = validCcBase.filter((email) => toSet.has(email.toLowerCase()));
    if (overlapRecipients.length > 0) {
      return res.status(400).json({
        message: 'No se permite repetir correos entre Para y CC',
        detail: `Corrige estos correos repetidos: ${overlapRecipients.join(', ')}`,
        overlapRecipients
      });
    }

    const auditUser = req.user;
    const auditIp = req.ip;
    const auditHeaders = req.headers;
    const inlineAttachments = req.body.inlineAttachments;

    // Responder inmediatamente indicando que el boletín ha sido aceptado para procesamiento en segundo plano
    res.status(202).json({
      success: true,
      message: 'El envío del boletín ha sido encolado en segundo plano.',
      processedRecipients: analysis.valid.length,
      ccCount: validCcBase.length
    });

    // Procesamiento asíncrono desacoplado de la respuesta HTTP
    setImmediate(async () => {
      try {
        const recipientBatches = buildRecipientBatches(analysis.valid, groupByDomain);
        const prepared = await prepareNewsletterEmailPayload(html, inlineAttachments);
        const emailHtml = prepared.html;
        const newsletterAttachments = prepared.attachments;
        const plainText = htmlToBasicPlainText(emailHtml);

        let successCount = 0;
        let failCount = 0;
        let lastError = null;
        let successGroups = 0;
        let failGroups = 0;

        const tasks = recipientBatches.map((batch) => async () => {
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

            const acceptedCount = acceptedSet.size > 0 ? acceptedSet.size : batch.to.length;
            const unresolvedCount = Math.max(0, batch.to.length - acceptedCount - rejectedSet.size);
            const failCountForBatch = rejectedSet.size + unresolvedCount;

            return {
              success: true,
              acceptedCount,
              failCountForBatch,
              batchKey: batch.key
            };
          } catch (err) {
            console.error(`[newsletter/send] Error al enviar lote ${batch.key}:`, err.message);
            return {
              success: false,
              error: err.message,
              batchSize: batch.to.length,
              batchKey: batch.key
            };
          }
        });

        // Ejecutar envíos en paralelo controlado con concurrencia máxima de 4
        const taskResults = await limitConcurrency(tasks, 4);

        for (const resTask of taskResults) {
          if (resTask.success) {
            successCount += resTask.acceptedCount;
            failCount += resTask.failCountForBatch;
            if (resTask.acceptedCount > 0) successGroups += 1;
            if (resTask.failCountForBatch > 0) failGroups += 1;
          } else {
            lastError = resTask.error;
            failCount += resTask.batchSize;
            failGroups += 1;
          }
        }

        // Registrar auditoría final con el resultado general
        await audit({
          user: auditUser,
          ip: auditIp,
          headers: auditHeaders
        }, {
          event: 'newsletter.send.completed',
          level: successCount > 0 ? 'info' : 'error',
          result: {
            success: successCount > 0,
            successCount,
            failCount,
            successGroups,
            failGroups,
            processedGroups: recipientBatches.length
          },
          metadata: {
            subject,
            groupByDomain,
            totalRecipients: analysis.valid.length,
            criticality: String(analytics?.criticality || '').trim().toLowerCase() || null,
            title: String(analytics?.title || subject || '').trim() || null,
            lastError: lastError || null
          }
        });

      } catch (err) {
        console.error('[newsletter/send] Error asíncrono en segundo plano:', err);
        try {
          await audit({
            user: auditUser,
            ip: auditIp,
            headers: auditHeaders
          }, {
            event: 'newsletter.send.failed',
            level: 'error',
            result: { success: false, error: err.message },
            metadata: { subject }
          });
        } catch (auditErr) {
          console.error('[newsletter/send] Error al registrar auditoría de fallo asíncrono:', auditErr.message);
        }
      }
    });
  } catch (error) {
    console.error('[newsletter/send] Error inesperado en validaciones sincrónicas:', error);
    res.status(500).json({
      message: 'Error interno al procesar boletines',
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
router.post('/incident/send', authenticate, authorize('admin', 'user', 'auditor'), async (req, res) => {
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

    // Validar abusos de SMTP Relay: dominios autorizados del SOC
    const validDomains = await getValidSOCDomains();
    const allDestEmails = [...new Set([...analysisTo.valid, ...validCc])].map(email => String(email || '').toLowerCase().trim());
    
    for (const email of allDestEmails) {
      if (!email.includes('@')) continue;
      const domain = email.split('@')[1];
      if (!validDomains.has(domain)) {
        return res.status(400).json({
          message: 'Destinatario no autorizado',
          detail: `El dominio del correo ${email} no pertenece a los destinatarios válidos del SOC.`
        });
      }
    }

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

/**
 * GET /api/reports/period-summary
 * Genera un resumen analítico y narrativo en lenguaje humano para un período de tiempo dado.
 * Requiere parámetros query: startDate y endDate.
 */
router.get('/period-summary', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Los parámetros startDate y endDate son requeridos.' });
    }

    const sDate = new Date(startDate);
    const eDate = new Date(endDate);

    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return res.status(400).json({ message: 'Las fechas proporcionadas no son válidas.' });
    }

    // Ajustar fin de día para abarcar el rango completo (hasta las 23:59:59.999) si se provee una fecha sin hora específica
    if (endDate.length <= 10) {
      eDate.setHours(23, 59, 59, 999);
    }

    // Consultar las entradas de bitácora creadas en el rango de fechas
    const entries = await Entry.find({
      createdAt: { $gte: sDate, $lte: eDate }
    })
      .populate('createdBy', 'username fullName')
      .sort({ createdAt: -1 })
      .lean();

    // Consultar checklists completados en el rango de fechas
    const checklists = await ShiftCheck.find({
      createdAt: { $gte: sDate, $lte: eDate }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Procesar métricas numéricas agregadas
    const entriesByType = { operativa: 0, incidente: 0, ofensa: 0 };
    const tagsMap = new Map();
    const analystsMap = new Map();
    const clientsMap = new Map();

    entries.forEach(e => {
      if (entriesByType[e.entryType] !== undefined) {
        entriesByType[e.entryType]++;
      }
      if (Array.isArray(e.tags)) {
        e.tags.forEach(tag => {
          const t = tag.trim().toLowerCase();
          if (t) tagsMap.set(t, (tagsMap.get(t) || 0) + 1);
        });
      }
      const analystName = e.createdBy?.fullName || e.createdByUsername || 'Sistema/Invitado';
      analystsMap.set(analystName, (analystsMap.get(analystName) || 0) + 1);

      const client = e.clientName || 'Cliente interno';
      clientsMap.set(client, (clientsMap.get(client) || 0) + 1);
    });

    const totalChecklists = checklists.length;
    const nokChecklists = checklists.filter(c => c.hasRedServices);
    const totalNok = nokChecklists.length;
    const totalOk = totalChecklists - totalNok;

    // Obtener desglose de fallas en checklists y agrupar observaciones por servicio
    const nokServicesMap = new Map();
    const checklistObservations = [];

    nokChecklists.forEach(c => {
      if (Array.isArray(c.services)) {
        c.services.forEach(s => {
          if (s.status === 'rojo') {
            nokServicesMap.set(s.serviceTitle, (nokServicesMap.get(s.serviceTitle) || 0) + 1);
            if (s.observation && s.observation.trim()) {
              checklistObservations.push({
                serviceTitle: s.serviceTitle,
                observation: s.observation.trim(),
                user: c.username || 'Analista',
                createdAt: c.createdAt
              });
            }
          }
        });
      }
    });

    // Formatear listas de tops ordenados
    const topTags = Array.from(tagsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const topAnalysts = Array.from(analystsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    const topClients = Array.from(clientsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    const topNokServices = Array.from(nokServicesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    // Filtrar incidentes críticos para el reporte
    const criticalIncidents = entries
      .filter(e => e.entryType === 'incidente' || e.entryType === 'ofensa')
      .map(e => ({
        _id: e._id,
        entryType: e.entryType,
        content: e.content,
        clientName: e.clientName || 'Cliente interno',
        createdByUsername: e.createdByUsername,
        createdAt: e.createdAt
      }));

    // Generar la narrativa en lenguaje humano
    const narrative = generateHeuristicNarrative(entries, checklists, sDate, eDate);

    // Calcular la tendencia diaria de entradas por tipo para el gráfico temporal del período consolidado
    const trendAgg = await Entry.aggregate([
      { $match: { createdAt: { $gte: sDate, $lte: eDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Santiago' } },
            type: '$entryType'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Crear un mapa temporal indexado por tipo de entrada para poblar todas las fechas del rango sin omitir días sin actividad
    const trendMap = {
      operativa: new Map(),
      incidente: new Map(),
      ofensa: new Map()
    };

    // Inicializar el cursor de fechas barriendo el rango completo
    const dateCursor = new Date(sDate);
    const endDateCursor = new Date(eDate);
    while (dateCursor <= endDateCursor) {
      const dateStr = dateCursor.toISOString().split('T')[0];
      trendMap.operativa.set(dateStr, 0);
      trendMap.incidente.set(dateStr, 0);
      trendMap.ofensa.set(dateStr, 0);
      dateCursor.setDate(dateCursor.getDate() + 1);
    }

    // Incorporar los conteos reales provenientes de la agregación de la base de datos
    trendAgg.forEach(item => {
      const type = item._id.type;
      const dateStr = item._id.date;
      if (trendMap[type]) {
        trendMap[type].set(dateStr, item.count);
      }
    });

    // Construir la estructura multiserie final esperada por NGX-Charts
    const periodTrend = [
      {
        name: 'Operativas',
        series: Array.from(trendMap.operativa.entries()).map(([name, value]) => ({ name, value }))
      },
      {
        name: 'Incidentes',
        series: Array.from(trendMap.incidente.entries()).map(([name, value]) => ({ name, value }))
      },
      {
        name: 'Ofensas',
        series: Array.from(trendMap.ofensa.entries()).map(([name, value]) => ({ name, value }))
      }
    ];

    // Calcular el top de reportes de incidentes enviados a clientes durante el período
    const mailLogs = await AuditLog.find({
      timestamp: { $gte: sDate, $lte: eDate },
      event: { $in: ['mail.incident.sent', 'mail.send.success'] },
      'metadata.sourceModule': 'ReportGenerator'
    }).select('metadata').lean();

    const mailClientsMap = new Map();
    mailLogs.forEach(log => {
      const metadata = log.metadata || {};
      const clientLabel = resolveClientLabelFromMetadata(metadata);
      if (clientLabel) {
        mailClientsMap.set(clientLabel, (mailClientsMap.get(clientLabel) || 0) + 1);
      }
    });

    const mailClientsBreakdown = Array.from(mailClientsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    // Obtener los últimos 5 boletines de seguridad enviados en el período
    const recentNewsletters = await ReportHistory.find({
      type: 'newsletter',
      timestamp: { $gte: sDate, $lte: eDate }
    })
      .sort({ timestamp: -1 })
      .limit(5)
      .select('title timestamp')
      .lean();

    const recentBulletins = recentNewsletters.map(n => ({
      title: n.title,
      timestamp: n.timestamp
    }));

    // Auditar la generación del reporte
    await audit(req, {
      event: 'user.reports.period_summary.generate',
      level: 'info',
      result: { success: true },
      metadata: {
        startDate,
        endDate,
        entriesCount: entries.length,
        checklistsCount: totalChecklists
      }
    }).catch(err => console.error('[period-summary] audit error:', err.message));

    res.json({
      period: { startDate: sDate, endDate: eDate },
      entriesCount: {
        total: entries.length,
        ...entriesByType
      },
      checklistsCount: {
        total: totalChecklists,
        ok: totalOk,
        nok: totalNok
      },
      topTags,
      topAnalysts,
      topClients,
      topNokServices,
      checklistObservations,
      criticalIncidents,
      narrative,
      periodTrend,
      mailClientsBreakdown,
      recentBulletins
    });
  } catch (error) {
    console.error('Error generando resumen de periodo:', error);
    res.status(500).json({ message: 'Error interno del servidor al generar el resumen de periodo.' });
  }
});

// Función auxiliar para construir la narrativa de negocio de manera estructurada y formal
function generateHeuristicNarrative(entries, checklists, sDate, eDate) {
  const totalEntries = entries.length;
  const entriesByType = { operativa: 0, incidente: 0, ofensa: 0 };
  const tagsCount = {};
  const analystCount = {};
  const clientCount = {};

  entries.forEach(e => {
    if (entriesByType[e.entryType] !== undefined) {
      entriesByType[e.entryType]++;
    }
    if (Array.isArray(e.tags)) {
      e.tags.forEach(t => {
        tagsCount[t] = (tagsCount[t] || 0) + 1;
      });
    }
    const userKey = e.createdBy?.fullName || e.createdByUsername || 'Sistema/Invitado';
    analystCount[userKey] = (analystCount[userKey] || 0) + 1;

    const client = e.clientName || 'Cliente interno';
    clientCount[client] = (clientCount[client] || 0) + 1;
  });

  const totalChecklists = checklists.length;
  const nokChecklists = checklists.filter(c => c.hasRedServices);
  const totalNok = nokChecklists.length;

  const serviceNokCount = {};
  const observationsList = [];
  nokChecklists.forEach(c => {
    if (Array.isArray(c.services)) {
      c.services.forEach(s => {
        if (s.status === 'rojo') {
          serviceNokCount[s.serviceTitle] = (serviceNokCount[s.serviceTitle] || 0) + 1;
          if (s.observation && s.observation.trim()) {
            observationsList.push({
              service: s.serviceTitle,
              observation: s.observation.trim(),
              user: c.username || 'Analista'
            });
          }
        }
      });
    }
  });

  const sortedTags = Object.entries(tagsCount).sort((a, b) => b[1] - a[1]);
  const sortedAnalysts = Object.entries(analystCount).sort((a, b) => b[1] - a[1]);
  const sortedClients = Object.entries(clientCount).sort((a, b) => b[1] - a[1]);
  const sortedNokServices = Object.entries(serviceNokCount).sort((a, b) => b[1] - a[1]);

  const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago' };
  const sDateStr = sDate.toLocaleDateString('es-CL', options);
  const eDateStr = eDate.toLocaleDateString('es-CL', options);

  // 1. Resumen Ejecutivo
  let resumenEjecutivo = `Durante el período comprendido desde el ${sDateStr} hasta el ${eDateStr}, la operación del SOC registró un total de ${totalEntries} entradas en la bitácora `;
  if (totalEntries === 0) {
    resumenEjecutivo += `operativa, lo que indica un período de actividad extremadamente bajo o sin registros reportados en los sistemas. `;
  } else {
    resumenEjecutivo += `y se llevaron a cabo ${totalChecklists} evaluaciones de checklists de turno. `;
    const mostCommonType = Object.entries(entriesByType).sort((a, b) => b[1] - a[1])[0];
    resumenEjecutivo += `El flujo principal de registros estuvo enfocado en actividades de tipo "${mostCommonType[0]}" (${mostCommonType[1]} registros). `;
    
    if (entriesByType.incidente > 0 || entriesByType.ofensa > 0) {
      resumenEjecutivo += `Se detectaron e investigaron un total de ${entriesByType.incidente} incidentes y ${entriesByType.ofensa} ofensas de seguridad, las cuales requirieron análisis técnico e intervenciones oportunas para mitigar riesgos. `;
    } else {
      resumenEjecutivo += `No se reportaron incidentes ni ofensas críticas de seguridad durante este lapso, manteniendo una operación estable y nominal en toda la infraestructura de los clientes. `;
    }
  }

  // 2. Análisis de Actividad y Comportamiento de Bitácora
  let analisisActividad = `En relación con el comportamiento de la bitácora, `;
  if (totalEntries > 0) {
    if (sortedAnalysts.length > 0) {
      analisisActividad += `el analista más activo del período fue ${sortedAnalysts[0][0]} con ${sortedAnalysts[0][1]} registros cargados. `;
    }
    if (sortedClients.length > 0) {
      analisisActividad += `Los esfuerzos de monitoreo y análisis se concentraron principalmente en el origen o cliente "${sortedClients[0][0]}" con un volumen de ${sortedClients[0][1]} registros. `;
    }
    if (sortedTags.length > 0) {
      const topTagsStr = sortedTags.slice(0, 3).map(t => `#${t[0]} (${t[1]} veces)`).join(', ');
      analisisActividad += `Las etiquetas (tags) más recurrentes dentro de las bitácoras fueron: ${topTagsStr}, lo que denota una concentración operativa en estas temáticas específicas. `;
    }
  } else {
    analisisActividad += `no se dispone de suficiente información de bitácora para evaluar picos o tendencias de analistas. `;
  }

  // 3. Análisis de Infraestructura y Checklists de Turno
  let analisisInfraestructura = `Respecto a los checklists de infraestructura y servicios del turno, se registraron ${totalChecklists} revisiones en total, de las cuales `;
  if (totalChecklists > 0) {
    if (totalNok === 0) {
      analisisInfraestructura += `todas finalizaron en estado "OK" (nominal). No se registraron fallas operacionales ni caídas de servicios críticos en los controles de inicio y cierre de turno. `;
    } else {
      analisisInfraestructura += `${totalNok} resultaron en estado "NOK" (con problemas detectados), representando el ${Math.round((totalNok / totalChecklists) * 100)}% del total de las revisiones. `;
      if (sortedNokServices.length > 0) {
        analisisInfraestructura += `El servicio que reportó la mayor cantidad de alertas fue "${sortedNokServices[0][0]}" con ${sortedNokServices[0][1]} registros en estado rojo. `;
      }
      if (observationsList.length > 0) {
        const obsSample = observationsList.slice(0, 2).map(o => `"${o.observation}" en el servicio [${o.service}]`).join(' y ');
        analisisInfraestructura += `Entre las bitácoras del equipo técnico, destacan detalles de error como: ${obsSample}. `;
      }
    }
  } else {
    analisisInfraestructura += `no se registraron evaluaciones de cambio de turno durante este rango de fechas. `;
  }

  // 4. Diagnóstico del Estado Actual ("Qué está pasando")
  let diagnosticoActual = `Al concluir el análisis del período, `;
  if (checklists.length > 0) {
    const lastCheck = checklists[0]; // Ordenado desc por fecha (más reciente primero)
    const lastCheckDateStr = new Date(lastCheck.createdAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    if (lastCheck.hasRedServices) {
      const redServicesNames = lastCheck.services.filter(s => s.status === 'rojo').map(s => s.serviceTitle).join(', ');
      diagnosticoActual += `el último checklist realizado el ${lastCheckDateStr} reporta servicios caídos o en estado crítico: [${redServicesNames}]. Esto indica que la infraestructura del SOC mantiene incidentes activos o alertas pendientes de resolución. `;
    } else {
      diagnosticoActual += `el último checklist del turno (realizado el ${lastCheckDateStr}) finalizó en estado "OK" (completamente nominal), lo que denota que los servicios críticos del SOC se encuentran estables y operando sin anomalías reportadas en este momento. `;
    }
  } else {
    diagnosticoActual += `no es posible determinar el estado operacional actual debido a la falta de checklists recientes en el sistema. `;
  }

  return {
    resumenEjecutivo,
    analisisActividad,
    analisisInfraestructura,
    diagnosticoActual
  };
}

/**
 * Heurísticas de control de calidad y cumplimiento del registro de bitácora.
 * Evalúa vicios comunes (copy-paste, ráfagas, lote de tickets, extremos del turno).
 * Retorna un Score del 0 al 100% y alertas de vicios.
 */
function calculateUserQuality(entries = [], days = 30) {
  if (entries.length === 0) {
    return {
      score: 0,
      status: 'Sin registros',
      vicios: {
        copyPaste: false,
        copyPercent: 0,
        burstLogging: false,
        burstPercent: 0,
        batching: false,
        batchPercent: 0,
        extremesConcentration: false,
        extremesPercent: 0,
        shortEntries: false,
        shortPercent: 0
      }
    };
  }

  let score = 100;
  const totalEntries = entries.length;

  // 1. Detección de Copy-Paste (Duplicidad exacta de textos)
  const contentMap = {};
  let duplicateCount = 0;
  entries.forEach(e => {
    const cleanContent = String(e.content || '').trim().toLowerCase();
    if (cleanContent.length > 5) {
      contentMap[cleanContent] = (contentMap[cleanContent] || 0) + 1;
    }
  });

  Object.values(contentMap).forEach(count => {
    if (count > 1) {
      duplicateCount += (count - 1);
    }
  });

  const copyPastePercent = parseFloat(((duplicateCount / totalEntries) * 100).toFixed(1));
  const copyPastePenalization = Math.min(copyPastePercent * 1.5, 40); // Max 40 pts
  score -= copyPastePenalization;

  // 2. Detección de Registro en Ráfagas (Burst Logging: diferencia < 2 minutos en creación real)
  let burstCount = 0;
  const sortedByCreated = [...entries].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (let i = 1; i < sortedByCreated.length; i++) {
    const diff = new Date(sortedByCreated[i].createdAt).getTime() - new Date(sortedByCreated[i-1].createdAt).getTime();
    if (diff < 120000) { // < 2 minutos
      burstCount++;
    }
  }

  const burstPercent = parseFloat(((burstCount / totalEntries) * 100).toFixed(1));
  const burstPenalization = Math.min(burstPercent * 1.0, 30); // Max 30 pts
  score -= burstPenalization;

  // 3. Detección de Registro Acumulado en Lote (Batching)
  // Identifica si se consolidan múltiples tickets/casos en una sola entrada general operativa (vicio de lote)
  let batchCount = 0;
  entries.forEach(e => {
    const content = String(e.content || '');
    const ticketPatternCount = (content.match(/(ticket|inc|incidente|caso|ofensa|id|solicitud|sd)\s*#?\s*\d+/gi) || []).length;
    const numericListCount = (content.match(/\b\d{4,8}\b/g) || []).length;
    
    if (ticketPatternCount > 2 || numericListCount > 2) {
      batchCount++;
    }
  });

  const batchPercent = parseFloat(((batchCount / totalEntries) * 100).toFixed(1));
  const batchPenalization = Math.min(batchPercent * 0.8, 20); // Max 20 pts
  score -= batchPenalization;

  // 4. Concentración en Extremos de Turno
  // Agrupa entradas por día y calcula si solo registra al inicio y al final sin registros intermedios
  const dailyGroups = {};
  entries.forEach(e => {
    if (e.entryDate) {
      const dayStr = new Date(e.entryDate).toISOString().slice(0, 10);
      if (!dailyGroups[dayStr]) dailyGroups[dayStr] = [];
      dailyGroups[dayStr].push(e);
    }
  });

  let extremeDaysCount = 0;
  const totalDaysWithEntries = Object.keys(dailyGroups).length;

  Object.values(dailyGroups).forEach(dayEntries => {
    if (dayEntries.length < 3) return;

    const hours = dayEntries.map(e => {
      const parts = e.entryTime.split(':');
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10); // minutos transcurridos en el día
    }).sort((a, b) => a - b);

    const minTime = hours[0];
    const maxTime = hours[hours.length - 1];
    const span = maxTime - minTime;
    
    if (span > 300) { // Si hay brecha de más de 5 horas
      let intermediateCount = 0;
      hours.forEach(m => {
        if (m > minTime + 45 && m < maxTime - 45) {
          intermediateCount++;
        }
      });
      if (intermediateCount === 0) { // Todos en extremos (primeros 45 min o últimos 45 min)
        extremeDaysCount++;
      }
    }
  });

  const extremesPercent = totalDaysWithEntries > 0 ? parseFloat(((extremeDaysCount / totalDaysWithEntries) * 100).toFixed(1)) : 0;
  const extremesPenalization = Math.min(extremesPercent * 0.5, 20); // Max 20 pts
  score -= extremesPenalization;

  // 5. Entradas demasiado cortas o genéricas
  let shortCount = 0;
  entries.forEach(e => {
    if (e.content && e.content.length < 40) {
      shortCount++;
    }
  });

  const shortEntriesPercent = parseFloat(((shortCount / totalEntries) * 100).toFixed(1));
  const shortPenalization = Math.min(shortEntriesPercent * 0.4, 15); // Max 15 pts
  score -= shortPenalization;

  // 6. Detección de Rutina Exclusiva de Apertura/Cierre (Falta de registros intermedios intradía)
  let routineVicioDays = 0;
  Object.values(dailyGroups).forEach(dayEntries => {
    // Si tiene 1 o 2 entradas en el día (lo usual para rutina inicio/cierre sin tareas intermedias)
    if (dayEntries.length <= 2) {
      let hasRoutineEntry = false;
      dayEntries.forEach(e => {
        const text = String(e.content || '').toLowerCase();
        const hasRoutineKeyword = text.includes('iniciodeturno') || 
                                  text.includes('cierredeturno') || 
                                  text.includes('inicio de turno') || 
                                  text.includes('cierre de turno') ||
                                  text.includes('[inicio]') ||
                                  text.includes('[cierre]');
        const hasRoutineTag = Array.isArray(e.tags) && e.tags.some(t => {
          const cleanT = String(t || '').toLowerCase().trim();
          return cleanT === 'iniciodeturno' || cleanT === 'cierredeturno' || cleanT === 'inicio' || cleanT === 'cierre';
        });
        if (hasRoutineKeyword || hasRoutineTag) {
          hasRoutineEntry = true;
        }
      });
      if (hasRoutineEntry) {
        routineVicioDays++;
      }
    }
  });

  const routinePercent = totalDaysWithEntries > 0 ? parseFloat(((routineVicioDays / totalDaysWithEntries) * 100).toFixed(1)) : 0;
  const routinePenalization = routinePercent > 30 ? 25 : 0; // Penalización fija de 25 puntos
  score -= routinePenalization;

  // 7. Bonificación por Riqueza Técnica (Términos del SOC)
  let technicalCount = 0;
  const socGlossary = ['firewall', 'puerto', 'ip', 'ticket', 'bloqueo', 'incidente', 'alerta', 'servidor', 'caida', 'backup', 'vpn', 'vulnerabilidad', 'ofensa', 'siem', 'antivirus', 'correo', 'phishing', 'analisis', 'log', 'ips', 'ids', 'mantenimiento', 'nok', 'monitoreo', 'novedad', 'turno', 'cierre', 'inicio'];
  entries.forEach(e => {
    const text = String(e.content || '').toLowerCase();
    const hasSocTerm = socGlossary.some(term => text.includes(term));
    if (hasSocTerm) {
      technicalCount++;
    }
  });

  const technicalPercent = parseFloat(((technicalCount / totalEntries) * 100).toFixed(1));
  const technicalBonus = Math.min((technicalPercent / 10), 10); // Max 10 pts
  score += technicalBonus;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'Excelente';
  if (score < 50) status = 'Sospecha de Relleno';
  else if (score < 75) status = 'Simplificado';
  else if (score < 90) status = 'Estable';

  return {
    score,
    status,
    vicios: {
      copyPaste: copyPastePercent > 20,
      copyPercent: copyPastePercent,
      burstLogging: burstPercent > 25,
      burstPercent,
      batching: batchPercent > 20,
      batchPercent,
      extremesConcentration: extremesPercent > 25,
      extremesPercent,
      shortEntries: shortEntriesPercent > 30,
      shortPercent: shortEntriesPercent,
      routineOnly: routinePercent > 30,
      routinePercent
    }
  };
}

/**
 * Extrae las palabras clave más recurrentes (glosario y temas del SOC) omitiendo stop words comunes
 */
function extractTopKeywords(entries = [], limit = 6) {
  const wordsMap = {};
  const stopWords = new Set([
    'el', 'la', 'los', 'las', 'de', 'del', 'al', 'en', 'y', 'o', 'un', 'una', 'unos', 'unas',
    'que', 'se', 'para', 'por', 'con', 'sin', 'su', 'sus', 'lo', 'les', 'nos', 'mi', 'mis',
    'este', 'esta', 'estos', 'estas', 'eso', 'esa', 'esos', 'esas', 'a', 'ante', 'bajo', 'cabe',
    'contra', 'desde', 'hacia', 'hasta', 'segun', 'so', 'sobre', 'tras', 'durante', 'mediante',
    'versus', 'via', 'como', 'cuando', 'donde', 'quien', 'quienes', 'cual', 'cuales', 'cuyo',
    'cuya', 'cuyos', 'cuyas', 'mas', 'pero', 'sino', 'porque', 'como', 'es', 'son', 'fue',
    'fueron', 'era', 'eran', 'sera', 'seran', 'he', 'ha', 'han', 'hay', 'hubo', 'habia',
    'esta', 'estan', 'estaba', 'estaban', 'tiene', 'tienen', 'tenia', 'tenian', 'hacer', 'hace',
    'hacen', 'hacia', 'hacian', 'todo', 'todos', 'toda', 'todas', 'ya', 'muy', 'tambien', 'solo',
    'sobre', 'no', 'si', 'sí', 'entonces', 'así', 'algun', 'alguna', 'algunos', 'algunas',
    'otro', 'otra', 'otros', 'otras', 'caso', 'casos', 'ticket', 'tickets', 'entrada', 'entradas',
    'bitacora', 'analista', 'analistas', 'turno', 'operativo', 'observacion', 'observaciones',
    'novedad', 'novedades', 'inicio', 'cierre', 'novedad', 'sin', 'novedades', 'realizo', 'realiza',
    'se', 'me', 'te', 'le', 'nos', 'os', 'les', 'por', 'para', 'como', 'con', 'contra', 'entre',
    'hacia', 'hasta', 'para', 'por', 'segun', 'sin', 'sobre', 'tras', 'durante', 'mediante', 'etc'
  ]);

  entries.forEach(e => {
    const text = String(e.content || '').toLowerCase();
    // Limpiar puntuación básica, guiones y barras
    const words = text.replace(/[.,;:()'"?!-\/]/g, ' ').split(/\s+/);
    words.forEach(w => {
      const cleanW = w.trim();
      if (cleanW.length > 3 && !stopWords.has(cleanW) && isNaN(cleanW)) {
        wordsMap[cleanW] = (wordsMap[cleanW] || 0) + 1;
      }
    });
  });

  return Object.entries(wordsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(entry => entry[0]);
}

// GET /api/reports/user-stats - Estadísticas de uso y cumplimiento de calidad de los analistas
router.get('/user-stats', authenticate, async (req, res) => {
  try {
    // Regla de Seguridad: Solo admin, auditor y analistas N2 pueden ver/ejecutar estos reportes de calidad
    const isUserN2 = req.user.role === 'user' && req.user.cargoLabel === 'N2';
    const isAuthorized = req.user.role === 'admin' || req.user.role === 'auditor' || isUserN2;
    if (!isAuthorized) {
      return res.status(403).json({ message: 'Acceso denegado: permisos insuficientes para consultar estadísticas de analistas.' });
    }

    const { days = 30, userId = 'all', includeAllUsers = 'false' } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    startDate.setHours(0, 0, 0, 0);

    let userQuery = {};
    let selectedUser = null;

    if (userId && userId !== 'all') {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(userId)) {
        selectedUser = await User.findById(userId).lean();
        if (!selectedUser) {
          return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        userQuery.createdBy = selectedUser._id;
      } else {
        return res.status(400).json({ message: 'ID de usuario inválido' });
      }
    }

    // Consultar entradas en el período
    const entries = await Entry.find({
      entryDate: { $gte: startDate },
      ...userQuery
    }).sort({ entryDate: 1, entryTime: 1 }).lean();

    // Obtener analistas activos. Por defecto se centra netamente en N1 y N2, a menos que includeAllUsers sea 'true'
    const cargoFilter = includeAllUsers === 'true'
      ? { isActive: true, role: 'user' }
      : { isActive: true, role: 'user', cargoLabel: { $in: ['N1', 'N2'] } };
    
    const activeCargoUsers = await User.find(cargoFilter, 'username fullName cargoLabel').lean();

    // Obtener analistas que tienen registros de entradas en el periodo evaluado
    const distinctCreatorIds = [...new Set(entries.map(e => String(e.createdBy)).filter(id => id && id !== 'undefined'))];
    const activeCreators = await User.find({
      _id: { $in: distinctCreatorIds },
      role: { $in: ['user', 'admin'] }
    }, 'username fullName cargoLabel').lean();

    // Unir ambas listas de forma única por ID de usuario
    const mergedUsersMap = new Map();
    activeCargoUsers.forEach(u => mergedUsersMap.set(String(u._id), u));
    activeCreators.forEach(u => mergedUsersMap.set(String(u._id), u));
    
    const usersList = Array.from(mergedUsersMap.values());

    // Obtener las ausencias registradas (licencias médicas o vacaciones) que se solapen con el período para los usuarios listados
    const userIds = usersList.map(u => u._id);
    const activeAbsences = await ShiftAssignment.find({
      userId: { $in: userIds },
      roleCode: { $in: ['MEDICAL_LEAVE', 'VACATION'] },
      weekStartDate: { $lte: new Date() },
      weekEndDate: { $gte: startDate }
    }).lean();

    const absencesByUserId = {};
    activeAbsences.forEach(abs => {
      const uid = String(abs.userId);
      if (!absencesByUserId[uid]) absencesByUserId[uid] = [];
      absencesByUserId[uid].push(abs);
    });

    // Si es "Todos los usuarios", calcularemos estadísticas grupales
    if (userId === 'all') {
      const statsByUser = {};
      
      // Inicializar estadísticas para cada usuario analista de la lista
      usersList.forEach(u => {
        statsByUser[u.username] = {
          userId: String(u._id),
          username: u.username,
          fullName: u.fullName,
          totalEntries: 0,
          operativa: 0,
          incidente: 0,
          ofensa: 0,
          entries: []
        };
      });

      // Agrupar entradas por usuario
      entries.forEach(e => {
        const username = e.createdByUsername || 'Desconocido';
        if (!statsByUser[username]) {
          // Si no existía en el filtro (ej. administrador o cuenta inactiva que registró entradas), lo ignoramos
          // ya que queremos restringir el análisis netamente a la lista oficial de analistas N1/N2
          return;
        }
        statsByUser[username].totalEntries++;
        if (e.entryType === 'operativa') statsByUser[username].operativa++;
        else if (e.entryType === 'incidente') statsByUser[username].incidente++;
        else if (e.entryType === 'ofensa') statsByUser[username].ofensa++;
        statsByUser[username].entries.push(e);
      });

      // Filtrar usuarios del leaderboard que efectivamente tengan estadísticas calculadas
      const userListStats = Object.values(statsByUser).map(userStats => {
        const qualityDetails = calculateUserQuality(userStats.entries, parsedDays);
        
        // Calcular métricas temporales individuales para el leaderboard
        const uEntriesTrend = {};
        const uHourlyDistribution = Array(24).fill(0);
        userStats.entries.forEach(e => {
          if (e.entryDate) {
            const dateStr = new Date(e.entryDate).toISOString().slice(0, 10);
            uEntriesTrend[dateStr] = true;
          }
          if (e.entryTime) {
            const hour = parseInt(e.entryTime.split(':')[0], 10);
            if (hour >= 0 && hour < 24) uHourlyDistribution[hour]++;
          }
        });
        const uActiveDays = Object.keys(uEntriesTrend).length;
        const uAvgPerActiveDay = uActiveDays > 0 ? parseFloat((userStats.totalEntries / uActiveDays).toFixed(2)) : 0;
        
        let uMaxCount = 0;
        let uPeakHour = 'N/A';
        uHourlyDistribution.forEach((count, hour) => {
          if (count > uMaxCount) {
            uMaxCount = count;
            uPeakHour = `${hour}:00`;
          }
        });

        // Buscar ausencias del usuario en este periodo
        let totalAbsenceDays = 0;
        let currentAbsence = null;
        const hoy = new Date();
        const uidStr = String(userStats.userId);
        
        (absencesByUserId[uidStr] || []).forEach(abs => {
          const overlapStart = new Date(Math.max(startDate.getTime(), new Date(abs.weekStartDate).getTime()));
          const overlapEnd = new Date(Math.min(hoy.getTime(), new Date(abs.weekEndDate).getTime()));
          const diffMs = overlapEnd.getTime() - overlapStart.getTime();
          if (diffMs > 0) {
            const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
            totalAbsenceDays += days;
          }
          if (new Date(abs.weekStartDate) <= hoy && new Date(abs.weekEndDate) >= hoy) {
            currentAbsence = abs;
          }
        });

        let finalStatus = qualityDetails.status;
        let finalScore = qualityDetails.score;

        if (userStats.totalEntries === 0 && totalAbsenceDays > 0) {
          const firstAbs = absencesByUserId[uidStr][0];
          const isMedical = (currentAbsence ? currentAbsence.roleCode : firstAbs.roleCode) === 'MEDICAL_LEAVE';
          finalStatus = isMedical ? 'Licencia Médica' : 'Vacaciones';
          finalScore = 0;
        }

        return {
          userId: userStats.userId,
          username: userStats.username,
          fullName: userStats.fullName,
          totalEntries: userStats.totalEntries,
          operativa: userStats.operativa,
          incidente: userStats.incidente,
          ofensa: userStats.ofensa,
          qualityScore: finalScore,
          qualityStatus: finalStatus,
          vicios: qualityDetails.vicios,
          activeDays: uActiveDays,
          averageEntriesPerActiveDay: uAvgPerActiveDay,
          peakHour: uPeakHour,
          absence: totalAbsenceDays > 0 ? {
            hasAbsence: true,
            absenceType: currentAbsence ? currentAbsence.roleCode : absencesByUserId[uidStr][0].roleCode,
            absenceDays: totalAbsenceDays,
            absenceLabel: (currentAbsence ? currentAbsence.roleCode : absencesByUserId[uidStr][0].roleCode) === 'MEDICAL_LEAVE' ? 'Licencia Médica' : 'Vacaciones',
            onAbsenceNow: !!currentAbsence,
            absencePeriodText: currentAbsence ? `Del ${new Date(currentAbsence.weekStartDate).toLocaleDateString('es-CL')} al ${new Date(currentAbsence.weekEndDate).toLocaleDateString('es-CL')}` : ''
          } : null
        };
      }).sort((a, b) => b.totalEntries - a.totalEntries);

      // Agrupación de métricas globales
      const globalHourlyDistribution = Array(24).fill(0);
      const globalWeeklyDistribution = Array(7).fill(0);
      const globalEntriesTrend = {};
      const globalTagsMap = {};
      const globalClientsMap = {};

      // Filtrar entradas globales para considerar únicamente los analistas activos N1/N2
      const activeUserIds = new Set(usersList.map(u => String(u._id)));
      const filteredEntries = entries.filter(e => e.createdBy && activeUserIds.has(String(e.createdBy)));

      filteredEntries.forEach(e => {
        if (e.entryTime) {
          const hour = parseInt(e.entryTime.split(':')[0], 10);
          if (hour >= 0 && hour < 24) globalHourlyDistribution[hour]++;
        }
        if (e.entryDate) {
          const day = new Date(e.entryDate).getDay();
          if (day >= 0 && day < 7) globalWeeklyDistribution[day]++;
          const dateStr = new Date(e.entryDate).toISOString().slice(0, 10);
          globalEntriesTrend[dateStr] = (globalEntriesTrend[dateStr] || 0) + 1;
        }
        if (Array.isArray(e.tags)) {
          e.tags.forEach(t => {
            globalTagsMap[t] = (globalTagsMap[t] || 0) + 1;
          });
        }
        if (e.clientName) {
          globalClientsMap[e.clientName] = (globalClientsMap[e.clientName] || 0) + 1;
        }
      });

      const hourlyData = globalHourlyDistribution.map((count, hour) => ({ name: `${hour}:00`, value: count }));
      const daysOfWeekNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const weeklyData = globalWeeklyDistribution.map((count, dayIndex) => ({ name: daysOfWeekNames[dayIndex], value: count }));
      const trendData = Object.entries(globalEntriesTrend).map(([date, count]) => ({ name: date, value: count })).sort((a,b) => a.name.localeCompare(b.name));
      const topTags = Object.entries(globalTagsMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 10);
      const topClients = Object.entries(globalClientsMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 10);

      let topAnalyst = { username: 'N/A', count: 0 };
      let topIncidentReporter = { username: 'N/A', count: 0 };
      userListStats.forEach(u => {
        if (u.totalEntries > topAnalyst.count) {
          topAnalyst = { username: u.fullName, count: u.totalEntries };
        }
        const totalInc = u.incidente + u.ofensa;
        if (totalInc > topIncidentReporter.count) {
          topIncidentReporter = { username: u.fullName, count: totalInc };
        }
      });

      // Metricas temporales consolidadas
      const activeDays = Object.keys(globalEntriesTrend).length;
      const averageEntriesPerActiveDay = activeDays > 0 ? parseFloat((filteredEntries.length / activeDays).toFixed(2)) : 0;
      
      let maxCount = 0;
      let peakHour = 'N/A';
      globalHourlyDistribution.forEach((count, hour) => {
        if (count > maxCount) {
          maxCount = count;
          peakHour = `${hour}:00`;
        }
      });

      const topKeywords = extractTopKeywords(filteredEntries, 6);

      return res.json({
        reportMode: 'all',
        periodDays: parsedDays,
        totalEntries: filteredEntries.length,
        analystLeaderboard: userListStats,
        topAnalyst,
        topIncidentReporter,
        hourlyActivity: hourlyData,
        weeklyActivity: weeklyData,
        entriesTrend: trendData,
        topTags,
        topClients,
        activeDays,
        averageEntriesPerActiveDay,
        peakHour,
        topKeywords,
        usersList: usersList.map(u => ({ _id: String(u._id), username: u.username, fullName: u.fullName, cargoLabel: u.cargoLabel }))
      });
    } else {
      // Estadísticas para un analista específico
      const qualityDetails = calculateUserQuality(entries, parsedDays);
      
      const hourlyDistribution = Array(24).fill(0);
      const weeklyDistribution = Array(7).fill(0);
      const entriesTrend = {};
      const tagsMap = {};
      const clientsMap = {};
      let totalLength = 0;

      entries.forEach(e => {
        if (e.entryTime) {
          const hour = parseInt(e.entryTime.split(':')[0], 10);
          if (hour >= 0 && hour < 24) hourlyDistribution[hour]++;
        }
        if (e.entryDate) {
          const day = new Date(e.entryDate).getDay();
          if (day >= 0 && day < 7) weeklyDistribution[day]++;
          const dateStr = new Date(e.entryDate).toISOString().slice(0, 10);
          entriesTrend[dateStr] = (entriesTrend[dateStr] || 0) + 1;
        }
        if (Array.isArray(e.tags)) {
          e.tags.forEach(t => {
            tagsMap[t] = (tagsMap[t] || 0) + 1;
          });
        }
        if (e.clientName) {
          clientsMap[e.clientName] = (clientsMap[e.clientName] || 0) + 1;
        }
        totalLength += e.content ? e.content.length : 0;
      });

      const hourlyData = hourlyDistribution.map((count, hour) => ({ name: `${hour}:00`, value: count }));
      const daysOfWeekNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const weeklyData = weeklyDistribution.map((count, dayIndex) => ({ name: daysOfWeekNames[dayIndex], value: count }));
      const trendData = Object.entries(entriesTrend).map(([date, count]) => ({ name: date, value: count })).sort((a,b) => a.name.localeCompare(b.name));
      const topTags = Object.entries(tagsMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 10);
      const topClients = Object.entries(clientsMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 10);

      const totalEntriesCount = entries.length;
      const averageLength = totalEntriesCount > 0 ? Math.round(totalLength / totalEntriesCount) : 0;
      const averageEntriesPerDay = parseFloat((totalEntriesCount / parsedDays).toFixed(2));

      // Métricas de tiempo y contenido individuales
      const activeDays = Object.keys(entriesTrend).length;
      const averageEntriesPerActiveDay = activeDays > 0 ? parseFloat((totalEntriesCount / activeDays).toFixed(2)) : 0;
      
      let maxCount = 0;
      let peakHour = 'N/A';
      hourlyDistribution.forEach((count, hour) => {
        if (count > maxCount) {
          maxCount = count;
          peakHour = `${hour}:00`;
        }
      });

      const topKeywords = extractTopKeywords(entries, 6);

      // Consultar ausencias del analista específico
      const userAbsences = await ShiftAssignment.find({
        userId: selectedUser._id,
        roleCode: { $in: ['MEDICAL_LEAVE', 'VACATION'] },
        weekStartDate: { $lte: new Date() },
        weekEndDate: { $gte: startDate }
      }).lean();

      let totalAbsenceDays = 0;
      let currentAbsence = null;
      const hoy = new Date();
      
      userAbsences.forEach(abs => {
        const overlapStart = new Date(Math.max(startDate.getTime(), new Date(abs.weekStartDate).getTime()));
        const overlapEnd = new Date(Math.min(hoy.getTime(), new Date(abs.weekEndDate).getTime()));
        const diffMs = overlapEnd.getTime() - overlapStart.getTime();
        if (diffMs > 0) {
          const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
          totalAbsenceDays += days;
        }
        if (new Date(abs.weekStartDate) <= hoy && new Date(abs.weekEndDate) >= hoy) {
          currentAbsence = abs;
        }
      });

      let finalStatus = qualityDetails.status;
      let finalScore = qualityDetails.score;

      if (totalEntriesCount === 0 && totalAbsenceDays > 0) {
        const firstAbs = userAbsences[0];
        const isMedical = (currentAbsence ? currentAbsence.roleCode : firstAbs.roleCode) === 'MEDICAL_LEAVE';
        finalStatus = isMedical ? 'Licencia Médica' : 'Vacaciones';
        finalScore = 0;
      }

      return res.json({
        reportMode: 'individual',
        periodDays: parsedDays,
        user: {
          id: String(selectedUser._id),
          username: selectedUser.username,
          fullName: selectedUser.fullName,
          role: selectedUser.role
        },
        totalEntries: totalEntriesCount,
        operativa: entries.filter(e => e.entryType === 'operativa').length,
        incidente: entries.filter(e => e.entryType === 'incidente').length,
        ofensa: entries.filter(e => e.entryType === 'ofensa').length,
        averageEntriesPerDay,
        averageContentLength: averageLength,
        qualityScore: finalScore,
        qualityStatus: finalStatus,
        vicios: qualityDetails.vicios,
        hourlyActivity: hourlyData,
        weeklyActivity: weeklyData,
        entriesTrend: trendData,
        topTags,
        topClients,
        activeDays,
        averageEntriesPerActiveDay,
        peakHour,
        topKeywords,
        absence: totalAbsenceDays > 0 ? {
          hasAbsence: true,
          absenceType: currentAbsence ? currentAbsence.roleCode : userAbsences[0].roleCode,
          absenceDays: totalAbsenceDays,
          absenceLabel: (currentAbsence ? currentAbsence.roleCode : userAbsences[0].roleCode) === 'MEDICAL_LEAVE' ? 'Licencia Médica' : 'Vacaciones',
          onAbsenceNow: !!currentAbsence,
          absencePeriodText: currentAbsence ? `Del ${new Date(currentAbsence.weekStartDate).toLocaleDateString('es-CL')} al ${new Date(currentAbsence.weekEndDate).toLocaleDateString('es-CL')}` : ''
        } : null,
        usersList: usersList.map(u => ({ _id: String(u._id), username: u.username, fullName: u.fullName, cargoLabel: u.cargoLabel }))
      });
    }
  } catch (error) {
    console.error('Error in user-stats:', error);
    res.status(500).json({ message: 'Error al generar estadísticas de usuario' });
  }
});

module.exports = router;
