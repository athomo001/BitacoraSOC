/**
 * File Purpose: backend/src/routes/api-v1-external.js
 * Responsibilities: Definir las rutas públicas de la API externa (v1) protegidas por API Key.
 * QA Notes: Implementa validaciones estrictas y control de acceso granular por scope.
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Entry = require('../models/Entry');
const AppConfig = require('../models/AppConfig');
const Contact = require('../models/Contact');
// Importar plantilla de correo centralizada
const { buildIncidentEmail } = require('../templates/email');
const {
  htmlToBasicPlainText,
  resolveUploadedLogoWebPath,
  readUploadedLogoFromWebPath,
  buildIncidentEmailLogoVariant,
  contentTypeFromLogoFilename
} = require('../utils/email-templates-helper');
const { sendEmail } = require('../utils/email');
const { authenticateApiKey, requirePermission, apiAuditLogger } = require('../middleware/apiKeyAuth');

// Aplicar middlewares de auditoría y autenticación por API Key a todas las rutas de este router
router.use(apiAuditLogger);
router.use(authenticateApiKey);

/**
 * GET /api/v1/users
 * Scope: users:read
 * Descripción: Obtiene el listado simplificado de usuarios activos del SOC.
 */
router.get('/users', requirePermission('users:read'), async (req, res) => {
  try {
    const users = await User.find({ isActive: true }, 'username fullName role email createdAt').lean();
    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('[APIv1/users] Error:', error);
    res.status(500).json({ message: 'Error interno al consultar usuarios', detail: error.message });
  }
});

/**
 * GET /api/v1/events
 * Scope: events:read
 * Descripción: Consulta de entradas de bitácora recientes con soporte para paginación.
 */
router.get('/events', requirePermission('events:read'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      Entry.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Entry.countDocuments({})
    ]);

    res.json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      events: entries
    });
  } catch (error) {
    console.error('[APIv1/events/list] Error:', error);
    res.status(500).json({ message: 'Error interno al listar eventos', detail: error.message });
  }
});

/**
 * GET /api/v1/events/:id
 * Scope: events:read
 * Descripción: Obtiene una entrada de bitácora específica por su ID.
 */
router.get('/events/:id', requirePermission('events:read'), async (req, res) => {
  try {
    const entry = await Entry.findById(req.params.id).lean();
    if (!entry) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    res.json({ success: true, event: entry });
  } catch (error) {
    console.error('[APIv1/events/get] Error:', error);
    res.status(500).json({ message: 'Error al consultar el evento', detail: error.message });
  }
});

/**
 * POST /api/v1/events
 * Scope: events:write
 * Descripción: Inserción programática de nuevos eventos en la bitácora del SOC (ej: alarmas automáticas del SIEM).
 */
router.post('/events', requirePermission('events:write'), async (req, res) => {
  const { content, entryType, tags, clientId, clientName } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'El contenido del evento es requerido' });
  }

  try {
    const newEntry = new Entry({
      content: content.trim(),
      entryType: entryType || 'operativa',
      entryDate: new Date(),
      entryTime: new Date().toISOString().slice(11, 16),
      tags: Array.isArray(tags) ? tags : [],
      clientId: clientId || null,
      clientName: clientName || null,
      createdByUsername: req.user.username, // Nombre de la API Key
      ipAddress: req.clientIp || req.headers['x-forwarded-for'] || req.ip || '0.0.0.0',
      userAgent: 'SOC-API-Integration'
    });

    await newEntry.save();

    res.status(201).json({
      success: true,
      message: 'Evento registrado exitosamente en la bitácora',
      event: newEntry
    });
  } catch (error) {
    console.error('[APIv1/events/create] Error:', error);
    res.status(500).json({ message: 'Error al registrar el evento', detail: error.message });
  }
});

/**
 * GET /api/v1/escalations
 * Scope: escalations:read
 * Descripción: Obtiene el listado de turnos de escalación y el directorio de contactos activos del SOC.
 */
router.get('/escalations', requirePermission('escalations:read'), async (req, res) => {
  try {
    // Consultar el directorio de contactos activos
    const contacts = await Contact.find({ active: true }).lean();

    // Obtener información básica de turnos activos actuales (consultando el controlador del sistema de turnos de forma interna si aplica)
    let internalShifts = [];
    try {
      const { resolveCurrentShift } = require('../controllers/escalationController');
      if (resolveCurrentShift) {
        const roles = ['N2', 'TI', 'N1_NO_HABIL'];
        const now = new Date();
        for (const roleCode of roles) {
          const shift = await resolveCurrentShift(roleCode, now);
          if (shift) {
            internalShifts.push(shift);
          }
        }
      }
    } catch (e) {
      console.warn('[APIv1/escalations] No se pudieron resolver los turnos en tiempo real:', e.message);
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      internalShifts,
      contacts
    });
  } catch (error) {
    console.error('[APIv1/escalations] Error:', error);
    res.status(500).json({ message: 'Error al obtener datos de escalación', detail: error.message });
  }
});

