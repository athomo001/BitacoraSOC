/**
 * File Purpose: backend/src/controllers/publicShareController.js
 * Responsibilities: Gestionar (admin) y servir (público, sin sesión) el enlace de solo lectura de la
 *   grilla semanal "Personal en Teletrabajo y Apoyo" para dejarla en una pantalla/TV del SOC.
 * QA Notes: La ruta pública vive fuera de /api/ (no pasa por el rate-limit/sanitizer global): valida
 *   el formato del token antes de tocar la BD y responde siempre la misma página "no disponible"
 *   para token inexistente, mal formado o desactivado (no revela si el token existe).
 */

const PublicShareLink = require('../models/PublicShareLink');
const User = require('../models/User');
const ShiftAssignment = require('../models/ShiftAssignment');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const { getBrandingSnapshot } = require('../utils/branding');
const {
  buildTeleworkWeeklyMatrix,
  buildWeekOverlapFilter,
  resolveWeekStart,
  RELEVANT_ROLE_CODES,
  renderTeleworkWeeklyPage,
  renderUnavailablePage
} = require('../utils/telework-matrix');

const SHARE_TYPE = 'telework-weekly';
const PUBLIC_PATH_PREFIX = '/p/telework/';
const TOKEN_RE = /^[a-f0-9]{64}$/;
const REFRESH_SECONDS = 600;
const ACCESS_METRIC_THROTTLE_MS = 60 * 1000;

const stripTrailingSlashes = (value) => String(value || '').replace(/\/+$/, '');

/**
 * Origen público (esquema + host[:puerto]) donde el enlace será accesible desde fuera.
 * Prioridad:
 *   1) PUBLIC_BASE_URL / FRONTEND_URL explícito (recomendado detrás de proxy/nginx en producción).
 *   2) Cabeceras X-Forwarded-* que inyecta nginx/el proxy (conservan host y puerto reales).
 *   3) Referer/Origin de la petición del admin (cubre el proxy de dev que reescribe el Host).
 *   4) Host de la petición tal cual.
 */
const resolvePublicOrigin = (req) => {
  const configured = stripTrailingSlashes(process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '');
  if (configured) {
    return configured;
  }

  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const fwdHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (fwdHost) {
    return `${fwdProto || req.protocol || 'http'}://${fwdHost}`;
  }

  const referer = req.headers.referer || req.headers.origin;
  if (referer) {
    try {
      return stripTrailingSlashes(new URL(referer).origin);
    } catch (_) { /* referer no parseable: se ignora */ }
  }

  return `${req.protocol || 'http'}://${req.get('host') || 'localhost'}`;
};

const buildLinkPayload = (req, doc) => {
  if (!doc) {
    return { exists: false, enabled: false };
  }
  const path = `${PUBLIC_PATH_PREFIX}${doc.token}`;
  return {
    exists: true,
    enabled: doc.enabled === true,
    token: doc.token,
    path,
    url: `${resolvePublicOrigin(req)}${path}`,
    createdByName: doc.createdByName || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastAccessedAt: doc.lastAccessedAt,
    accessCount: doc.accessCount || 0
  };
};

const resolveAppTitle = async () => {
  try {
    const branding = await getBrandingSnapshot();
    if (branding && branding.appTitle) {
      return branding.appTitle;
    }
  } catch (error) {
    logger.warn({ err: error }, 'No se pudo resolver el branding para la página pública de teletrabajo');
  }
  return 'Bitácora SOC';
};

// ─── Admin ──────────────────────────────────────────────────────────────────

exports.getTeleworkLink = async (req, res) => {
  try {
    const doc = await PublicShareLink.findOne({ type: SHARE_TYPE });
    res.json(buildLinkPayload(req, doc));
  } catch (error) {
    logger.error({ err: error }, 'Error in getTeleworkLink');
    res.status(500).json({ error: error.message });
  }
};

