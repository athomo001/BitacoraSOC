/**
 * File Purpose: backend/src/routes/audit-logs.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { audit } = require('../utils/audit');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildDateRange = (startDate, endDate) => {
  if (!startDate && !endDate) return undefined;
  const range = {};
  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime())) {
      range.$gte = start;
    }
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      // incluir el día completo si viene solo fecha
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
  }
  return Object.keys(range).length ? range : undefined;
};

const clampInt = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const buildFiltersFromQuery = (query) => {
  const {
    userId,
    category,
    event,
    level,
    startDate,
    endDate,
    search,
    sourceSlug
  } = query;

  const filters = {};

  if (userId) {
    filters['actor.userId'] = userId;
  }

  if (event) {
    filters.event = event;
  } else if (category) {
    switch (category) {
      case 'mail':
        filters.event = /^(mail\.|smtp\.)/;
        break;
      case 'admin':
        filters.event = /^(admin\.|BACKUP_)/;
        break;
      case 'backup':
        filters.event = /^(admin\.backup\.|BACKUP_)/;
        break;
      case 'user':
        filters.event = /^(user\.|entry\.|shiftcheck\.|checklist\.)/;
        break;
      case 'security':
        filters.event = /^(auth\.|security\.)/;
        break;
      case 'complement':
        filters.source = 'complement';
        break;
      default:
        break;
    }
  }

  if (level) {
    filters.level = level;
  }

  if (sourceSlug) {
    filters.source = 'complement';
    filters.sourceId = sourceSlug;
  }

  const dateRange = buildDateRange(startDate, endDate);
  if (dateRange) {
    filters.timestamp = dateRange;
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filters.$or = [
      { event: pattern },
      { 'actor.username': pattern },
      { 'request.ip': pattern },
      { 'request.path': pattern },
      { 'result.reason': pattern },
      { sourceId: pattern },
      { source: pattern }
    ];
  }

  return filters;
};

const toIsoText = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
};

const escapeCsv = (value) => {
  const raw = value == null ? '' : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const toCsvRows = (logs) => {
  const headers = [
    'timestamp',
    'event',
    'level',
    'source',
    'sourceId',
    'actorUsername',
    'actorRole',
    'requestIp',
    'requestPath',
    'method',
    'success',
    'reason',
    'metadata'
  ];

  const lines = [headers.join(',')];
  logs.forEach((log) => {
    const row = [
      toIsoText(log.timestamp),
      log.event || '',
      log.level || '',
      log.source || 'core',
      log.sourceId || '',
      log.actor?.username || '',
      log.actor?.role || '',
      log.request?.ip || '',
      log.request?.path || '',
      log.request?.method || '',
      typeof log.result?.success === 'boolean' ? String(log.result.success) : '',
      log.result?.reason || '',
      JSON.stringify(log.metadata || {})
    ].map(escapeCsv);
    lines.push(row.join(','));
  });
  return lines.join('\n');
};

// GET /api/audit-logs
router.get('/', authenticate, authorize('admin', 'auditor'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      ...restQuery
    } = req.query;
    const filters = buildFiltersFromQuery(restQuery);

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const skip = (pageNumber - 1) * limitNumber;

    const [logs, totalItems] = await Promise.all([
      AuditLog.find(filters)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      AuditLog.countDocuments(filters)
    ]);

    res.json({
      logs,
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limitNumber),
        currentPage: pageNumber,
        itemsPerPage: limitNumber
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Error obteniendo audit logs');
    res.status(500).json({ message: 'Error obteniendo logs de auditoría' });
  }
});

// GET /api/audit-logs/export
router.get('/export', authenticate, authorize('admin', 'auditor'), async (req, res) => {
  try {
    const {
      format = 'csv',
      mode = 'max',
      maxRecords,
      days,
      months,
      all,
      ...filtersQuery
    } = req.query;

    const exportFormat = String(format).toLowerCase() === 'json' ? 'json' : 'csv';
    const filters = buildFiltersFromQuery(filtersQuery);
    const selectedMode = toBoolean(all) ? 'all' : String(mode || 'filters').toLowerCase();
    const now = new Date();

    if (selectedMode === 'days') {
      const daysValue = clampInt(days, 1, 3650, 7);
      filters.timestamp = { ...(filters.timestamp || {}), $gte: new Date(now.getTime() - daysValue * 24 * 60 * 60 * 1000) };
    } else if (selectedMode === 'months') {
      const monthsValue = clampInt(months, 1, 120, 1);
      const rangeStart = new Date(now);
      rangeStart.setMonth(rangeStart.getMonth() - monthsValue);
      filters.timestamp = { ...(filters.timestamp || {}), $gte: rangeStart };
    }

    let limitByMode = clampInt(maxRecords, 1, 10000, 1000);
    if (selectedMode === 'all') {
      limitByMode = clampInt(maxRecords, 1, 50000, 50000);
    } else if (selectedMode === 'filters') {
      limitByMode = clampInt(maxRecords, 1, 50000, 10000);
    }

    const logs = await AuditLog.find(filters)
      .sort({ timestamp: -1 })
      .limit(limitByMode)
      .lean();

    const exportedCount = logs.length;
    const fileDate = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `audit-logs-${fileDate}`;

    await audit(req, {
      event: 'audit.logs.export',
      level: 'info',
      result: { success: true, reason: 'Audit logs exported' },
      metadata: {
        format: exportFormat,
        mode: selectedMode,
        exportedCount,
        limitApplied: limitByMode,
        filters: {
          category: filtersQuery.category || null,
          event: filtersQuery.event || null,
          level: filtersQuery.level || null,
          startDate: filtersQuery.startDate || null,
          endDate: filtersQuery.endDate || null,
          search: filtersQuery.search || null,
          sourceSlug: filtersQuery.sourceSlug || null
        }
      }
    });

    if (exportFormat === 'json') {
      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(),
        exportedCount,
        mode: selectedMode,
        logs
      }, null, 2);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
      return res.status(200).send(payload);
    }

    const csv = toCsvRows(logs);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    logger.error({ err: error }, 'Error exportando audit logs');
    return res.status(500).json({ message: 'Error exportando logs de auditoría' });
  }
});

// GET /api/audit-logs/events
router.get('/events', authenticate, authorize('admin', 'auditor'), async (req, res) => {
  try {
    const events = await AuditLog.distinct('event');
    events.sort();
    res.json({ events });
  } catch (error) {
    logger.error({ err: error }, 'Error obteniendo eventos de auditoría');
    res.status(500).json({ message: 'Error obteniendo eventos' });
  }
});

// GET /api/audit-logs/stats
router.get('/stats', authenticate, authorize('admin', 'auditor'), async (req, res) => {
  try {
    const [
      totalLogs,
      successCount,
      failureCount,
      topActions,
      topUsers,
      totalUsers
    ] = await Promise.all([
      AuditLog.countDocuments(),
      AuditLog.countDocuments({ 'result.success': true }),
      AuditLog.countDocuments({ 'result.success': false }),
      AuditLog.aggregate([
        { $group: { _id: '$event', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, action: '$_id', count: 1 } }
      ]),
      AuditLog.aggregate([
        { $group: { _id: '$actor.username', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, username: '$_id', count: 1 } }
      ]),
      AuditLog.distinct('actor.userId').then((ids) => ids.filter(Boolean).length)
    ]);

    res.json({
      totalLogs,
      totalUsers,
      successCount,
      failureCount,
      topActions,
      topUsers
    });
  } catch (error) {
    logger.error({ err: error }, 'Error obteniendo stats de auditoría');
    res.status(500).json({ message: 'Error obteniendo estadísticas' });
  }
});

module.exports = router;
