/**
 * File Purpose: backend/src/utils/backup-scheduler.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const { logger } = require('./logger');
const { auditSystem } = require('./audit');
const { backupModels, BACKUP_EXPORT_VERSION } = require('./backup-manifest');
const { writeBackupJsonFile } = require('./backup-json-writer');

const AppConfig = require('../models/AppConfig');

const backupsDir = path.join(__dirname, '../../backups');
const uploadsDir = path.join(__dirname, '../../uploads');
const globalDir = path.join(__dirname, '../../global');
const secretsDir = path.join(__dirname, '../../secrets');
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

const cleanupOldLocalBackups = async (retentionDays = 30, retentionCount = 10) => {
  const retentionMs = Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
  const maxCount = Math.max(1, Number(retentionCount) || 10);
  const now = Date.now();
  const deletedFiles = [];
  const skippedFiles = [];

  const files = await fs.readdir(backupsDir);
  const backupFiles = files.filter((name) => /^backup-.*\.(json|zip)$/.test(name));

  await auditAutoBackupEvent('BACKUP_RETENTION_CLEANUP_STARTED', {
    success: true,
    reason: 'Inicio de limpieza de backups por retención (tiempo y cantidad)',
    metadata: {
      retentionDays: Math.max(1, Number(retentionDays) || 30),
      retentionCount: maxCount,
      scannedFiles: backupFiles.length
    }
  });

  // 1. Mapear archivos con su tiempo de referencia para poder ordenarlos
  const backupFilesWithTime = [];
  for (const name of backupFiles) {
    const fullPath = path.join(backupsDir, name);
    try {
      const stats = await fs.stat(fullPath);
      const referenceTime = resolveBackupReferenceTime(name, stats);
      backupFilesWithTime.push({ name, fullPath, referenceTime, stats });
    } catch (err) {
      logger.error({ err, fileName: name }, 'Error al leer estadísticas del backup para limpieza');
    }
  }

  // Ordenar de más nuevo a más antiguo (referenceTime descendente)
  backupFilesWithTime.sort((a, b) => b.referenceTime - a.referenceTime);

  // 2. Evaluar cada archivo para eliminación por antigüedad o por exceder el límite de cantidad
  let activeCount = 0;
  for (const file of backupFilesWithTime) {
    const ageMs = Math.max(0, now - file.referenceTime);
    let shouldDelete = false;
    let deleteReason = '';

    // Criterio 1: Expiración por tiempo
    if (ageMs > retentionMs) {
      shouldDelete = true;
      deleteReason = `Excede el tiempo de retención de ${retentionDays} días`;
    } else {
      // Criterio 2: Límite por cantidad (conservar solo los primeros 'maxCount' más nuevos)
      activeCount++;
      if (activeCount > maxCount) {
        shouldDelete = true;
        deleteReason = `Supera el límite de cantidad máxima de ${maxCount} respaldos`;
      }
    }

    if (shouldDelete) {
      try {
        await fs.unlink(file.fullPath);
        deletedFiles.push({ name: file.name, reason: deleteReason, ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)) });

        await auditAutoBackupEvent('BACKUP_RETENTION_FILE_DELETED', {
          success: true,
          reason: 'Backup eliminado por política de retención',
          metadata: {
            fileName: file.name,
            deleteReason,
            ageMs,
            retentionMs,
            referenceTime: new Date(file.referenceTime).toISOString()
          }
        });
      } catch (err) {
        logger.error({ err, fileName: file.name }, 'No se pudo eliminar el backup viejo');
      }
    } else {
      skippedFiles.push({ name: file.name, ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)) });
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
  let tempJsonPath = null;

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

    const backupMetadata = {
      createdAt: new Date().toISOString(),
      source,
      version: BACKUP_EXPORT_VERSION,
      collections: Object.keys(backupModels).length,
      type: 'json-auto'
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${timestamp}.zip`;
    const filePath = path.join(backupsDir, fileName);
    tempJsonPath = path.join(backupsDir, `_tmp_auto_backup_${Date.now()}.json`);

    const totalDocuments = await writeBackupJsonFile({
      filePath: tempJsonPath,
      metadata: backupMetadata,
      models: backupModels
    });

    const readableSecrets = [];
    if (fsSync.existsSync(secretsDir)) {
      try {
        const secretFiles = await fs.readdir(secretsDir);
        for (const secretFile of secretFiles) {
          const secretPath = path.join(secretsDir, secretFile);
          try {
            await fs.access(secretPath, fsSync.constants.R_OK);
            readableSecrets.push({ name: secretFile, path: secretPath });
          } catch {
            logger.warn({ path: secretPath }, 'Secret file unreadable, skipped from automatic backup');
          }
        }
      } catch (error) {
        logger.warn({ err: error }, 'Unable to read secrets directory for automatic backup');
      }
    }

    await new Promise((resolve, reject) => {
      const output = fsSync.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      archive.file(tempJsonPath, { name: 'data.json' });

      if (fsSync.existsSync(uploadsDir)) {
        archive.directory(uploadsDir, 'uploads');
      }

      if (fsSync.existsSync(globalDir)) {
        archive.directory(globalDir, 'global');
      }

      for (const secret of readableSecrets) {
        archive.file(secret.path, { name: `secrets/${secret.name}` });
      }

      archive.finalize();
    });

    await fs.unlink(tempJsonPath).catch(() => {});

    appConfig = await AppConfig.findOne();
    await pushBackupToExternalDestination({
      filePath,
      fileName,
      backupConfig: appConfig?.backupConfig
    });

    const retentionDays = appConfig?.backupConfig?.localRetentionDays || 30;
    const retentionCount = appConfig?.backupConfig?.localRetentionCount || 10;
    const cleanupResult = await cleanupOldLocalBackups(retentionDays, retentionCount);

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
          intervalDays,
          documents: totalDocuments
        }
      });
    }

    logger.info({ event: 'backup.scheduler.run.success', fileName, totalDocuments }, 'Automatic backup generated');

    await auditBackupRunEvent('admin.backup.run.completed', {
      success: true,
      level: 'info',
      reason: 'Backup generado exitosamente',
      source,
      triggerContext,
      metadata: {
        fileName,
        documents: totalDocuments,
        retentionDays,
        retentionCleanup: cleanupResult,
        durationMs: Date.now() - startedAt.getTime()
      }
    });

    return { success: true, fileName, filePath };
  } catch (error) {
    if (tempJsonPath) {
      await fs.unlink(tempJsonPath).catch(() => {});
    }
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
