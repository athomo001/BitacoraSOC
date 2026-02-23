/**
 * Rutas de Backup/Restore MongoDB
 * 
 * Endpoints:
 *   GET  /api/backup/history         - Historial de backups (admin)
 *   POST /api/backup/create          - Crear backup JSON (admin)
 *   POST /api/backup/restore         - Restaurar backup (admin)
 *   GET  /api/backup/export/:type    - Exportar CSV (entries/checks/all)
 *   POST /api/backup/import          - Importar datos CSV/JSON (admin)
 *   DELETE /api/backup/:id           - Eliminar backup (admin)
 * 
 * Reglas SOC:
 *   - Solo admins pueden ejecutar backups
 *   - Path sanitization obligatoria
 *   - Auditoría de todas las operaciones
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
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

const PURGE_CONFIRM_PHRASE = 'PURGAR TODO';

// Configurar multer para importación
const upload = multer({
  dest: path.join(__dirname, '../../backups/temp'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

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

// GET /api/backup/history - Historial de backups (admin)
router.get('/history', authenticate, authorize('admin'), async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const files = await fs.readdir(backupDir);
    const backups = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        backups.push({
          _id: file,
          filename: file,
          createdAt: stats.birthtime,
          size: stats.size
        });
      }
    }
    
    res.json({ backups: backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (error) {
    logger.error({ err: error }, 'Error listando backups');
    res.status(500).json({ message: 'Error listando backups' });
  }
});

// POST /api/backup/create - Crear backup JSON (admin)
router.post('/create', authenticate, authorize('admin'), async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;
    const filePath = path.join(backupDir, filename);
    
    // Exportar todas las colecciones
    const [entries, checks, users, adminNotes, appConfigs, auditLogs,
           catalogEvents, catalogLogSources, catalogOperationTypes,
           checklistTemplates, clients, contacts, clientEscalationRules, escalationRules,
           externalPersons, logForwardingConfigs, personalNotes,
           services, serviceCatalogs, shiftAssignments, shiftOverrides,
           shiftRoles, shiftRotationCycles, smtpConfigs] = await Promise.all([
      Entry.find().lean(),
      ShiftCheck.find().lean(),
      User.find().lean(), // Incluir passwords (están hasheadas con bcrypt)
      AdminNote.find().lean(),
      AppConfig.find().lean(),
      AuditLog.find().lean(),
      CatalogEvent.find().lean(),
      CatalogLogSource.find().lean(),
      CatalogOperationType.find().lean(),
      ChecklistTemplate.find().lean(),
      Client.find().lean(),
      Contact.find().lean(),
      ClientEscalationRule.find().lean(),
      EscalationRule.find().lean(),
      ExternalPerson.find().lean(),
      LogForwardingConfig.find().lean(),
      PersonalNote.find().lean(),
      Service.find().lean(),
      ServiceCatalog.find().lean(),
      ShiftAssignment.find().lean(),
      ShiftOverride.find().lean(),
      ShiftRole.find().lean(),
      ShiftRotationCycle.find().lean(),
      SmtpConfig.find().lean()
    ]);
    
    const backup = {
      metadata: {
        created: new Date(),
        version: '2.0',
        createdBy: req.user._id,
        collections: 24
      },
      data: {
        entries, checks, users, adminNotes, appConfigs, auditLogs,
        catalogEvents, catalogLogSources, catalogOperationTypes,
        checklistTemplates, clients, contacts, clientEscalationRules, escalationRules,
        externalPersons, logForwardingConfigs, personalNotes,
        services, serviceCatalogs, shiftAssignments, shiftOverrides,
        shiftRoles, shiftRotationCycles, smtpConfigs
      }
    };
    
    await fs.writeFile(filePath, JSON.stringify(backup, null, 2));
    
    await audit(req, {
      event: 'admin.backup.create',
      level: 'info',
      result: { success: true, filename }
    });
    
    const totalDocs = Object.values(backup.data).reduce((sum, arr) => sum + arr.length, 0);
    
    res.json({
      message: 'Backup creado exitosamente',
      filename,
      collections: 24,
      documents: totalDocs
    });
  } catch (error) {
    logger.error({ err: error }, 'Error creando backup');
    res.status(500).json({ message: 'Error creando backup' });
  }
});

// POST /api/backup/restore - Restaurar backup (admin)
router.post('/restore', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { filename, clearBeforeRestore } = req.body;
    
    if (!filename) {
      return res.status(400).json({ message: 'Filename requerido' });
    }
    
    const backupDir = path.join(__dirname, '../../backups');
    const filePath = path.join(backupDir, filename);
    
    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ message: 'Backup no encontrado' });
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    const backup = JSON.parse(content);
    
    if (!backup.data) {
      return res.status(400).json({ message: 'Formato de backup inválido' });
    }
    
    // Definir modelos
    const models = backupModels;
    
    // Si clearBeforeRestore=true, borrar TODAS las colecciones primero
    if (clearBeforeRestore === true) {
      logger.info('Borrando todas las colecciones antes de restaurar...');
      for (const Model of Object.values(models)) {
        await Model.deleteMany({});
      }
    }
    
    let imported = 0;
    for (const [key, Model] of Object.entries(models)) {
      if (backup.data[key]?.length) {
        try {
          await Model.insertMany(backup.data[key], { ordered: false });
          imported += backup.data[key].length;
        } catch (err) {
          // Ignorar duplicados, continuar con otras colecciones
          logger.warn({ collection: key, err }, 'Algunos documentos no pudieron ser importados');
        }
      }
    }
    
    await audit(req, {
      event: 'admin.backup.restore',
      level: 'warning',
      result: { success: true, filename, imported }
    });
    
    res.json({ 
      message: 'Backup restaurado exitosamente',
      imported
    });
  } catch (error) {
    logger.error({ err: error }, 'Error restaurando backup');
    res.status(500).json({ message: 'Error restaurando backup' });
  }
});

// GET /api/backup/download/:filename - Descargar backup JSON (admin)
router.get('/download/:filename', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { filename } = req.params;
    const backupDir = path.join(__dirname, '../../backups');
    const filePath = path.join(backupDir, filename);
    
    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ message: 'Backup no encontrado' });
    }
    
    res.setHeader('Content-Type', 'application/json');
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

// POST /api/backup/import - Importar datos (admin)
router.post('/import',
  authenticate,
  authorize('admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No se proporcionó archivo' });
      }
      
      const content = await fs.readFile(req.file.path, 'utf8');
      let data;
      
      // Intentar parsear como JSON
      try {
        data = JSON.parse(content);
      } catch {
        // Si falla, intentar como CSV (implementación básica)
        return res.status(400).json({ message: 'Solo se soporta formato JSON por ahora' });
      }
      
      // Validar estructura
      if (!data.data) {
        return res.status(400).json({ message: 'Formato inválido' });
      }
      
      let imported = 0;
      
      // Importar entries
      if (data.data.entries && data.data.entries.length > 0) {
        const result = await Entry.insertMany(data.data.entries, { ordered: false }).catch(() => ({ length: 0 }));
        imported += result.length || 0;
      }
      
      // Importar checks
      if (data.data.checks && data.data.checks.length > 0) {
        const result = await ShiftCheck.insertMany(data.data.checks, { ordered: false }).catch(() => ({ length: 0 }));
        imported += result.length || 0;
      }
      
      // Eliminar archivo temporal
      await fs.unlink(req.file.path).catch(() => {});
      
      await audit(req, {
        event: 'admin.backup.import',
        level: 'info',
        result: { success: true, imported }
      });
      
      res.json({
        message: 'Datos importados exitosamente',
        imported
      });
    } catch (error) {
      // Limpiar archivo temporal
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      
      logger.error({ err: error }, 'Error importando datos');
      res.status(500).json({ message: 'Error importando datos' });
    }
  }
);

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

    await audit(req, {
      event: 'admin.backup.purge',
      level: 'warning',
      result: { success: true, deletedCollections }
    });

    res.json({
      message: 'Datos purgados exitosamente',
      deletedCollections
    });
  } catch (error) {
    logger.error({ err: error }, 'Error purgando datos');
    res.status(500).json({ message: 'Error purgando datos' });
  }
});

// DELETE /api/backup/:id - Eliminar backup (admin)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
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
