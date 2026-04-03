const path = require('path');
const fs = require('fs').promises;
const { logger } = require('./logger');
const { auditSystem } = require('./audit');

const AppConfig = require('../models/AppConfig');
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const User = require('../models/User');
const AdminNote = require('../models/AdminNote');
const AuditLog = require('../models/AuditLog');
const CatalogEvent = require('../models/CatalogEvent');
const CatalogLogSource = require('../models/CatalogLogSource');
const CatalogOperationType = require('../models/CatalogOperationType');
const ChecklistTemplate = require('../models/ChecklistTemplate');
const Client = require('../models/Client');
const Contact = require('../models/Contact');
const ClientEscalationRule = require('../models/ClientEscalationRule');
const EscalationRule = require('../models/EscalationRule');
const ExternalPerson = require('../models/ExternalPerson');
const LogForwardingConfig = require('../models/LogForwardingConfig');
const PersonalNote = require('../models/PersonalNote');
const Service = require('../models/Service');
const ServiceCatalog = require('../models/ServiceCatalog');
const ShiftAssignment = require('../models/ShiftAssignment');
const ShiftOverride = require('../models/ShiftOverride');
const ShiftRole = require('../models/ShiftRole');
const ShiftRotationCycle = require('../models/ShiftRotationCycle');
const SmtpConfig = require('../models/SmtpConfig');

const backupModels = {
  entries: Entry,
  checks: ShiftCheck,
  users: User,
  adminNotes: AdminNote,
  appConfigs: AppConfig,
  auditLogs: AuditLog,
  catalogEvents: CatalogEvent,
  catalogLogSources: CatalogLogSource,
  catalogOperationTypes: CatalogOperationType,
  checklistTemplates: ChecklistTemplate,
  clients: Client,
  contacts: Contact,
  clientEscalationRules: ClientEscalationRule,
  escalationRules: EscalationRule,
  externalPersons: ExternalPerson,
  logForwardingConfigs: LogForwardingConfig,
  personalNotes: PersonalNote,
  services: Service,
  serviceCatalogs: ServiceCatalog,
  shiftAssignments: ShiftAssignment,
  shiftOverrides: ShiftOverride,
  shiftRoles: ShiftRole,
  shiftRotationCycles: ShiftRotationCycle,
  smtpConfigs: SmtpConfig
};

const backupsDir = path.join(__dirname, '../../backups');
let schedulerHandle = null;
let backupRunInProgress = false;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const AUTO_RETRY_MS = 60 * 60 * 1000;

const getNormalizedIntervalDays = (backupConfig = {}) => Math.max(1, Number(backupConfig.intervalDays) || 7);

const addIntervalDays = (date, intervalDays) => {
  const baseDate = date instanceof Date ? date : new Date(date);
  return new Date(baseDate.getTime() + (getNormalizedIntervalDays({ intervalDays }) * 24 * 60 * 60 * 1000));
};

const ensureBackupConfigState = (config) => {
  if (!config.backupConfig) {
    config.backupConfig = {};
  }

  return config.backupConfig;
};

const saveBackupConfigState = async (config) => {
  config.markModified('backupConfig');
  await config.save({ validateModifiedOnly: true });
};

const needsSchedulePersistence = (backupConfig = {}) => {
  if (!backupConfig.enabled) {
    return false;
  }

  return !backupConfig.scheduleAnchorAt
    || !backupConfig.nextAutoRunAt
    || !backupConfig.lastAutoRunStatus
    || !backupConfig.lastAutoRunMessage;
};

const auditAutoBackupEvent = async (event, { success, reason, level, metadata = {} }) => {
  await auditSystem({
    event,
    level: level || (success ? 'info' : 'warn'),
    result: { success, reason },
    metadata
  });
};

const auditBackupRunEvent = async (event, { success, reason, level, source, triggerContext, metadata = {} }) => {
  try {
    await auditSystem({
      event,
      level: level || (success ? 'info' : 'warn'),
      result: { success, reason },
      metadata: {
        source,
        triggerContext: triggerContext || 'backup-scheduler',
        ...metadata
      }
    });
  } catch (error) {
    logger.warn({ err: error, event }, 'Unable to persist backup run audit event');
  }
};

