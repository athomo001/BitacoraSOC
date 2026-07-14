/**
 * File Purpose: backend/src/routes/backup.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de Backup/Restore MongoDB
 * 
 * Endpoints:
 *   GET  /api/backup/history         - Historial de backups (admin)
 *   POST /api/backup/create          - Crear backup ZIP (admin)
 *   POST /api/backup/restore         - Restaurar backup ZIP o JSON (admin)
 *   GET  /api/backup/export/:type    - Exportar CSV (entries/checks/all)
 *   POST /api/backup/import          - Importar backup ZIP o JSON (admin, upload)
 *   DELETE /api/backup/:id           - Eliminar backup (admin)
 * 
 * Reglas SOC:
 *   - Solo admins pueden ejecutar backups
 *   - Path sanitization obligatoria
 *   - Auditoría de todas las operaciones
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { authenticate, authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const User = require('../models/User');
const AdminNote = require('../models/AdminNote');
const AppConfig = require('../models/AppConfig');
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
const multer = require('multer');
const { backupModels, BACKUP_EXPORT_VERSION } = require('../utils/backup-manifest');
const { parseBooleanFlag } = require('../utils/boolean-helper');

const PURGE_CONFIRM_PHRASE = 'PURGAR TODO';

// Directorios de volúmenes físicos del backend
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const GLOBAL_DIR = path.join(__dirname, '../../global');
const SECRETS_DIR = path.join(__dirname, '../../secrets');
const BACKUPS_DIR = path.join(__dirname, '../../backups');

// Configurar multer para importación — acepta ZIP y JSON hasta 200MB
const upload = multer({
  dest: path.join(BACKUPS_DIR, 'temp'),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

// Importar el scheduler de backups para reiniciar si cambia la config
const { prepareBackupSchedule, startBackupScheduler, stopBackupScheduler, runBackup } = require('../utils/backup-scheduler');

// Helper de validación de filename para evitar Path Traversal
const isValidBackupFilename = (filename) => {
  return typeof filename === 'string' && /^backup-[a-zA-Z0-9.\-_]+\.(json|zip)$/.test(filename);
};

const crypto = require('crypto');

/**
 * Cifra un texto usando una passphrase
 * @param {string} text - Contenido a cifrar
 * @param {string} passphrase - Frase secreta de cifrado
 * @returns {string} JSON stringificado con la metadata de cifrado
 */
function encryptWithPassphrase(text, passphrase) {
  const salt = crypto.randomBytes(16);
  // Derivar clave de 32 bytes usando PBKDF2
  const key = crypto.pbkdf2Sync(passphrase, salt, 10000, 32, 'sha256');
  const iv = crypto.randomBytes(12); // GCM recomienda 12 bytes
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return JSON.stringify({
    encrypted: true,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted
  });
}

/**
 * Descifra un objeto JSON stringificado cifrado
 * @param {string} encryptedJsonStr - Objeto cifrado stringificado
 * @param {string} passphrase - Frase secreta para descifrar
 * @returns {string} Texto descifrado
 */
function decryptWithPassphrase(encryptedJsonStr, passphrase) {
  try {
    const parsed = JSON.parse(encryptedJsonStr);
    if (!parsed.encrypted || !parsed.salt || !parsed.iv || !parsed.authTag || !parsed.ciphertext) {
      throw new Error('Formato cifrado inválido');
    }
    const salt = Buffer.from(parsed.salt, 'hex');
    const iv = Buffer.from(parsed.iv, 'hex');
    const authTag = Buffer.from(parsed.authTag, 'hex');
    const key = crypto.pbkdf2Sync(passphrase, salt, 10000, 32, 'sha256');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(parsed.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    throw new Error('Frase secreta incorrecta o datos dañados: ' + err.message);
  }
}

/**
 * Extrae un archivo ZIP de manera segura previniendo la vulnerabilidad de Zip Slip.
 * Valida que ninguna de las rutas extraídas escape del directorio base.
 * @param {string} zipFilePath - Ruta del archivo zip a extraer.
 * @param {string} extractDir - Directorio base donde se realizará la extracción.
 */
async function safeExtractZip(zipFilePath, extractDir) {
  const directory = await unzipper.Open.file(zipFilePath);
  for (const entry of directory.files) {
    const targetPath = path.resolve(extractDir, entry.path);
    const relative = path.relative(extractDir, targetPath);
    // Validar que el archivo no escape del directorio base (Zip Slip check)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Intento de Zip Slip detectado para la ruta: ${entry.path}`);
    }

    if (entry.type === 'Directory') {
      await fs.mkdir(targetPath, { recursive: true });
    } else {
      // Crear directorios padres de forma recursiva antes de escribir el archivo
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await new Promise((resolve, reject) => {
        entry.stream()
          .pipe(fsSync.createWriteStream(targetPath))
          .on('finish', resolve)
          .on('error', reject);
      });
    }
  }
}

