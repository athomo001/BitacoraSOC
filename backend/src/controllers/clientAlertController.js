/**
 * File Purpose: backend/src/controllers/clientAlertController.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');
const ClientEscalationRule = require('../models/ClientEscalationRule');
const CatalogLogSource = require('../models/CatalogLogSource');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');

const DEFAULT_TIMEZONE = 'America/Santiago';
const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_CONTEXTS = new Set(['report', 'copy-report']);
const ALLOWED_WINDOW_MODES = new Set([
  'always',
  'outside_business_hours',
  'between_hours',
  'after_hour',
  'before_hour',
  'weekend_only',
  'weekdays_only'
]);
const ALLOWED_CHANNELS = new Set(['email', 'whatsapp', 'telefono', 'otro']);
const WEEKDAY_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

/*
 * QA — alertas por cliente (escalamiento):
 * - `evaluateClientAlert`: resuelve cliente por `clientId` o `clientName` (nombre duplicado → 400; no adivinar).
 * - Ventanas horarias: `Intl` + zona por regla; probar cambio DST y medianoche (`isTimeInRange` cruza día).
 * - Precedencia: maintenance bloqueante → maintenance informativo → resto (comentario ESC-MAINT-042 en handler).
 * - `acknowledgeClientAlert`: deduplica por usuario + occurrenceKey + contexto; sin usuario no persiste readBy.
 */