const prepareBackupSchedule = (config, options = {}) => {
  const backupConfig = ensureBackupConfigState(config);
  const now = options.now instanceof Date ? options.now : new Date();
  const resetSchedule = options.resetSchedule === true;

  if (!backupConfig.enabled) {
    backupConfig.nextAutoRunAt = null;
    backupConfig.lastAutoRunStatus = 'idle';
    if (!backupConfig.lastAutoRunMessage) {
      backupConfig.lastAutoRunMessage = 'Backups automáticos deshabilitados';
    }
    return backupConfig;
  }

  const intervalDays = getNormalizedIntervalDays(backupConfig);

  if (resetSchedule || !backupConfig.scheduleAnchorAt) {
    backupConfig.scheduleAnchorAt = now;
  }

  if (backupConfig.lastAutoRunAt) {
    backupConfig.nextAutoRunAt = addIntervalDays(backupConfig.lastAutoRunAt, intervalDays);
  } else if (resetSchedule || !backupConfig.nextAutoRunAt) {
    backupConfig.nextAutoRunAt = addIntervalDays(backupConfig.scheduleAnchorAt, intervalDays);
  }

  if (resetSchedule || !backupConfig.lastAutoRunStatus || backupConfig.lastAutoRunStatus === 'idle') {
    backupConfig.lastAutoRunStatus = 'scheduled';
  }

  if (resetSchedule || !backupConfig.lastAutoRunMessage) {
    backupConfig.lastAutoRunMessage = 'Scheduler automático programado';
  }

  return backupConfig;
};

const pushBackupToExternalDestination = async ({ filePath, fileName, backupConfig }) => {
  const destinationType = backupConfig?.destinationType || 'local';
  if (destinationType === 'local') {
    return;
  }

  if (destinationType === 's3') {
    logger.warn({ event: 'backup.scheduler.destination.s3.pending' }, 'S3 destination is not implemented yet');
    return;
  }

  if (destinationType !== 'smb' && destinationType !== 'nfs') {
    logger.warn({ event: 'backup.scheduler.destination.unsupported', destinationType }, 'Unsupported backup destination type');
    return;
  }

  const basePath = String(backupConfig?.destinationConfig?.basePath || '').trim();
  if (!basePath) {
    logger.warn({ event: 'backup.scheduler.destination.missing.path', destinationType }, 'External backup destination path not configured');
    return;
  }

  const destinationDir = path.resolve(basePath);
  const destinationFilePath = path.join(destinationDir, fileName);
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.copyFile(filePath, destinationFilePath);

  logger.info(
    { event: 'backup.scheduler.destination.copy.success', destinationType, destinationFilePath },
    'Backup copied to external destination'
  );
};

const ensureBackupDir = async () => {
  await fs.mkdir(backupsDir, { recursive: true });
};

const resolveBackupReferenceTime = (fileName, stats) => {
  const mtime = Number(stats?.mtimeMs || 0);
  if (mtime > 0) {
    return mtime;
  }

  const match = String(fileName || '').match(/^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (match) {
    const [, datePart, hh, mm, ss] = match;
    const parsed = Date.parse(`${datePart}T${hh}:${mm}:${ss}Z`);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const birth = Number(stats?.birthtimeMs || 0);
  return birth > 0 ? birth : Date.now();
};

const cleanupOldLocalBackups = async (retentionDays = 30) => {
  const retentionMs = Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const deletedFiles = [];
  const skippedFiles = [];

  const files = await fs.readdir(backupsDir);
  const backupFiles = files.filter((name) => /^backup-.*\.(json|zip)$/.test(name));

  await auditAutoBackupEvent('BACKUP_RETENTION_CLEANUP_STARTED', {
    success: true,
    reason: 'Inicio de limpieza de backups por retención',
    metadata: {
      retentionDays: Math.max(1, Number(retentionDays) || 30),
      scannedFiles: backupFiles.length
    }
  });

  for (const name of backupFiles) {
    const fullPath = path.join(backupsDir, name);
    const stats = await fs.stat(fullPath);
    const referenceTime = resolveBackupReferenceTime(name, stats);
    const ageMs = Math.max(0, now - referenceTime);

    if (ageMs > retentionMs) {
      await fs.unlink(fullPath);
      deletedFiles.push({ name, ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)) });

      await auditAutoBackupEvent('BACKUP_RETENTION_FILE_DELETED', {
        success: true,
        reason: 'Backup eliminado por política de retención',
        metadata: {
          fileName: name,
          ageMs,
          retentionMs,
          referenceTime: new Date(referenceTime).toISOString()
        }
      });
    } else {
      skippedFiles.push({ name, ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)) });
      await auditAutoBackupEvent('BACKUP_RETENTION_FILE_SKIPPED', {
        success: true,
        reason: 'Backup aún dentro de ventana de retención',
        metadata: {
          fileName: name,
          ageMs,
          retentionMs,
          referenceTime: new Date(referenceTime).toISOString()
        }
      });
    }
  }

  return {
    scanned: backupFiles.length,
    deleted: deletedFiles.length,
    skipped: skippedFiles.length,
    deletedFiles,
    skippedFiles
  };
};

