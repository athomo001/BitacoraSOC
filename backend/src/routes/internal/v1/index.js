const express = require('express');
const Entry = require('../../../models/Entry');
const AuditLog = require('../../../models/AuditLog');
const ComplementSharedRecord = require('../../../models/ComplementSharedRecord');
const { authenticateComplement, requireAllowedCollection, requireScope } = require('../../../middleware/complement-auth');
const { audit } = require('../../../utils/audit');
const WorkShift = require('../../../models/WorkShift');

const router = express.Router();

const buildVersionHeaders = (req, res, next) => {
  res.setHeader('X-API-Version', 'v1');
  res.setHeader('X-API-Latest', 'v1');
  next();
};

router.use(buildVersionHeaders, authenticateComplement);

router.get('/context', requireScope('READ_CONTEXT'), async (req, res) => {
  const shift = await WorkShift.findOne({ active: true }).sort({ order: 1 }).populate('assignedUserIds', 'fullName');
  const payload = {
    version: 'v1',
    appVersion: process.env.APP_VERSION || 'dev',
    requestId: req.requestId,
    shift: shift ? {
      shiftId: String(shift._id),
      shiftName: shift.name,
      timezone: shift.timezone || 'America/Santiago',
      assignedUsers: Array.isArray(shift.assignedUserIds)
        ? shift.assignedUserIds.map((user) => ({ id: String(user._id), fullName: user.fullName }))
        : []
    } : null
  };

  res.json(payload);
});

router.post('/log-entry', requireScope('WRITE_ENTRIES'), requireAllowedCollection('entries'), async (req, res) => {
  const body = req.body || {};
  const entry = await Entry.create({
    content: String(body.content || '').trim(),
    entryType: body.entryType || 'operativa',
    entryDate: body.entryDate ? new Date(body.entryDate) : new Date(),
    entryTime: String(body.entryTime || new Date().toISOString().slice(11, 16)),
    tags: Array.isArray(body.tags) ? body.tags : [],
    ownerComplementId: req.complement.slug,
    createdByUsername: `complement:${req.complement.slug}`,
    clientId: body.clientId || null,
    clientName: body.clientName || null,
    ipAddress: req.clientIp || req.ip,
    userAgent: req.get('user-agent')
  });

  await audit(req, {
    event: 'complement.api.log_entry',
    level: 'info',
    source: 'complement',
    sourceId: req.complement.slug,
    result: { success: true },
    metadata: {
      slug: req.complement.slug,
      entryId: entry._id,
      ownerComplementId: req.complement.slug
    },
    actor: {
      username: `complement:${req.complement.slug}`,
      role: 'complement'
    }
  });

  res.status(201).json(entry);
});

router.get('/query-general', requireScope('READ_LOGS'), async (req, res) => {
  const collection = String(req.query.collection || '').trim();
  const allowedCollections = new Set(req.complementToken.allowedCollections || []);
  if (!collection || !allowedCollections.has(collection)) {
    return res.status(400).json({ message: 'collection no autorizada o no especificada' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  let items = [];

  if (collection === 'entries') {
    items = await Entry.find().sort({ createdAt: -1 }).limit(limit).lean();
  } else if (collection === 'auditlogs') {
    items = await AuditLog.find().sort({ timestamp: -1 }).limit(limit).lean();
  } else if (collection === 'shared_storage') {
    items = await ComplementSharedRecord.find({ ownerComplementId: req.complement.slug }).sort({ updatedAt: -1 }).limit(limit).lean();
  }

  res.json({ collection, items });
});

router.post('/storage', requireScope('WRITE_STORAGE'), requireAllowedCollection('shared_storage'), async (req, res) => {
  const record = await ComplementSharedRecord.findOneAndUpdate({
    ownerComplementId: req.complement.slug,
    key: String(req.body?.key || '').trim()
  }, {
    ownerComplementId: req.complement.slug,
    key: String(req.body?.key || '').trim(),
    value: req.body?.value,
    metadata: req.body?.metadata || {}
  }, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });

  res.status(201).json(record);
});

router.get('/storage', requireScope('READ_STORAGE'), requireAllowedCollection('shared_storage'), async (req, res) => {
  const key = String(req.query.key || '').trim();
  const filter = { ownerComplementId: req.complement.slug };
  if (key) {
    filter.key = key;
  }
  const items = await ComplementSharedRecord.find(filter).sort({ updatedAt: -1 }).lean();
  res.json({ items });
});

router.post('/log', requireScope('WRITE_LOGS'), async (req, res) => {
  const eventName = String(req.body?.event || 'event').trim().replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
  await audit(req, {
    event: `complement.${req.complement.slug}.${eventName}`,
    level: req.body?.level || 'info',
    source: 'complement',
    sourceId: req.complement.slug,
    result: { success: true, reason: req.body?.message },
    metadata: {
      slug: req.complement.slug,
      message: req.body?.message,
      metadata: req.body?.metadata || {}
    },
    actor: {
      username: `complement:${req.complement.slug}`,
      role: 'complement'
    }
  });

  res.status(202).json({ message: 'Log recibido' });
});

module.exports = router;