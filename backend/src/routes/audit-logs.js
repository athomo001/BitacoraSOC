const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../utils/logger');

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

// GET /api/audit-logs
router.get('/', authenticate, authorize('admin', 'auditor'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      userId,
      category,
      event,
      level,
      startDate,
      endDate,
      search,
      sourceSlug
    } = req.query;

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