// Helper: convertir array de objetos a CSV
const arrayToCSV = (data) => {
  if (!data || data.length === 0) return '';

  // Flatten nested objects
  const flattenObject = (obj, prefix = '') => {
    let result = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        Object.assign(result, flattenObject(value, newKey));
      } else if (Array.isArray(value)) {
        result[newKey] = value.join('; ');
      } else {
        result[newKey] = value;
      }
    }
    return result;
  };

  const flatData = data.map(item => flattenObject(item));
  if (flatData.length === 0) return '';

  const headers = Object.keys(flatData[0]);
  const rows = flatData.map(row =>
    headers.map(header => {
      const value = row[header];
      const stringValue = value === null || value === undefined ? '' : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
};

// -----------------------------------------------------
// Rutas de Configuración de Backups Automáticos (B21)
// -----------------------------------------------------

/**
 * @route GET /api/backup/config
 * @desc Obtener configuración de backups automáticos
 * @access Admin
 */
router.get('/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    let config = await AppConfig.findOne();
    if (!config) {
      config = await AppConfig.create({});
    }
    const backupConfig = config.backupConfig || { enabled: false, intervalDays: 7, destinationType: 'local', localRetentionDays: 30 };
    res.json({
      ...backupConfig,
      destinationConfig: {
        ...(backupConfig.destinationConfig || {}),
        basePath: backupConfig.destinationConfig?.basePath || ''
      },
      scheduleAnchorAt: backupConfig.scheduleAnchorAt || null,
      lastAutoAttemptAt: backupConfig.lastAutoAttemptAt || null,
      lastAutoRunAt: backupConfig.lastAutoRunAt || null,
      nextAutoRunAt: backupConfig.nextAutoRunAt || null,
      lastAutoRunStatus: backupConfig.lastAutoRunStatus || 'idle',
      lastAutoRunMessage: backupConfig.lastAutoRunMessage || ''
    });
  } catch (err) {
    logger.error(`Error get backup config: ${err.message}`);
    res.status(500).json({ message: 'Error al obtener configuración de backups automáticos' });
  }
});

/**
 * @route PUT /api/backup/config
 * @desc Actualizar configuración de backups automáticos
 * @access Admin
 */
router.put('/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { enabled, intervalDays, destinationType, localRetentionDays, destinationConfig } = req.body;

    const parsedIntervalDays = Number(intervalDays);
    const parsedRetentionDays = Number(localRetentionDays);
    const normalizedDestinationType = destinationType || 'local';
    const allowedDestinationTypes = ['local', 's3', 'smb', 'nfs'];

    if (!allowedDestinationTypes.includes(normalizedDestinationType)) {
      return res.status(400).json({ message: 'destinationType inválido' });
    }

    if (!Number.isFinite(parsedIntervalDays) || parsedIntervalDays < 1 || parsedIntervalDays > 365) {
      return res.status(400).json({ message: 'intervalDays debe estar entre 1 y 365' });
    }

    if (!Number.isFinite(parsedRetentionDays) || parsedRetentionDays < 1 || parsedRetentionDays > 365) {
      return res.status(400).json({ message: 'localRetentionDays debe estar entre 1 y 365' });
    }

    const normalizedDestinationConfig = {
      ...(destinationConfig || {}),
      basePath: String(destinationConfig?.basePath || '').trim()
    };

    if ((normalizedDestinationType === 'smb' || normalizedDestinationType === 'nfs') && !normalizedDestinationConfig.basePath) {
      return res.status(400).json({ message: 'Debes indicar destinationConfig.basePath para destino SMB/NFS' });
    }

    let config = await AppConfig.findOne();
    if (!config) {
      config = await AppConfig.create({});
    }

    const previousBackupConfig = config.backupConfig || {};

    config.backupConfig = {
      enabled: enabled !== undefined ? !!enabled : config.backupConfig?.enabled,
      intervalDays: parsedIntervalDays,
      destinationType: normalizedDestinationType,
      localRetentionDays: parsedRetentionDays,
      destinationConfig: normalizedDestinationConfig,
      scheduleAnchorAt: previousBackupConfig.scheduleAnchorAt || null,
      lastAutoAttemptAt: previousBackupConfig.lastAutoAttemptAt || null,
      lastAutoRunAt: previousBackupConfig.lastAutoRunAt || null,
      nextAutoRunAt: previousBackupConfig.nextAutoRunAt || null,
      lastAutoRunStatus: previousBackupConfig.lastAutoRunStatus || 'idle',
      lastAutoRunMessage: previousBackupConfig.lastAutoRunMessage || ''
    };

    const scheduleWasEnabled = Boolean(previousBackupConfig.enabled);
    const intervalChanged = Number(previousBackupConfig.intervalDays || 7) !== parsedIntervalDays;
    const scheduleNeedsReset = Boolean(config.backupConfig.enabled) && (!scheduleWasEnabled || intervalChanged || !previousBackupConfig.nextAutoRunAt);

    prepareBackupSchedule(config, {
      now: new Date(),
      resetSchedule: scheduleNeedsReset
    });

    if (!config.backupConfig.enabled) {
      config.backupConfig.lastAutoRunStatus = 'idle';
      config.backupConfig.lastAutoRunMessage = 'Backups automáticos deshabilitados';
    }

    config.lastUpdatedBy = req.user.id;
    await config.save();

    // Si se habilita o cambia, reiniciamos el scheduler
    stopBackupScheduler();
    if (config.backupConfig.enabled) {
      await startBackupScheduler();
    }

    await audit(req, {
      event: 'admin.backup.config.update',
      level: 'info',
      result: { success: true },
      metadata: {
        enabled: config.backupConfig.enabled,
        intervalDays: config.backupConfig.intervalDays,
        destinationType: config.backupConfig.destinationType,
        localRetentionDays: config.backupConfig.localRetentionDays
      }
    });

    res.json({ message: 'Configuración actualizada', backupConfig: config.backupConfig });
  } catch (err) {
    logger.error(`Error update backup config: ${err.message}`);
    res.status(500).json({ message: 'Error al actualizar configuración de backups automáticos' });
  }
});