exports.rotateTeleworkLink = async (req, res) => {
  try {
    const token = PublicShareLink.generateToken();
    const doc = await PublicShareLink.findOneAndUpdate(
      { type: SHARE_TYPE },
      {
        $set: {
          token,
          enabled: true,
          createdBy: req.user && req.user._id ? req.user._id : null,
          createdByName: (req.user && (req.user.fullName || req.user.username)) || '',
          lastAccessedAt: null,
          accessCount: 0
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await audit(req, {
      event: 'escalation.public-share.telework.rotated',
      result: { success: true },
      metadata: { type: SHARE_TYPE }
    }).catch((e) => logger.warn({ err: e }, 'No se pudo auditar la rotación del enlace público de teletrabajo'));

    res.json(buildLinkPayload(req, doc));
  } catch (error) {
    logger.error({ err: error }, 'Error in rotateTeleworkLink');
    res.status(500).json({ error: error.message });
  }
};

exports.setTeleworkLinkEnabled = async (req, res) => {
  try {
    const enabled = req.body && (req.body.enabled === true || req.body.enabled === 'true');
    const doc = await PublicShareLink.findOne({ type: SHARE_TYPE });
    if (!doc) {
      return res.status(404).json({ error: 'No hay enlace generado todavía' });
    }

    doc.enabled = enabled;
    await doc.save();

    await audit(req, {
      event: enabled ? 'escalation.public-share.telework.enabled' : 'escalation.public-share.telework.disabled',
      result: { success: true },
      metadata: { type: SHARE_TYPE }
    }).catch((e) => logger.warn({ err: e }, 'No se pudo auditar el cambio de estado del enlace público de teletrabajo'));

    res.json(buildLinkPayload(req, doc));
  } catch (error) {
    logger.error({ err: error }, 'Error in setTeleworkLinkEnabled');
    res.status(500).json({ error: error.message });
  }
};

// ─── Público (sin sesión) ───────────────────────────────────────────────────

exports.renderTeleworkWeeklyPublic = async (req, res) => {
  const appTitle = await resolveAppTitle();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const token = String(req.params.token || '');
    if (!TOKEN_RE.test(token)) {
      return res.status(404).send(renderUnavailablePage(appTitle));
    }

    const link = await PublicShareLink.findOne({ token, type: SHARE_TYPE, enabled: true });
    if (!link) {
      return res.status(404).send(renderUnavailablePage(appTitle));
    }

    const now = new Date();
    const weekStart = resolveWeekStart(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);

    const [users, assignments] = await Promise.all([
      User.find({ isActive: true, role: { $nin: ['guest', 'auditor'] } })
        .select('_id fullName role cargoLabel')
        .lean(),
      ShiftAssignment.find({
        roleCode: { $in: RELEVANT_ROLE_CODES },
        isPaused: { $ne: true },
        userId: { $ne: null },
        ...buildWeekOverlapFilter(weekStart, weekEnd)
      })
        .select('_id userId roleCode weekStartDate weekEndDate isPaused')
        .lean()
    ]);

    const matrix = buildTeleworkWeeklyMatrix({ assignments, users, now });
    const html = renderTeleworkWeeklyPage({
      matrix,
      appTitle,
      generatedAt: now,
      refreshSeconds: REFRESH_SECONDS
    });

    const lastTs = link.lastAccessedAt ? new Date(link.lastAccessedAt).getTime() : 0;
    if (Date.now() - lastTs > ACCESS_METRIC_THROTTLE_MS) {
      PublicShareLink.updateOne(
        { _id: link._id },
        { $set: { lastAccessedAt: new Date() }, $inc: { accessCount: 1 } }
      ).catch(() => { /* métrica best-effort */ });
    }

    return res.status(200).send(html);
  } catch (error) {
    logger.error({ err: error }, 'Error rendering public telework page');
    return res.status(500).send(renderUnavailablePage(appTitle));
  }
};
