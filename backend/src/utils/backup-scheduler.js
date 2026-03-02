const path = require('path');
const fs = require('fs').promises;
const { logger } = require('./logger');

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

const cleanupOldLocalBackups = async (retentionDays = 30) => {
  const retentionMs = Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const files = await fs.readdir(backupsDir);
  const backupFiles = files.filter((name) => /^backup-.*\.json$/.test(name));

  await Promise.all(
    backupFiles.map(async (name) => {
      const fullPath = path.join(backupsDir, name);
      const stats = await fs.stat(fullPath);
      if (now - stats.mtimeMs > retentionMs) {
        await fs.unlink(fullPath);
      }
    })
  );
};

const runBackup = async () => {
  try {
    await ensureBackupDir();

    const backupData = {
      metadata: {
        createdAt: new Date().toISOString(),
        source: 'scheduler'
      }
    };

    for (const [key, model] of Object.entries(backupModels)) {
      backupData[key] = await model.find().lean();
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${timestamp}.json`;
    const filePath = path.join(backupsDir, fileName);

    await fs.writeFile(filePath, JSON.stringify(backupData, null, 2), 'utf8');

    const appConfig = await AppConfig.findOne();
    await pushBackupToExternalDestination({
      filePath,
      fileName,
      backupConfig: appConfig?.backupConfig
    });

    const retentionDays = appConfig?.backupConfig?.localRetentionDays || 30;
    await cleanupOldLocalBackups(retentionDays);

    logger.info({ event: 'backup.scheduler.run.success', fileName }, 'Automatic backup generated');

    return { fileName, filePath };
  } catch (error) {
    logger.error({ err: error, event: 'backup.scheduler.run.error' }, 'Automatic backup failed');
    throw error;
  }
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

    const intervalDays = Math.max(1, Number(appConfig?.backupConfig?.intervalDays) || 7);
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;

    schedulerHandle = setInterval(() => {
      runBackup().catch((error) => {
        logger.error({ err: error, event: 'backup.scheduler.interval.error' }, 'Backup scheduler iteration failed');
      });
    }, intervalMs);

    logger.info(
      { event: 'backup.scheduler.start', intervalDays },
      'Backup scheduler started'
    );
  } catch (error) {
    logger.error({ err: error, event: 'backup.scheduler.start.error' }, 'Unable to start backup scheduler');
  }
};

module.exports = {
  startBackupScheduler,
  stopBackupScheduler,
  runBackup
};