/**
 * @route POST /api/backup/test-auto
 * @desc Probar ejecución manual del scheduler de backups
 * @access Admin
 */
router.post('/test-auto', authenticate, authorize('admin'), async (req, res) => {
  try {
    // Forzamos la ejecución para debugging o pruebas
    runBackup({ source: 'manual', triggerContext: 'api/backup/test-auto' }).catch(e => logger.error(`Manual runBackup error: ${e.message}`));

    await audit(req, {
      event: 'admin.backup.auto.trigger_manual',
      level: 'info',
      result: { success: true },
      metadata: {
        triggeredFrom: 'api/backup/test-auto'
      }
    });

    res.json({ message: 'Proceso de backup automático iniciado en background pormodo manual' });
  } catch (err) {
    logger.error(`Error test auto backup: ${err.message}`);
    res.status(500).json({ message: 'Error al iniciar proceso de backup' });
  }
});

// -----------------------------------------------------

// GET /api/backup/history - Historial de backups (admin) — lista .zip y .json legacy
router.get('/history', authenticate, authorize('admin'), async (req, res) => {
  try {
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    const files = await fs.readdir(BACKUPS_DIR);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.zip') || file.endsWith('.json')) {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = await fs.stat(filePath);
        const epoch0 = new Date(0);
        const birthtime = stats.birthtime > epoch0 ? stats.birthtime : null;
        const createdAt = birthtime || (stats.mtime > epoch0 ? stats.mtime : new Date());
        backups.push({
          _id: file,
          filename: file,
          createdAt,
          size: stats.size,
          type: file.endsWith('.zip') ? 'full' : 'legacy'
        });
      }
    }

    res.json({ backups: backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (error) {
    logger.error({ err: error }, 'Error listando backups');
    res.status(500).json({ message: 'Error listando backups' });
  }
});

// POST /api/backup/create — Backup completo ZIP (MongoDB + archivos físicos)
router.post('/create', authenticate, authorize('admin'), async (req, res) => {
  const tempJson = path.join(BACKUPS_DIR, `_tmp_data_${Date.now()}.json`);
  let createdTempJson = false;
  try {
    logger.info('📦 Iniciando solicitud de creación de backup manual...');
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(GLOBAL_DIR, { recursive: true }).catch(() => {});
    await fs.mkdir(SECRETS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const filePath = path.join(BACKUPS_DIR, filename);

    logger.info('🔍 Consultando colecciones desde base de datos...');
    const backupSnapshotEntries = await Promise.all(
      Object.entries(backupModels).map(async ([key, Model]) => {
        try {
          if (!Model || typeof Model.find !== 'function') {
            throw new Error(`El modelo para ${key} no está correctamente inicializado o es inválido.`);
          }
          const docs = await Model.find().lean();
          return [key, docs];
        } catch (dbErr) {
          logger.error({ err: dbErr, collection: key }, `Error leyendo documentos para la colección ${key}`);
          throw dbErr;
        }
      })
    );
    const backupSnapshot = Object.fromEntries(backupSnapshotEntries);
    const collectionCount = Object.keys(backupModels).length;

    const backupData = {
      metadata: {
        created: new Date(),
        version: BACKUP_EXPORT_VERSION,
        type: 'full-zip',
        createdBy: req.user._id,
        collections: collectionCount
      },
      data: backupSnapshot
    };

    const { passphrase } = req.body;
    let finalJsonData = JSON.stringify(backupData, null, 2);
    let isEncrypted = false;
    
    if (passphrase && String(passphrase).trim()) {
      logger.info('🔐 Cifrando JSON de base de datos con contraseña provista...');
      finalJsonData = encryptWithPassphrase(finalJsonData, String(passphrase).trim());
      isEncrypted = true;
    }

    logger.info(`💾 Escribiendo archivo temporal de base de datos en: ${tempJson}`);
    await fs.writeFile(tempJson, finalJsonData);
    createdTempJson = true;

    // Pre-scan secrets legibles ANTES de entrar en el Promise (await no puede usarse dentro de callback sync)
    const readableSecrets = [];
    if (fsSync.existsSync(SECRETS_DIR)) {
      try {
        const secretFiles = await fs.readdir(SECRETS_DIR);
        for (const sFile of secretFiles) {
          const sPath = path.join(SECRETS_DIR, sFile);
          try {
            await fs.access(sPath, fsSync.constants.R_OK);
            readableSecrets.push({ name: sFile, path: sPath });
          } catch {
            logger.warn({ path: sPath }, 'Archivo secret no legible, omitido del backup');
          }
        }
      } catch (e) {
        logger.warn({ err: e }, 'No se pudo leer directorio secrets, omitido del backup');
      }
    }

    logger.info(`zip: Comprimiendo archivos en: ${filePath}`);
    // 2. Crear ZIP con el JSON + archivos físicos
    await new Promise((resolve, reject) => {
      const output = fsSync.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 1 } });

      output.on('close', () => {
        logger.info('💾 Archivo ZIP de backup cerrado e indexado en disco exitosamente.');
        resolve();
      });

      // Capturar fallas de escritura en disco (ej. disco lleno ENOSPC o error de permisos) para evitar crasheos globales
      output.on('error', (err) => {
        logger.error({ err }, '❌ Error crítico en stream de escritura de backup (createWriteStream)');
        reject(err);
      });

      archive.on('error', (err) => {
        logger.error({ err }, '❌ Error crítico en motor de compresión archiver');
        reject(err);
      });

      archive.pipe(output);

      // JSON de la base de datos
      archive.file(tempJson, { name: 'data.json' });

      // Archivos físicos de uploads (logos, imágenes)
      if (fsSync.existsSync(UPLOADS_DIR)) {
        logger.info(`zip: Agregando directorio de uploads: ${UPLOADS_DIR}`);
        archive.directory(UPLOADS_DIR, 'uploads');
      }

      // Directorio global opcional del servidor
      if (fsSync.existsSync(GLOBAL_DIR)) {
        logger.info(`zip: Agregando directorio global: ${GLOBAL_DIR}`);
        archive.directory(GLOBAL_DIR, 'global');
      }

      // Certificados SSL (solo los legibles pre-escaneados)
      if (readableSecrets.length > 0) {
        logger.info(`zip: Agregando ${readableSecrets.length} archivos de secrets...`);
        for (const s of readableSecrets) {
          archive.file(s.path, { name: `secrets/${s.name}` });
        }
      }

      archive.finalize();
    });

    // Limpiar JSON temporal
    if (createdTempJson) {
      await fs.unlink(tempJson).catch(() => {});
    }

    const stat = await fs.stat(filePath);
    const totalDocs = Object.values(backupData.data).reduce((sum, arr) => sum + arr.length, 0);

    await audit(req, {
      event: 'admin.backup.create',
      level: 'info',
      result: { success: true, filename },
      metadata: { encrypted: isEncrypted }
    });

    logger.info(`✅ Backup '${filename}' creado de forma exitosa (${stat.size} bytes).`);
    res.json({
      message: 'Backup completo creado exitosamente',
      filename,
      collections: collectionCount,
      documents: totalDocs,
      sizeBytes: stat.size
    });
  } catch (error) {
    if (createdTempJson) {
      await fs.unlink(tempJson).catch(() => {});
    }
    logger.error({ err: error }, 'Error creando backup ZIP');
    res.status(500).json({ message: 'Error creando backup' });
  }
});

