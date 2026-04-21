/**
 * Rutas de Reportes y Análisis SOC
 *
 * Endpoints:
 *   GET  /api/reports/overview               - KPIs y métricas SOC
 *   GET  /api/reports/export-entries          - Exportar entradas a CSV (admin)
 *   GET  /api/reports/tags-trend              - Tendencia de tags
 *   GET  /api/reports/heatmap                 - Mapa de calor día/hora
 *   GET  /api/reports/entries-by-logsource    - Entradas por Log Source
 *   POST /api/reports/newsletter/send         - Envío 1:1 de Boletín de Seguridad (REP-GEN-019A)
 *
 * Reglas SOC:
 *   - Todos los endpoints requieren autenticación.
 *   - El envío de boletines respeta privacidad: 1 correo por destinatario (nunca CC masivo).
 *   - Timezone para aggregations: America/Santiago.
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const User = require('../models/User');
const AppConfig = require('../models/AppConfig');
const { authenticate, authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { sendEmail } = require('../utils/email');
const { analyzeRecipientEmails } = require('../utils/contactDirectory');

/**
 * CID estable para multipart/related (imagen inline). Debe coincidir con el atributo src del HTML.
 * Gmail muestra mal o bloquea data: en HTML; lo correcto es MIME inline + CID.
 */
const NEWSLETTER_LOGO_CID = 'bitacora_newsletter_logo@bitacora';
// Mantener trazas de newsletter siempre activas para diagnóstico continuo.
const NEWSLETTER_DEBUG_LOGS = true;

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

  if (publicBase && logoUrl && typeof logoUrl === 'string' && logoUrl.startsWith('/uploads/logos/')) {
    const absolute = `${publicBase}${logoUrl}`;
    const htmlWithPublicLogo = /<img\b/i.test(rawHtml) ? replaceFirstImgSrc(rawHtml, absolute) : rawHtml;
    const safePublicHtml = removeLeadingDataImageTags(htmlWithPublicLogo);
    newsletterDebug('prepare_payload.use_public_url', { absolute });
    return {
      html: safePublicHtml,
      attachments: []
    };
  }

  const { buffer: buf, contentType: ct } = await resolveNewsletterLogoBuffer(
    rawHtml,
    clientLogoAttachments,
    logoUrl
  );
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
    newsletterDebug('prepare_payload.return_without_attachments', {
      hasBuffer: Boolean(buf && buf.length),
      hasImgTag: /<img\b/i.test(rawHtml)
    });
    return { html: out, attachments: [] };
  }

  const ext = extensionFromContentType(ct);
  const filename = `logo.${ext}`;
  const cid = NEWSLETTER_LOGO_CID;
  let htmlOut = replaceFirstImgSrc(rawHtml, `cid:${cid}`);
  htmlOut = removeLeadingDataImageTags(htmlOut);
  newsletterDebug('prepare_payload.use_cid', {
    cid,
    filename,
    contentType: ct,
    bufferLength: buf.length
  });

  const attachments = [
    {
      filename,
      content: buf,
      cid,
      contentType: ct,
      contentDisposition: 'inline'
    },
    {
      filename,
      content: buf,
      contentType: ct,
      contentDisposition: 'attachment'
    }
  ];

  // Procesar imágenes de evidencias (data: URIs) -> CID attachments para compatibilidad Gmail
  const dataImageRegex = /<img\b[^>]*\ssrc=["']data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)["'][^>]*>/gi;
  let evidenceIndex = 0;
  let finalHtml = htmlOut;
  let match;
  
  while ((match = dataImageRegex.exec(htmlOut)) !== null) {
    evidenceIndex++;
    const imgTag = match[0];
    const imageType = match[1];
    const base64Data = match[2].replace(/\s/g, '');
    
    try {
      const evidenceBuffer = Buffer.from(base64Data, 'base64');
      
      // Validar tamaño razonable (máx 5MB por imagen de evidencia)
      if (evidenceBuffer.length > 5 * 1024 * 1024) {
        newsletterDebug('prepare_payload.evidence_skip_too_large', {
          index: evidenceIndex,
          size: evidenceBuffer.length
        });
        continue;
      }
      
      const evidenceCid = `evidence-${evidenceIndex}@bitacora-newsletter`;
      const evidenceExt = imageType === 'jpeg' || imageType === 'jpg' ? 'jpg' : imageType;
      const evidenceFilename = `evidence-${evidenceIndex}.${evidenceExt}`;
      const evidenceContentType = `image/${imageType === 'jpg' ? 'jpeg' : imageType}`;
      
      attachments.push({
        filename: evidenceFilename,
        content: evidenceBuffer,
        cid: evidenceCid,
        contentType: evidenceContentType,
        contentDisposition: 'inline'
      });
      
      // Reemplazar data: URI con cid: en el HTML
      const newImgTag = imgTag.replace(
        /src=["']data:image\/[^"']+["']/i,
        `src="cid:${evidenceCid}"`
      );
      finalHtml = finalHtml.replace(imgTag, newImgTag);
      
      newsletterDebug('prepare_payload.evidence_processed', {
        index: evidenceIndex,
        cid: evidenceCid,
        filename: evidenceFilename,
        size: evidenceBuffer.length,
        contentType: evidenceContentType
      });
    } catch (err) {
      newsletterDebug('prepare_payload.evidence_decode_failed', {
        index: evidenceIndex,
        error: err.message
      });
    }
  }
  
  newsletterDebug('prepare_payload.done', {
    totalAttachments: attachments.length,
    evidenceImagesProcessed: evidenceIndex
  });

  return {
    html: finalHtml,
    attachments
  };
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

// POST /api/reports/newsletter/send - Envío de boletines (1:1)
router.post('/newsletter/send', authenticate, async (req, res) => {
  try {
    const { recipients, subject, html } = req.body;
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

    const prepared = await prepareNewsletterEmailPayload(html, req.body.inlineAttachments);
    const emailHtml = prepared.html;
    const newsletterAttachments = prepared.attachments;
    const plainText = htmlToBasicPlainText(emailHtml);

    // Envío secuencial 1:1 — nunca en copia masiva
    let successCount = 0;
    let failCount = 0;
    let lastError = null;

    for (const email of analysis.valid) {
      try {
        await sendEmail({
          to: email,
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
              newsletterAttachmentParts: newsletterAttachments.length,
              duplicateCount: analysis.duplicates.length,
              invalidCount: analysis.invalid.length
            }
          }
        });
        successCount++;
      } catch (err) {
        console.error(`[newsletter/send] Error al enviar a ${email}:`, err.message);
        lastError = err.message;
        failCount++;
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
      successCount,
      failCount,
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

module.exports = router;