const ENABLED_LOG_SOURCE_MATCH = {
  $or: [
    { enabled: true },
    { enabled: { $exists: false } }
  ]
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeContext = (value) => {
  const candidate = (value || 'report').toString().trim().toLowerCase();
  return ALLOWED_CONTEXTS.has(candidate) ? candidate : 'report';
};

const normalizeTimezone = (value) => {
  const candidate = (value || DEFAULT_TIMEZONE).toString().trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

const normalizeHHMM = (value, fallback) => {
  if (!value) return fallback;
  const normalized = value.toString().trim();
  return HHMM_REGEX.test(normalized) ? normalized : fallback;
};

const toMinutes = (hhmm) => {
  if (!HHMM_REGEX.test(hhmm)) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60) + m;
};

const isTimeInRange = (valueMinutes, startMinutes, endMinutes) => {
  if (startMinutes <= endMinutes) {
    return valueMinutes >= startMinutes && valueMinutes <= endMinutes;
  }
  // Ventana que cruza medianoche, ej: 22:00-06:00
  return valueMinutes >= startMinutes || valueMinutes <= endMinutes;
};

const getLocalTimeContext = (date, timezone) => {
  const normalizedTz = normalizeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const year = parts.year || '1970';
  const month = parts.month || '01';
  const day = parts.day || '01';
  const hour = parts.hour || '00';
  const minute = parts.minute || '00';
  const weekday = parts.weekday || 'Sun';

  const localDate = `${year}-${month}-${day}`;
  const localTime = `${hour}:${minute}`;
  const dayOfWeek = WEEKDAY_MAP[weekday] ?? 0;
  const minutes = toMinutes(localTime);

  return {
    timezone: normalizedTz,
    localDate,
    localTime,
    dayOfWeek,
    minutes
  };
};

const normalizeContexts = (contexts) => {
  const source = Array.isArray(contexts) ? contexts : ['report'];
  const normalized = source
    .map((item) => normalizeContext(item))
    .filter((value) => ALLOWED_CONTEXTS.has(value));
  return [...new Set(normalized.length ? normalized : ['report'])];
};

const normalizeDaysOfWeek = (days) => {
  if (!Array.isArray(days)) return [];
  return [...new Set(days
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
};

const normalizeHolidayDates = (dates) => {
  if (!Array.isArray(dates)) return [];
  return [...new Set(dates
    .map((d) => (d || '').toString().trim())
    .filter((d) => DATE_ONLY_REGEX.test(d)))];
};

const normalizeChannels = (channels) => {
  if (!Array.isArray(channels)) return [];
  return channels
    .map((raw) => ({
      type: ALLOWED_CHANNELS.has((raw?.type || '').toString()) ? raw.type : null,
      target: (raw?.target || '').toString().trim(),
      notes: (raw?.notes || '').toString().trim()
    }))
    .filter((item) => item.type);
};

const normalizeTimeWindows = (windows) => {
  if (!Array.isArray(windows) || windows.length === 0) {
    return [{ mode: 'always', startTime: '09:00', endTime: '17:00', daysOfWeek: [], holidayOnly: false }];
  }

  const normalized = windows
    .map((window) => {
      const mode = ALLOWED_WINDOW_MODES.has(window?.mode) ? window.mode : 'always';
      return {
        mode,
        startTime: normalizeHHMM(window?.startTime, '09:00'),
        endTime: normalizeHHMM(window?.endTime, '17:00'),
        daysOfWeek: normalizeDaysOfWeek(window?.daysOfWeek),
        holidayOnly: window?.holidayOnly === true
      };
    });

  return normalized.length > 0 ? normalized : [{ mode: 'always', startTime: '09:00', endTime: '17:00', daysOfWeek: [], holidayOnly: false }];
};

const ALLOWED_RULE_TYPES = new Set(['special_alert', 'scheduled_maintenance']);

const buildOccurrenceKey = (rule, localContext) => {
  if (rule.validFrom || rule.validTo) {
    const from = rule.validFrom ? new Date(rule.validFrom).toISOString() : 'open';
    const to = rule.validTo ? new Date(rule.validTo).toISOString() : 'open';
    return `${rule._id}-${from}-${to}`;
  }
  // ventana recurrente: incluir fecha local efectiva
  return `${rule._id}-${localContext.localDate}`;
};

const parseRulePayload = (body) => {
  const ruleType = ALLOWED_RULE_TYPES.has(body.ruleType) ? body.ruleType : 'special_alert';
  const payload = {
    clientId: body.clientId,
    name: (body.name || '').toString().trim(),
    enabled: body.enabled !== false,
    contexts: normalizeContexts(body.contexts),
    timezone: normalizeTimezone(body.timezone),
    priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
    validFrom: body.validFrom ? new Date(body.validFrom) : null,
    validTo: body.validTo ? new Date(body.validTo) : null,
    holidayDates: normalizeHolidayDates(body.holidayDates),
    timeWindows: normalizeTimeWindows(body.timeWindows),
    channels: normalizeChannels(body.channels),
    alertMessage: (body.alertMessage || '').toString().trim(),
    acknowledgementRequired: body.acknowledgementRequired !== false,
    ruleType,
    blocking: ruleType === 'scheduled_maintenance' ? (body.blocking === true) : false,
    maintenanceTitle: ruleType === 'scheduled_maintenance'
      ? (body.maintenanceTitle || '').toString().trim().substring(0, 500)
      : ''
  };

  if (Number.isNaN(payload.validFrom?.getTime?.())) payload.validFrom = null;
  if (Number.isNaN(payload.validTo?.getTime?.())) payload.validTo = null;

  return payload;
};

const isRuleWithinValidity = (rule, now) => {
  if (rule.validFrom && now < rule.validFrom) return false;
  if (rule.validTo && now > rule.validTo) return false;
  return true;
};

const isWindowMatch = (window, localContext, holidayDates) => {
  const {
    mode = 'always',
    startTime = '09:00',
    endTime = '17:00',
    daysOfWeek = [],
    holidayOnly = false
  } = window || {};

  if (Array.isArray(daysOfWeek) && daysOfWeek.length > 0 && !daysOfWeek.includes(localContext.dayOfWeek)) {
    return false;
  }

  if (holidayOnly && !holidayDates.includes(localContext.localDate)) {
    return false;
  }

  const nowMinutes = localContext.minutes;
  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);

  switch (mode) {
    case 'always':
      return true;
    case 'outside_business_hours':
      return !isTimeInRange(nowMinutes, startMinutes, endMinutes);
    case 'between_hours':
      return isTimeInRange(nowMinutes, startMinutes, endMinutes);
    case 'after_hour':
      return nowMinutes >= startMinutes;
    case 'before_hour':
      return nowMinutes <= endMinutes;
    case 'weekend_only':
      return localContext.dayOfWeek === 0 || localContext.dayOfWeek === 6;
    case 'weekdays_only':
      return localContext.dayOfWeek >= 1 && localContext.dayOfWeek <= 5;
    default:
      return false;
  }
};

const findMatchedWindow = (rule, now) => {
  const timezone = normalizeTimezone(rule.timezone);
  const localContext = getLocalTimeContext(now, timezone);
  const holidayDates = normalizeHolidayDates(rule.holidayDates);
  const windows = normalizeTimeWindows(rule.timeWindows);

  for (const window of windows) {
    if (isWindowMatch(window, localContext, holidayDates)) {
      return {
        matched: true,
        window,
        localContext
      };
    }
  }

  return {
    matched: false,
    window: null,
    localContext
  };
};

const serializeRule = (rule, matchedWindowInfo, occurrenceKey) => ({
  _id: rule._id,
  clientId: rule.clientId,
  name: rule.name,
  enabled: rule.enabled,
  contexts: rule.contexts,
  timezone: rule.timezone,
  priority: rule.priority,
  validFrom: rule.validFrom,
  validTo: rule.validTo,
  channels: rule.channels || [],
  alertMessage: rule.alertMessage,
  acknowledgementRequired: rule.acknowledgementRequired !== false,
  ruleType: rule.ruleType || 'special_alert',
  blocking: rule.blocking === true,
  maintenanceTitle: rule.maintenanceTitle || '',
  matchedWindow: matchedWindowInfo?.window || null,
  occurrenceKey: occurrenceKey || null
});

exports.getClientAlertRules = async (req, res) => {
  try {
    const { clientId, enabled } = req.query;
    const filter = {};

    if (clientId) {
      if (!isObjectId(clientId)) {
        return res.status(400).json({ error: 'clientId inválido' });
      }
      filter.clientId = clientId;
    }

    if (enabled !== undefined) {
      filter.enabled = enabled === 'true';
    }

    const rules = await ClientEscalationRule.find(filter)
      .populate({
        path: 'clientId',
        select: 'name parent enabled',
        match: ENABLED_LOG_SOURCE_MATCH
      })
      .sort({ priority: 1, createdAt: -1 });

    return res.json(rules.filter((rule) => Boolean(rule.clientId)));
  } catch (error) {
    logger.error('Error in getClientAlertRules:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.createClientAlertRule = async (req, res) => {
  try {
    if (!isObjectId(req.body?.clientId)) {
      return res.status(400).json({ error: 'clientId inválido' });
    }

    const clientExists = await CatalogLogSource.exists({
      _id: req.body.clientId,
      ...ENABLED_LOG_SOURCE_MATCH
    });
    if (!clientExists) {
      return res.status(404).json({ error: 'Cliente/Log Source no encontrado' });
    }

    const payload = parseRulePayload(req.body || {});
    payload.lastUpdatedBy = req.user?._id || null;

    const rule = await ClientEscalationRule.create(payload);
    const populated = await ClientEscalationRule.findById(rule._id).populate({
      path: 'clientId',
      select: 'name parent enabled',
      match: ENABLED_LOG_SOURCE_MATCH
    });

    await audit(req, {
      event: 'escalation.client_alert_rule.create',
      level: 'info',
      result: { success: true },
      metadata: {
        ruleId: rule._id,
        clientId: rule.clientId,
        priority: rule.priority,
        contexts: rule.contexts
      }
    });

    return res.status(201).json(populated);
  } catch (error) {
    logger.error('Error in createClientAlertRule:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.updateClientAlertRule = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }

    if (req.body?.clientId && !isObjectId(req.body.clientId)) {
      return res.status(400).json({ error: 'clientId inválido' });
    }

    if (req.body?.clientId) {
      const clientExists = await CatalogLogSource.exists({
        _id: req.body.clientId,
        ...ENABLED_LOG_SOURCE_MATCH
      });
      if (!clientExists) {
        return res.status(404).json({ error: 'Cliente/Log Source no encontrado' });
      }
    }

    const payload = parseRulePayload({
      ...(req.body || {}),
      clientId: req.body?.clientId
    });
    payload.lastUpdatedBy = req.user?._id || null;

    const updated = await ClientEscalationRule.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true
    }).populate({
      path: 'clientId',
      select: 'name parent enabled',
      match: ENABLED_LOG_SOURCE_MATCH
    });

    if (!updated) {
      return res.status(404).json({ error: 'Regla no encontrada' });
    }

    await audit(req, {
      event: 'escalation.client_alert_rule.update',
      level: 'info',
      result: { success: true },
      metadata: {
        ruleId: updated._id,
        clientId: updated.clientId?._id || updated.clientId,
        priority: updated.priority,
        contexts: updated.contexts
      }
    });

    return res.json(updated);
  } catch (error) {
    logger.error('Error in updateClientAlertRule:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.deleteClientAlertRule = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const deleted = await ClientEscalationRule.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Regla no encontrada' });
    }

    await audit(req, {
      event: 'escalation.client_alert_rule.delete',
      level: 'warn',
      result: { success: true },
      metadata: {
        ruleId: deleted._id,
        clientId: deleted.clientId
      }
    });

    return res.json({ message: 'Regla eliminada correctamente' });
  } catch (error) {
    logger.error('Error in deleteClientAlertRule:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.evaluateClientAlert = async (req, res) => {
  try {
    const { clientId, clientName, context = 'report', now } = req.query;

    const normalizedContext = normalizeContext(context);
    const requestedNow = now ? new Date(now) : new Date();
    const evaluationNow = Number.isNaN(requestedNow.getTime()) ? new Date() : requestedNow;

    // ── Resolución de clientId (soporte por clientName) ─────────────────────
    let resolvedClientId = clientId;

    if (!resolvedClientId && clientName) {
      const trimmedName = clientName.toString().trim();
      const matches = await CatalogLogSource.find({
        name: trimmedName,
        ...ENABLED_LOG_SOURCE_MATCH
      }).select('_id').lean();

      if (matches.length === 0) {
        return res.status(404).json({ error: 'Cliente/Log Source no encontrado por nombre' });
      }
      if (matches.length > 1) {
        return res.status(400).json({ error: `Nombre ambiguo: ${matches.length} clientes con ese nombre` });
      }
      resolvedClientId = matches[0]._id.toString();
    }

    if (!resolvedClientId || !isObjectId(resolvedClientId)) {
      return res.status(400).json({ error: 'clientId o clientName es requerido y debe ser válido' });
    }

    const client = await CatalogLogSource.findOne({
      _id: resolvedClientId,
      ...ENABLED_LOG_SOURCE_MATCH
    }).select('_id name parent enabled').lean();
    if (!client) {
      return res.status(404).json({ error: 'Cliente/Log Source no encontrado' });
    }

    const rules = await ClientEscalationRule.find({
      clientId: resolvedClientId,
      enabled: true,
      contexts: normalizedContext
    }).sort({ priority: 1, updatedAt: -1 });

    // ── Precedencia ESC-MAINT-042 ─────────────────────────────────────────
    // 1° scheduled_maintenance bloqueante → 2° scheduled_maintenance no bloqueante → 3° special_alert
    const sortedRules = [
      ...rules.filter(r => r.ruleType === 'scheduled_maintenance' && r.blocking),
      ...rules.filter(r => r.ruleType === 'scheduled_maintenance' && !r.blocking),
      ...rules.filter(r => r.ruleType !== 'scheduled_maintenance')
    ];

    let appliedRule = null;
    let matchedInfo = null;

    for (const rule of sortedRules) {
      if (!isRuleWithinValidity(rule, evaluationNow)) {
        continue;
      }

      const currentMatch = findMatchedWindow(rule, evaluationNow);
      if (currentMatch.matched) {
        appliedRule = rule;
        matchedInfo = currentMatch;
        break;
      }
    }

    if (!appliedRule) {
      const fallbackContext = getLocalTimeContext(evaluationNow, DEFAULT_TIMEZONE);
      return res.json({
        hasAlert: false,
        context: normalizedContext,
        client: {
          _id: client._id,
          name: client.name,
          parent: client.parent || null
        },
        evaluation: {
          evaluatedAt: evaluationNow.toISOString(),
          timezone: fallbackContext.timezone,
          localDate: fallbackContext.localDate,
          localTime: fallbackContext.localTime,
          dayOfWeek: fallbackContext.dayOfWeek
        },
        rule: null
      });
    }

    const occurrenceKey = buildOccurrenceKey(appliedRule, matchedInfo.localContext);

    await audit(req, {
      event: 'escalation.client_alert.shown',
      level: 'info',
      result: { success: true },
      metadata: {
        ruleId: appliedRule._id,
        ruleType: appliedRule.ruleType || 'special_alert',
        blocking: appliedRule.blocking === true,
        clientId: client._id,
        context: normalizedContext,
        timezone: matchedInfo.localContext.timezone,
        localDate: matchedInfo.localContext.localDate,
        localTime: matchedInfo.localContext.localTime,
        matchedMode: matchedInfo.window?.mode || 'always',
        occurrenceKey
      }
    });

    return res.json({
      hasAlert: true,
      context: normalizedContext,
      client: {
        _id: client._id,
        name: client.name,
        parent: client.parent || null
      },
      evaluation: {
        evaluatedAt: evaluationNow.toISOString(),
        timezone: matchedInfo.localContext.timezone,
        localDate: matchedInfo.localContext.localDate,
        localTime: matchedInfo.localContext.localTime,
        dayOfWeek: matchedInfo.localContext.dayOfWeek
      },
      rule: serializeRule(appliedRule, matchedInfo, occurrenceKey)
    });
  } catch (error) {
    logger.error('Error in evaluateClientAlert:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.acknowledgeClientAlert = async (req, res) => {
  try {
    const { ruleId, clientId, context = 'report', acknowledgedAt, occurrenceKey } = req.body || {};

    if (!ruleId || !isObjectId(ruleId)) {
      return res.status(400).json({ error: 'ruleId es requerido y debe ser válido' });
    }

    const rule = await ClientEscalationRule.findById(ruleId).select('_id clientId contexts readBy').lean();
    if (!rule) {
      return res.status(404).json({ error: 'Regla no encontrada' });
    }

    if (clientId && (!isObjectId(clientId) || rule.clientId.toString() !== clientId.toString())) {
      return res.status(400).json({ error: 'clientId no coincide con la regla' });
    }

    const normalizedContext = normalizeContext(context);
    const ackDate = acknowledgedAt ? new Date(acknowledgedAt) : new Date();
    const effectiveAckDate = Number.isNaN(ackDate.getTime()) ? new Date() : ackDate;
    const effectiveOccurrenceKey = (occurrenceKey || '').toString().trim() || `${ruleId}-open`;

    // ── Persistir readBy si hay usuario autenticado (ESC-MAINT-042) ─────────
    if (req.user?._id) {
      const userId = req.user._id;
      const username = req.user.username || req.user.fullName || '';

      // Evitar duplicado: misma ocurrencia + mismo usuario
      const alreadyRead = (rule.readBy || []).some(
        (entry) => entry.userId?.toString() === userId.toString()
          && entry.occurrenceKey === effectiveOccurrenceKey
          && entry.context === normalizedContext
      );

      if (!alreadyRead) {
        await ClientEscalationRule.findByIdAndUpdate(ruleId, {
          $push: {
            readBy: {
              userId,
              username,
              context: normalizedContext,
              readAt: effectiveAckDate,
              occurrenceKey: effectiveOccurrenceKey
            }
          }
        });
      }
    }

    await audit(req, {
      event: 'escalation.client_alert.ack',
      level: 'info',
      result: { success: true },
      metadata: {
        ruleId: rule._id,
        clientId: rule.clientId,
        context: normalizedContext,
        acknowledgedAt: effectiveAckDate.toISOString(),
        occurrenceKey: effectiveOccurrenceKey
      }
    });

    return res.json({
      acknowledged: true,
      ruleId: rule._id,
      clientId: rule.clientId,
      context: normalizedContext,
      acknowledgedAt: effectiveAckDate.toISOString(),
      occurrenceKey: effectiveOccurrenceKey
    });
  } catch (error) {
    logger.error('Error in acknowledgeClientAlert:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// ESC-MAINT-042 — Mantenimientos (accesible a analistas y admins)
// CRUD scoped a ruleType = 'scheduled_maintenance'
// ────────────────────────────────────────────────────────────────────────────

exports.getMaintenanceRules = async (req, res) => {
  try {
    const { clientId, enabled } = req.query;
    const filter = { ruleType: 'scheduled_maintenance' };

    if (clientId) {
      if (!isObjectId(clientId)) return res.status(400).json({ error: 'clientId inválido' });
      filter.clientId = clientId;
    }
    if (enabled !== undefined) {
      filter.enabled = enabled === 'true';
    }

    const rules = await ClientEscalationRule.find(filter)
      .populate({ path: 'clientId', select: 'name enabled', match: ENABLED_LOG_SOURCE_MATCH })
      .sort({ createdAt: -1 });

    return res.json(rules);
  } catch (error) {
    logger.error('Error in getMaintenanceRules:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.createMaintenanceRule = async (req, res) => {
  try {
    const body = req.body || {};

    if (body.clientId && !isObjectId(body.clientId)) {
      return res.status(400).json({ error: 'clientId inválido' });
    }

    if (body.clientId) {
      const exists = await CatalogLogSource.exists({ _id: body.clientId, ...ENABLED_LOG_SOURCE_MATCH });
      if (!exists) return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const payload = {
      clientId: body.clientId || null,
      name: (body.name || '').toString().trim(),
      ruleType: 'scheduled_maintenance',
      maintenanceTitle: (body.maintenanceTitle || '').toString().trim().substring(0, 500),
      blocking: body.blocking === true,
      enabled: body.enabled !== false,
      alertMessage: (body.alertMessage || '').toString().trim(),
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validTo: body.validTo ? new Date(body.validTo) : null,
      contexts: ['report'],
      timeWindows: [{ mode: 'always', startTime: '00:00', endTime: '00:00', daysOfWeek: [], holidayOnly: false }],
      channels: [],
      timezone: normalizeTimezone(body.timezone),
      priority: 100,
      acknowledgementRequired: false,
      lastUpdatedBy: req.user?._id || null
    };

    const rule = await ClientEscalationRule.create(payload);
    const populated = await ClientEscalationRule.findById(rule._id)
      .populate({ path: 'clientId', select: 'name enabled', match: ENABLED_LOG_SOURCE_MATCH });

    await audit(req, {
      event: 'escalation.maintenance_rule.create',
      level: 'info',
      result: { success: true },
      metadata: { ruleId: rule._id, blocking: rule.blocking, maintenanceTitle: rule.maintenanceTitle }
    });

    return res.status(201).json(populated);
  } catch (error) {
    logger.error('Error in createMaintenanceRule:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.updateMaintenanceRule = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ error: 'id inválido' });

    const existing = await ClientEscalationRule.findById(id).select('ruleType').lean();
    if (!existing) return res.status(404).json({ error: 'Mantenimiento no encontrado' });
    if (existing.ruleType !== 'scheduled_maintenance') {
      return res.status(403).json({ error: 'Solo se pueden editar mantenimientos desde esta ruta' });
    }

    const body = req.body || {};

    if (body.clientId && !isObjectId(body.clientId)) {
      return res.status(400).json({ error: 'clientId inválido' });
    }

    const updatePayload = {
      name: (body.name || '').toString().trim(),
      maintenanceTitle: (body.maintenanceTitle || '').toString().trim().substring(0, 500),
      blocking: body.blocking === true,
      enabled: body.enabled !== false,
      alertMessage: (body.alertMessage || '').toString().trim(),
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validTo: body.validTo ? new Date(body.validTo) : null,
      timezone: normalizeTimezone(body.timezone),
      lastUpdatedBy: req.user?._id || null
    };

    if (body.clientId !== undefined) {
      updatePayload.clientId = body.clientId || null;
    }

    const updated = await ClientEscalationRule.findByIdAndUpdate(id, updatePayload, {
      new: true, runValidators: true
    }).populate({ path: 'clientId', select: 'name enabled', match: ENABLED_LOG_SOURCE_MATCH });

    await audit(req, {
      event: 'escalation.maintenance_rule.update',
      level: 'info',
      result: { success: true },
      metadata: { ruleId: updated._id, blocking: updated.blocking, maintenanceTitle: updated.maintenanceTitle }
    });

    return res.json(updated);
  } catch (error) {
    logger.error('Error in updateMaintenanceRule:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.deleteMaintenanceRule = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ error: 'id inválido' });

    const rule = await ClientEscalationRule.findById(id).select('ruleType').lean();
    if (!rule) return res.status(404).json({ error: 'Mantenimiento no encontrado' });
    if (rule.ruleType !== 'scheduled_maintenance') {
      return res.status(403).json({ error: 'Solo se pueden eliminar mantenimientos desde esta ruta' });
    }

    await ClientEscalationRule.findByIdAndDelete(id);

    await audit(req, {
      event: 'escalation.maintenance_rule.delete',
      level: 'warn',
      result: { success: true },
      metadata: { ruleId: id }
    });

    return res.json({ message: 'Mantenimiento eliminado' });
  } catch (error) {
    logger.error('Error in deleteMaintenanceRule:', error);
    return res.status(500).json({ error: error.message });
  }
};