// POST /api/backup/restore — Restauración completa desde ZIP o JSON legacy
router.post('/restore', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { filename, clearBeforeRestore } = req.body;
    const shouldClearBeforeRestore = parseBooleanFlag(clearBeforeRestore);
    let restoredUploads = false;
    let restoredGlobal = false;
    let restoredSecrets = false;
    let keyringPresentAfterRestore = false;

    if (!filename || !isValidBackupFilename(filename)) {
      return res.status(400).json({ message: 'Filename inválido o requerido' });
    }

    const filePath = path.join(BACKUPS_DIR, filename);

    try { await fs.access(filePath); }
    catch { return res.status(404).json({ message: 'Backup no encontrado' }); }

    const isZip = filename.endsWith('.zip');
    let backupJson;

    if (isZip) {
      // --- Restauración ZIP completa ---
      const extractDir = path.join(BACKUPS_DIR, `temp_extract_${Date.now()}`);
      await fs.mkdir(extractDir, { recursive: true });

      try {
        // Descomprimir el ZIP de forma segura contra Zip Slip
        await safeExtractZip(filePath, extractDir);

        // Leer el JSON de base de datos
        const dataJsonPath = path.join(extractDir, 'data.json');
        const content = await fs.readFile(dataJsonPath, 'utf8');
        
        let parsedJson;
        try {
          parsedJson = JSON.parse(content);
        } catch (err) {
          return res.status(400).json({ message: 'Formato de backup inválido: data.json corrupto' });
        }

        if (parsedJson.encrypted) {
          const { passphrase } = req.body;
          if (!passphrase) {
            return res.status(400).json({
              requiresPassphrase: true,
              message: 'El backup está cifrado. Ingrese la frase secreta para restaurarlo:'
            });
          }
          try {
            const decryptedStr = decryptWithPassphrase(content, passphrase);
            backupJson = JSON.parse(decryptedStr);
          } catch (err) {
            return res.status(400).json({
              requiresPassphrase: true,
              message: 'Frase secreta incorrecta. Intente nuevamente:'
            });
          }
        } else {
          backupJson = parsedJson;
        }

        // Restaurar archivos físicos: uploads
        const extractedUploads = path.join(extractDir, 'uploads');
        if (fsSync.existsSync(extractedUploads)) {
          if (shouldClearBeforeRestore) {
            await fs.rm(UPLOADS_DIR, { recursive: true, force: true }).catch(() => {});
          }
          await fs.mkdir(UPLOADS_DIR, { recursive: true });
          await fs.cp(extractedUploads, UPLOADS_DIR, { recursive: true, force: true });
          restoredUploads = true;
          logger.info({ source: extractedUploads, destination: UPLOADS_DIR }, 'Directorio /uploads restaurado recursivamente');
        }

        // Restaurar directorio global opcional
        const extractedGlobal = path.join(extractDir, 'global');
        if (fsSync.existsSync(extractedGlobal)) {
          if (shouldClearBeforeRestore) {
            await fs.rm(GLOBAL_DIR, { recursive: true, force: true }).catch(() => {});
          }
          await fs.mkdir(GLOBAL_DIR, { recursive: true });
          await fs.cp(extractedGlobal, GLOBAL_DIR, { recursive: true, force: true });
          restoredGlobal = true;
          logger.info({ source: extractedGlobal, destination: GLOBAL_DIR }, 'Directorio /global restaurado recursivamente');
        }

        // Restaurar archivos físicos: secrets (SSL certs)
        const extractedSecrets = path.join(extractDir, 'secrets');
        if (fsSync.existsSync(extractedSecrets)) {
          if (shouldClearBeforeRestore) {
            await fs.rm(SECRETS_DIR, { recursive: true, force: true }).catch(() => {});
          }
          await fs.mkdir(SECRETS_DIR, { recursive: true });
          await fs.cp(extractedSecrets, SECRETS_DIR, { recursive: true, force: true });
          restoredSecrets = true;
          keyringPresentAfterRestore = fsSync.existsSync(path.join(SECRETS_DIR, 'encryption-keyring.json'));
          logger.info({ source: extractedSecrets, destination: SECRETS_DIR }, 'Directorio /secrets restaurado recursivamente');
        }

      } finally {
        // Limpiar directorio temporal de extracción
        await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
      }

    } else {
      // --- Restauración JSON legacy ---
      const content = await fs.readFile(filePath, 'utf8');
      
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (err) {
        return res.status(400).json({ message: 'Formato de backup inválido: JSON corrupto' });
      }

      if (parsedJson.encrypted) {
        const { passphrase } = req.body;
        if (!passphrase) {
          return res.status(400).json({
            requiresPassphrase: true,
            message: 'El backup está cifrado. Ingrese la frase secreta para restaurarlo:'
          });
        }
        try {
          const decryptedStr = decryptWithPassphrase(content, passphrase);
          backupJson = JSON.parse(decryptedStr);
        } catch (err) {
          return res.status(400).json({
            requiresPassphrase: true,
            message: 'Frase secreta incorrecta. Intente nuevamente:'
          });
        }
      } else {
        backupJson = parsedJson;
      }
    }

    if (!backupJson.data) {
      return res.status(400).json({ message: 'Formato de backup inválido' });
    }

    const models = backupModels;

    if (shouldClearBeforeRestore) {
      logger.info('Borrando todas las colecciones antes de restaurar...');
      for (const Model of Object.values(models)) {
        await Model.deleteMany({});
      }
    }

    let imported = 0;
    for (const [key, Model] of Object.entries(models)) {
      if (backupJson.data[key]?.length) {
        try {
          await Model.insertMany(backupJson.data[key], { ordered: false });
          imported += backupJson.data[key].length;
        } catch (err) {
          logger.warn({ collection: key, err }, 'Algunos documentos no pudieron ser importados');
        }
      }
    }

    await audit(req, {
      event: 'admin.backup.restore',
      level: 'warning',
      result: { success: true, filename, imported, isZip },
      metadata: {
        restoredUploads,
        restoredGlobal,
        restoredSecrets,
        keyringPresentAfterRestore,
        clearBeforeRestore: shouldClearBeforeRestore
      }
    });

    res.json({
      message: isZip
        ? 'Backup completo restaurado (base de datos + archivos físicos)'
        : 'Backup legacy restaurado (solo base de datos)',
      imported,
      restoredUploads,
      restoredGlobal,
      restoredSecrets,
      keyringPresentAfterRestore
    });
  } catch (error) {
    logger.error({ err: error }, 'Error restaurando backup');
    res.status(500).json({ message: 'Error restaurando backup' });
  }
});