/**
 * POST /api/v1/templates/render
 * Scope: templates:render
 * Descripción: Renderiza la plantilla MJML de reporte de incidentes a HTML.
 *              Útil para herramientas SOAR que envían correos formateados.
 */
router.post('/templates/render', requirePermission('templates:render'), async (req, res) => {
  const { to, subject, reportData, images, paletteKey, sendEmail: shouldSend } = req.body;

  if (!reportData) {
    return res.status(400).json({ message: 'El objeto reportData es requerido' });
  }

  const reportClient = String(reportData.logSource || reportData.clientName || reportData.cliente || '').trim();
  if (!reportClient) {
    return res.status(400).json({ 
      message: 'Se requiere cliente o logSource dentro de reportData para procesar la plantilla' 
    });
  }

  try {
    const config = await AppConfig.findOne();
    const brandName = config?.appTitle || 'Bitácora SOC';
    const activePalette = paletteKey || config?.incidentEmailPaletteKey || 'cdc-verde';
    const autor = req.user.fullName; // Nombre de la API Key

    // Procesar las imágenes de evidencia si se proveen
    const imgList = Array.isArray(images) ? images : [];
    
    // Preparar las imágenes para la plantilla
    const previewImages = imgList.map((img, idx) => {
      const ct = /^image\//.test(img.contentType) ? img.contentType : 'image/png';
      return {
        ...img,
        _previewSrc: img.contentBase64
          ? `data:${ct};base64,${img.contentBase64.replace(/\s/g, '')}`
          : null,
        _isSrcOverride: true // Forzar el uso del preview base64 en el HTML
      };
    });

    const NEWSLETTER_LOGO_CID = 'bitacora_newsletter_logo@bitacora';
    let logoCid = null;
    const mailAttachments = [];

    // Resolver logo desde la configuración de la Bitácora
    const logoUrl = config?.logoUrl;
    if (logoUrl) {
      const logoWebPath = resolveUploadedLogoWebPath(logoUrl);
      if (logoWebPath) {
        const logoBuf = await readUploadedLogoFromWebPath(logoWebPath);
        if (logoBuf && logoBuf.length) {
          const logoCt = contentTypeFromLogoFilename(logoWebPath);
          const outlinedLogo = await buildIncidentEmailLogoVariant(logoBuf, logoCt);
          if (outlinedLogo) {
            if (shouldSend === true) {
              // Si se envía por email, se adjunta inline
              mailAttachments.push({
                filename: `logo-email.${outlinedLogo.extension}`,
                content: outlinedLogo.buffer,
                cid: NEWSLETTER_LOGO_CID,
                contentType: outlinedLogo.contentType,
                contentDisposition: 'inline'
              });
              logoCid = `cid:${NEWSLETTER_LOGO_CID}`;
            } else {
              // Para el preview o el SOAR, se pasa como Data URI autocontenida
              logoCid = `data:${outlinedLogo.contentType};base64,${outlinedLogo.buffer.toString('base64')}`;
            }
          }
        }
      }
    }

    // Compilar MJML -> HTML
    const { html, errors } = await buildIncidentEmail({
      reportData,
      images: previewImages,
      logoCid,
      autor,
      brandName,
      paletteKey: activePalette
    });

    if (errors && errors.length > 0) {
      console.warn('[APIv1/templates/render] MJML warnings:', errors);
    }

    let emailSent = false;
    let emailError = null;

    // Si se solicita explícitamente enviar el correo por SMTP
    if (shouldSend === true) {
      if (!to || !Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ 
          message: 'Se requiere el campo "to" como un arreglo de destinatarios para enviar el correo' 
        });
      }

      // Preparar adjuntos SMTP para las imágenes de evidencia en base64
      imgList.forEach((img, idx) => {
        if (img.contentBase64 && img.name) {
          const ct = /^image\//.test(img.contentType) ? img.contentType : 'image/png';
          mailAttachments.push({
            filename: img.name,
            content: Buffer.from(img.contentBase64.replace(/\s/g, ''), 'base64'),
            contentType: ct,
            cid: img.name
          });
        }
      });

      try {
        await sendEmail({
          to,
          subject: subject || `Incidente de Seguridad - ${reportClient}`,
          html: html || '',
          text: htmlToBasicPlainText(html || ''),
          attachments: mailAttachments.length ? mailAttachments : undefined,
          auditContext: {
            sourceModule: 'api-keys',
            triggerType: 'api-render-send',
            triggerContext: `Envío automático vía API Key para: ${reportClient}`
          }
        });
        emailSent = true;
      } catch (err) {
        console.error('[APIv1/templates/render] Error al enviar email:', err);
        emailError = err.message;
      }
    }

    res.json({
      success: true,
      emailSent,
      emailError,
      subject: subject || 'Reporte de Incidente de Seguridad',
      html: html || '',
      text: htmlToBasicPlainText(html || '')
    });
  } catch (error) {
    console.error('[APIv1/templates/render] Error:', error);
    res.status(500).json({ message: 'Error al renderizar la plantilla HTML', detail: error.message });
  }
});

module.exports = router;
