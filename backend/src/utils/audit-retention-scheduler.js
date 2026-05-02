/**
 * File Purpose: backend/src/utils/audit-retention-scheduler.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const AuditLog = require('../models/AuditLog');
const { logger } = require('./logger');
const { auditSystem } = require('./audit');

const DEFAULT_MAX_MONTHS = 13;
const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 horas

let retentionTimer = null;
let running = false;

const parseIntEnv = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const buildCutoffDate = (maxMonths) => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - maxMonths);
  return cutoff;
};

async function runAuditRetentionCleanup() {
  if (running) return;
  running = true;

  const maxMonths = parseIntEnv(process.env.AUDIT_RETENTION_MAX_MONTHS, DEFAULT_MAX_MONTHS, 1, 120);
  const cutoffDate = buildCutoffDate(maxMonths);
  const startedAt = new Date();

  try {
    const deletedResult = await AuditLog.deleteMany({ timestamp: { $lt: cutoffDate } });
    const deletedCount = Number(deletedResult?.deletedCount || 0);
    const elapsedMs = Date.now() - startedAt.getTime();

    logger.info({
      event: 'audit.retention.cleanup.completed',
      deletedCount,
      maxMonths,
      cutoffDate: cutoffDate.toISOString(),
      elapsedMs
    }, 'Audit retention cleanup completed');

    await auditSystem({
      event: 'audit.retention.cleanup.completed',
      level: 'info',
      result: { success: true, reason: 'Audit retention cleanup executed' },
      metadata: {
        deletedCount,
        maxMonths,
        cutoffDate: cutoffDate.toISOString(),
        elapsedMs
      }
    });
  } catch (error) {
    logger.error({
      err: error,
      event: 'audit.retention.cleanup.failed',
      maxMonths,
      cutoffDate: cutoffDate.toISOString()
    }, 'Audit retention cleanup failed');

    await auditSystem({
      event: 'audit.retention.cleanup.failed',
      level: 'error',
      result: { success: false, reason: error.message || 'cleanup failed' },
      metadata: {
        maxMonths,
        cutoffDate: cutoffDate.toISOString()
      }
    });
  } finally {
    running = false;
  }
}

function startAuditRetentionScheduler() {
  if (retentionTimer) return;

  const intervalMs = parseIntEnv(process.env.AUDIT_RETENTION_INTERVAL_MS, DEFAULT_INTERVAL_MS, 60000, 24 * 60 * 60 * 1000);
  retentionTimer = setInterval(() => {
    runAuditRetentionCleanup().catch(() => {});
  }, intervalMs);

  logger.info({
    event: 'audit.retention.scheduler.started',
    intervalMs
  }, 'Audit retention scheduler started');

  runAuditRetentionCleanup().catch(() => {});
}

function stopAuditRetentionScheduler() {
  if (!retentionTimer) return;
  clearInterval(retentionTimer);
  retentionTimer = null;
  logger.info({ event: 'audit.retention.scheduler.stopped' }, 'Audit retention scheduler stopped');
}

module.exports = {
  startAuditRetentionScheduler,
  stopAuditRetentionScheduler,
  runAuditRetentionCleanup
};