// GET /api/backup/download/:filename - Descargar backup ZIP o JSON (admin)
router.get('/download/:filename', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { filename } = req.params;
    if (!isValidBackupFilename(filename)) {
      return res.status(400).json({ message: 'Filename inválido' });
    }
    const backupDir = path.join(__dirname, '../../backups');
    const filePath = path.join(backupDir, filename);

    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ message: 'Backup no encontrado' });
    }

    const contentType = filename.endsWith('.zip') ? 'application/zip' : 'application/json';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(filePath);
  } catch (error) {
    logger.error({ err: error }, 'Error descargando backup');
    res.status(500).json({ message: 'Error descargando backup' });
  }
});

// GET /api/backup/export/:type - Exportar CSV (admin)
router.get('/export/:type', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { type } = req.params;
    let data = [];
    let filename = '';

    switch (type) {
      case 'entries':
        data = await Entry.find().populate('createdBy', 'username fullName').lean();
        filename = `entries-${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'checks':
        data = await ShiftCheck.find().populate('userId', 'username fullName').lean();
        filename = `checks-${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'all':
        const [entries, checks] = await Promise.all([
          Entry.find().populate('createdBy', 'username fullName').lean(),
          ShiftCheck.find().populate('userId', 'username fullName').lean()
        ]);
        data = [...entries, ...checks];
        filename = `all-${new Date().toISOString().split('T')[0]}.csv`;
        break;

      default:
        return res.status(400).json({ message: 'Tipo inválido' });
    }

    const csv = arrayToCSV(data);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error({ err: error }, 'Error exportando CSV');
    res.status(500).json({ message: 'Error exportando CSV' });
  }
});