const runBackup = async (options = {}) => {
  const source = options.source || 'manual';
  const triggerContext = options.triggerContext || 'backup-scheduler';
  const isAutomaticRun = source === 'auto';
  const startedAt = new Date();
  let appConfig = null;

  if (backupRunInProgress) {
    await auditBackupRunEvent('admin.backup.run.skipped', {
      success: false,
      level: 'warn',
      reason: 'Ya existe una ejecución de backup en progreso',
      source,
      triggerContext,
      metadata: {
        startedAt: startedAt.toISOString()
      }
    });

    if (isAutomaticRun) {
      await auditAutoBackupEvent('BACKUP_AUTO_SKIPPED', {
        success: false,
        reason: 'Ya existe una ejecución de backup en progreso',
        metadata: {
          source,
          triggerContext: options.triggerContext || 'scheduler'
        }
      });
    }

    return {
      success: false,
      skipped: true,
      message: 'Ya existe una ejecución de backup en progreso'
    };
  }

  backupRunInProgress = true;

  try {
    await auditBackupRunEvent('admin.backup.run.started', {
      success: true,
      level: 'info',
      reason: 'Inicio de ejecución de backup',
      source,
      triggerContext,
      metadata: {
        startedAt: startedAt.toISOString()
      }
    });

    await ensureBackupDir();

    const backupData = {
      metadata: {
        createdAt: new Date().toISOString(),
        source
      }
    };

    for (const [key, model] of Object.entries(backupModels)) {
      backupData[key] = await model.find().lean();
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${timestamp}.json`;
    const filePath = path.join(backupsDir, fileName);

    await fs.writeFile(filePath, JSON.stringify(backupData, null, 2), 'utf8');

    appConfig = await AppConfig.findOne();
    await pushBackupToExternalDestination({
      filePath,
      fileName,
      backupConfig: appConfig?.backupConfig
    });

    const retentionDays = appConfig?.backupConfig?.localRetentionDays || 30;
    const cleanupResult = await cleanupOldLocalBackups(retentionDays);

    if (isAutomaticRun && appConfig) {
      const backupConfig = ensureBackupConfigState(appConfig);
      const intervalDays = getNormalizedIntervalDays(backupConfig);

      backupConfig.lastAutoAttemptAt = startedAt;
      backupConfig.lastAutoRunAt = startedAt;
      backupConfig.nextAutoRunAt = addIntervalDays(startedAt, intervalDays);
      backupConfig.lastAutoRunStatus = 'success';
      backupConfig.lastAutoRunMessage = `Backup automático generado: ${fileName}`;

      await saveBackupConfigState(appConfig);
      await auditAutoBackupEvent('BACKUP_AUTO_COMPLETED', {
        success: true,
        reason: 'Backup automático generado correctamente',
        metadata: {
          fileName,
          retentionCleanup: cleanupResult,
          nextAutoRunAt: backupConfig.nextAutoRunAt,
          intervalDays
        }
      });
    }

    logger.info({ event: 'backup.scheduler.run.success', fileName }, 'Automatic backup generated');

    await auditBackupRunEvent('admin.backup.run.completed', {
      success: true,
      level: 'info',
      reason: 'Backup generado exitosamente',
      source,
      triggerContext,
      metadata: {
        fileName,
        retentionDays,
        retentionCleanup: cleanupResult,
        durationMs: Date.now() - startedAt.getTime()
      }
    });

    return { success: true, fileName, filePath };
  } catch (error) {
    if (isAutomaticRun && appConfig) {
      const backupConfig = ensureBackupConfigState(appConfig);
      backupConfig.lastAutoAttemptAt = startedAt;
      backupConfig.nextAutoRunAt = new Date(startedAt.getTime() + AUTO_RETRY_MS);
      backupConfig.lastAutoRunStatus = 'error';
      backupConfig.lastAutoRunMessage = error.message;

      await saveBackupConfigState(appConfig);
      await auditAutoBackupEvent('BACKUP_AUTO_SKIPPED', {
        success: false,
        reason: 'La ejecución automática falló; se programó un reintento',
        metadata: {
          error: error.message,
          retryAt: backupConfig.nextAutoRunAt,
          triggerContext: options.triggerContext || 'scheduler'
        }
      });
    }

    logger.error({ err: error, event: 'backup.scheduler.run.error' }, 'Automatic backup failed');

    await auditBackupRunEvent('admin.backup.run.failed', {
      success: false,
      level: 'error',
      reason: error.message,
      source,
      triggerContext,
      metadata: {
        durationMs: Date.now() - startedAt.getTime()
      }
    });

    throw error;
  } finally {
    backupRunInProgress = false;
  }
};

const evaluateBackupSchedule = async (triggerContext = 'interval-check') => {
  const appConfig = await AppConfig.findOne();
  if (!appConfig?.backupConfig?.enabled) {
    return { success: true, triggered: false, reason: 'disabled' };
  }

  const shouldPersistNormalizedState = needsSchedulePersistence(appConfig.backupConfig);
  const backupConfig = prepareBackupSchedule(appConfig, { now: new Date() });
  if (shouldPersistNormalizedState) {
    await saveBackupConfigState(appConfig);
  }

  const nextAutoRunAt = backupConfig.nextAutoRunAt ? new Date(backupConfig.nextAutoRunAt) : null;
  if (!nextAutoRunAt || nextAutoRunAt > new Date()) {
    return {
      success: true,
      triggered: false,
      reason: 'not-due',
      nextAutoRunAt: backupConfig.nextAutoRunAt
    };
  }

  await auditAutoBackupEvent('BACKUP_AUTO_TRIGGERED', {
    success: true,
    reason: 'Se alcanzó el intervalo configurado',
    metadata: {
      triggerContext,
      lastAutoRunAt: backupConfig.lastAutoRunAt,
      nextAutoRunAt: backupConfig.nextAutoRunAt,
      intervalDays: getNormalizedIntervalDays(backupConfig)
    }
  });

  return runBackup({ source: 'auto', triggerContext });
};

const stopBackupScheduler = () => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    logger.info({ event: 'backup.scheduler.stop' }, 'Backup scheduler stopped');
  }
};

const startBackupScheduler = async () => {
  try {
    stopBackupScheduler();

    const appConfig = await AppConfig.findOne();
    const enabled = appConfig?.backupConfig?.enabled;
    if (!enabled) {
      logger.info({ event: 'backup.scheduler.disabled' }, 'Backup scheduler disabled in config');
      return;
    }

    const shouldPersistNormalizedState = needsSchedulePersistence(appConfig.backupConfig);
    const backupConfig = prepareBackupSchedule(appConfig, { now: new Date() });
    if (shouldPersistNormalizedState) {
      await saveBackupConfigState(appConfig);
    }
    const intervalDays = getNormalizedIntervalDays(backupConfig);

    await auditAutoBackupEvent('BACKUP_AUTO_SCHEDULED', {
      success: true,
      reason: 'Scheduler de backups automáticos inicializado',
      metadata: {
        intervalDays,
        nextAutoRunAt: backupConfig.nextAutoRunAt,
        lastAutoRunAt: backupConfig.lastAutoRunAt
      }
    });

    schedulerHandle = setInterval(() => {
      evaluateBackupSchedule('interval-check').catch((error) => {
        logger.error({ err: error, event: 'backup.scheduler.interval.error' }, 'Backup scheduler iteration failed');
      });
    }, CHECK_INTERVAL_MS);

    logger.info(
      { event: 'backup.scheduler.start', intervalDays, nextAutoRunAt: backupConfig.nextAutoRunAt, checkIntervalMs: CHECK_INTERVAL_MS },
      'Backup scheduler started'
    );

    await evaluateBackupSchedule('startup');
  } catch (error) {
    logger.error({ err: error, event: 'backup.scheduler.start.error' }, 'Unable to start backup scheduler');
  }
};

module.exports = {
  prepareBackupSchedule,
  startBackupScheduler,
  stopBackupScheduler,
  runBackup
};