// POST /api/backup/import - Importar datos ZIP completo o JSON legacy (admin)
router.post('/import',
  authenticate,
  authorize('admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No se proporcionó archivo' });
      }

      const isZip = req.file.originalname.endsWith('.zip');
      const clearBeforeRestore = parseBooleanFlag(req.body?.clearBeforeRestore);
      let backupJson;
      let restoredUploads = false;
      let restoredGlobal = false;
      let restoredSecrets = false;
      let keyringPresentAfterRestore = false;

      if (isZip) {
        // --- Importación ZIP completa ---
        const extractDir = path.join(BACKUPS_DIR, `temp_import_${Date.now()}`);
        await fs.mkdir(extractDir, { recursive: true });

        try {
          // Descomprimir el ZIP de forma segura contra Zip Slip
          await safeExtractZip(req.file.path, extractDir);

          // Leer el JSON de base de datos
          const dataJsonPath = path.join(extractDir, 'data.json');
          let content;
          try {
            content = await fs.readFile(dataJsonPath, 'utf8');
          } catch {
            return res.status(400).json({ message: 'ZIP inválido: no contiene data.json' });
          }

          let parsedJson;
          try {
            parsedJson = JSON.parse(content);
          } catch (err) {
            return res.status(400).json({ message: 'Formato de backup inválido: data.json corrupto' });
          }

          if (parsedJson.encrypted) {
            const { passphrase } = req.body;
            if (!passphrase) {
              return res.status(400).json({
                requiresPassphrase: true,
                message: 'El backup está cifrado. Ingrese la frase secreta para importarlo:'
              });
            }
            try {
              const decryptedStr = decryptWithPassphrase(content, passphrase);
              backupJson = JSON.parse(decryptedStr);
            } catch (err) {
              return res.status(400).json({
                requiresPassphrase: true,
                message: 'Frase secreta incorrecta. Intente nuevamente:'
              });
            }
          } else {
            backupJson = parsedJson;
          }

          // Restaurar archivos físicos: uploads
          const extractedUploads = path.join(extractDir, 'uploads');
          if (fsSync.existsSync(extractedUploads)) {
            if (clearBeforeRestore) {
              await fs.rm(UPLOADS_DIR, { recursive: true, force: true }).catch(() => {});
            }
            await fs.mkdir(UPLOADS_DIR, { recursive: true });
            await fs.cp(extractedUploads, UPLOADS_DIR, { recursive: true, force: true });
            restoredUploads = true;
            logger.info({ source: extractedUploads, destination: UPLOADS_DIR }, 'Directorio /uploads importado recursivamente');
          }

            // Directorio global opcional
            const extractedGlobal = path.join(extractDir, 'global');
            if (fsSync.existsSync(extractedGlobal)) {
              if (clearBeforeRestore) {
                await fs.rm(GLOBAL_DIR, { recursive: true, force: true }).catch(() => {});
              }
              await fs.mkdir(GLOBAL_DIR, { recursive: true });
              await fs.cp(extractedGlobal, GLOBAL_DIR, { recursive: true, force: true });
              restoredGlobal = true;
              logger.info({ source: extractedGlobal, destination: GLOBAL_DIR }, 'Directorio /global importado recursivamente');
            }

          // Restaurar archivos físicos: secrets (SSL certs)
          const extractedSecrets = path.join(extractDir, 'secrets');
          if (fsSync.existsSync(extractedSecrets)) {
            if (clearBeforeRestore) {
              await fs.rm(SECRETS_DIR, { recursive: true, force: true }).catch(() => {});
            }
            await fs.mkdir(SECRETS_DIR, { recursive: true });
            await fs.cp(extractedSecrets, SECRETS_DIR, { recursive: true, force: true });
            restoredSecrets = true;
            keyringPresentAfterRestore = fsSync.existsSync(path.join(SECRETS_DIR, 'encryption-keyring.json'));
            logger.info({ source: extractedSecrets, destination: SECRETS_DIR }, 'Directorio /secrets importado recursivamente');
          }

        } finally {
          // Limpiar directorio temporal de extracción
          await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
          // Eliminar archivo temporal del upload
          await fs.unlink(req.file.path).catch(() => { });
        }

      } else {
        // --- Importación JSON (legacy o nuevo formato) ---
        let content;
        try {
          content = await fs.readFile(req.file.path, 'utf8');
        } catch {
          await fs.unlink(req.file.path).catch(() => { });
          return res.status(400).json({ message: 'Error al leer el archivo JSON' });
        }

        let parsedJson;
        try {
          parsedJson = JSON.parse(content);
          await fs.unlink(req.file.path).catch(() => { });
        } catch {
          await fs.unlink(req.file.path).catch(() => { });
          return res.status(400).json({ message: 'JSON inválido' });
        }

        if (parsedJson.encrypted) {
          const { passphrase } = req.body;
          if (!passphrase) {
            return res.status(400).json({
              requiresPassphrase: true,
              message: 'El backup está cifrado. Ingrese la frase secreta para importarlo:'
            });
          }
          try {
            const decryptedStr = decryptWithPassphrase(content, passphrase);
            backupJson = JSON.parse(decryptedStr);
          } catch (err) {
            return res.status(400).json({
              requiresPassphrase: true,
              message: 'Frase secreta incorrecta. Intente nuevamente:'
            });
          }
        } else {
          backupJson = parsedJson;
        }
      }

      // Validar estructura de backup
      if (!backupJson.data) {
        return res.status(400).json({ message: 'Formato de backup inválido: falta sección "data"' });
      }

      // Importar colecciones dinámicamente usando backupModels
      const models = backupModels;
      let imported = 0;

      if (clearBeforeRestore) {
        logger.info('Borrando todas las colecciones antes de importar...');
        for (const Model of Object.values(models)) {
          await Model.deleteMany({});
        }
      }

      for (const [key, Model] of Object.entries(models)) {
        if (backupJson.data[key]?.length) {
          try {
            await Model.insertMany(backupJson.data[key], { ordered: false });
            imported += backupJson.data[key].length;
          } catch (err) {
            logger.warn({ collection: key, err }, 'Algunos documentos no pudieron ser importados');
          }
        }
      }

      await audit(req, {
        event: 'admin.backup.import',
        level: 'info',
        result: { success: true, imported, isZip },
        metadata: {
          clearBeforeRestore,
          restoredUploads,
          restoredGlobal,
          restoredSecrets,
          keyringPresentAfterRestore
        }
      });

      res.json({
        message: isZip 
          ? 'Backup ZIP importado exitosamente (base de datos + archivos físicos)'
          : 'Backup JSON importado exitosamente',
        imported,
        restoredUploads,
        restoredGlobal,
        restoredSecrets,
        keyringPresentAfterRestore
      });
    } catch (error) {
      // Limpiar archivo temporal
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => { });
      }

      logger.error({ err: error }, 'Error importando backup');
      res.status(500).json({ message: 'Error importando backup' });
    }
  }
);

// Función helper para vaciar directorios de volúmenes de Docker sin borrar la carpeta base
const emptyDirectory = async (dirPath) => {
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      // Se excluye la llave de cifrado keyring para evitar pérdida de acceso a backups cifrados
      if (file === '.gitkeep' || file === 'encryption-keyring.json') continue;
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error({ err: error, dirPath }, 'Error vaciando directorio de volumen');
    }
  }
};

const ensureDefaultAdminUser = async () => {
  const adminUsername = (process.env.ADMIN_USERNAME || '').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (!adminUsername || !adminPassword) {
    logger.warn({ event: 'backup.purge.admin.skipped' }, 'No se pudo recrear el usuario admin por falta de variables de entorno');
    return false;
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@bitacora.local').trim();
  await User.deleteMany({ role: 'admin' });
  await User.create({
    username: adminUsername,
    password: adminPassword,
    email: adminEmail,
    fullName: 'Administrador Maestro SOC',
    role: 'admin',
    cargoLabel: 'Líder Técnico SOC',
    isActive: true,
    theme: 'dark'
  });

  return true;
};

// POST /api/backup/purge - Purgar todos los datos (admin)
router.post('/purge', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { confirmation } = req.body || {};
    if (confirmation !== PURGE_CONFIRM_PHRASE) {
      return res.status(400).json({
        message: `Confirmación inválida. Debes escribir exactamente: ${PURGE_CONFIRM_PHRASE}`
      });
    }

    let deletedCollections = 0;
    for (const Model of Object.values(backupModels)) {
      await Model.deleteMany({});
      deletedCollections += 1;
    }

    // Purgar volúmenes físicos montados en Docker
    const dirsToPurge = [
      path.join(__dirname, '../../uploads'),
      path.join(__dirname, '../../global'),
      path.join(__dirname, '../../logs'),
      path.join(__dirname, '../../backups'),
      path.join(__dirname, '../../secrets')
    ];

    for (const dir of dirsToPurge) {
      await emptyDirectory(dir);
    }

    const adminRecreated = await ensureDefaultAdminUser();

    await audit(req, {
      event: 'admin.backup.purge',
      level: 'warning',
      result: { success: true, deletedCollections, volumesPurged: true, adminRecreated }
    });

    res.json({
      message: adminRecreated
        ? 'Base de datos y volúmenes físicos purgados exitosamente (Factory Reset). Usuario admin recreado desde .env'
        : 'Base de datos y volúmenes físicos purgados exitosamente (Factory Reset). No se pudo recrear el usuario admin porque faltan variables de entorno',
      deletedCollections,
      adminRecreated
    });
  } catch (error) {
    logger.error({ err: error }, 'Error purgando datos y volúmenes');
    res.status(500).json({ message: 'Error purgando datos y volúmenes' });
  }
});

// DELETE /api/backup/:id - Eliminar backup (admin)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidBackupFilename(id)) {
      return res.status(400).json({ message: 'Filename inválido' });
    }
    const backupDir = path.join(__dirname, '../../backups');
    const filePath = path.join(backupDir, id);

    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ message: 'Backup no encontrado' });
    }

    await fs.unlink(filePath);

    await audit(req, {
      event: 'admin.backup.delete',
      level: 'info',
      result: { success: true, filename: id }
    });

    res.json({ message: 'Backup eliminado' });
  } catch (error) {
    logger.error({ err: error }, 'Error eliminando backup');
    res.status(500).json({ message: 'Error eliminando backup' });
  }
});

module.exports = router;
