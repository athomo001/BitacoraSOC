/**
 * File Purpose: backend/src/scripts/seed.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bitacora_soc';

// Models
const User = require('../models/User');
const Client = require('../models/Client');
const CatalogLogSource = require('../models/CatalogLogSource');
const CatalogEvent = require('../models/CatalogEvent');
const CatalogOperationType = require('../models/CatalogOperationType');
const ChecklistTemplate = require('../models/ChecklistTemplate');
const WorkShift = require('../models/WorkShift');
const WorkShiftAssignment = require('../models/WorkShiftAssignment');
const AppConfig = require('../models/AppConfig');
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const EscalationRule = require('../models/EscalationRule');
const Contact = require('../models/Contact');
const Service = require('../models/Service');

const collectionToModelMap = {
  'users': User,
  'entries': Entry,
  'catalog_log_sources': CatalogLogSource,
  'catalog_events': CatalogEvent,
  'catalog_operation_types': CatalogOperationType,
  'clients': Client,
  'checklists': ShiftCheck,
  'checklist_templates': ChecklistTemplate,
  'work_shifts': WorkShift,
  'work_shift_assignments': WorkShiftAssignment,
  'escalations': EscalationRule,
  'contacts': Contact,
  'services': Service,
  'app_configs': AppConfig
};

async function runSeed() {
  try {
    console.log('--- Iniciando Semilla de Entorno Genérico v2 (Checklist Fix) ---');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    // 1. Limpieza de colecciones críticas para asegurar consistencia
    const collectionsToClear = [
      'users', 'entries', 'clients', 'catalog_log_sources',
      'catalog_events', 'catalog_operation_types', 'checklist_templates',
      'work_shifts', 'work_shift_assignments', 'checklists'
    ];
    for (const coll of collectionsToClear) {
      const Model = collectionToModelMap[coll];
      if (Model) await Model.deleteMany({});
    }
    console.log('🧹 Limpieza de colecciones completada.');

    // 2. Usuarios
    const admin = await User.create({
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || 'Admin123!',
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      fullName: 'Administrador Maestro SOC',
      role: 'admin',
      cargoLabel: 'Líder Técnico SOC',
      isActive: true,
      theme: 'dark'
    });
    const analista1 = await User.create({ username: 'analista1', password: 'Admin123!', email: 'n1@soc.local', fullName: 'Analista N1 SOC', role: 'user', cargoLabel: 'N1', isActive: true });
    await User.create({ username: 'analista2', password: 'Admin123!', email: 'n2@soc.local', fullName: 'Analista N2 SOC', role: 'user', cargoLabel: 'N2', isActive: true });
    console.log('✅ Usuarios creados.');

    // 3. Turnos
    const turnos = [
      { name: 'Mañana', code: 'MORNING', startTime: '08:00', endTime: '16:00', isNightShift: false, timezone: 'America/Santiago', order: 1 },
      { name: 'Tarde', code: 'AFTERNOON', startTime: '16:00', endTime: '00:00', isNightShift: false, timezone: 'America/Santiago', order: 2 },
      { name: 'Noche', code: 'NIGHT', startTime: '00:00', endTime: '08:00', isNightShift: true, timezone: 'America/Santiago', order: 3 }
    ];
    const dbShifts = [];
    for (const t of turnos) {
      dbShifts.push(await WorkShift.create(t));
    }
    await WorkShiftAssignment.create({ userId: analista1._id, workShiftId: dbShifts[0]._id, weekdays: [1, 2, 3, 4, 5, 6, 0], active: true, validFrom: new Date() });
    console.log('✅ Turnos y asignaciones creados.');

    // 4. Clientes y Logs
    const clients = [
      { name: 'Empresa Alpha', code: 'empresa_alpha' },
      { name: 'Corp Beta', code: 'corp_beta' },
      { name: 'Banco Delta', code: 'banco_delta' }
    ];
    const dbClients = [];
    for (const c of clients) {
      const dbC = await Client.create(c);
      dbClients.push(dbC);
      await CatalogLogSource.create({ name: dbC.name, enabled: true });
    }
    console.log('✅ Clientes y Log Sources creados.');

    // 5. Checklists - VINCULADOS A TURNOS
    const checklistData = [
      { name: 'Apertura de Turno (Mañana)', type: 'inicio', shiftIdx: 0 },
      { name: 'Cierre de Turno (Mañana)', type: 'cierre', shiftIdx: 0 },
      { name: 'Apertura de Turno (Tarde)', type: 'inicio', shiftIdx: 1 },
      { name: 'Cierre de Turno (Tarde)', type: 'cierre', shiftIdx: 1 },
      { name: 'Apertura de Turno (Noche)', type: 'inicio', shiftIdx: 2 },
      { name: 'Cierre de Turno (Noche)', type: 'cierre', shiftIdx: 2 },
      { name: 'Revisión Continua SIEM', type: 'inicio', shiftIdx: 0 } // Extra
    ];

    for (const [idx, data] of checklistData.entries()) {
      await ChecklistTemplate.create({
        name: data.name,
        isActive: idx === 0, // Solo la primera es globalmente activa por defecto si falla el match
        assignedTo: [{
          shiftId: dbShifts[data.shiftIdx]._id,
          type: data.type
        }],
        items: [
          { title: 'Verificar SLAs de tickets críticos', required: true },
          { title: 'Validar visibilidad en SIEM', required: true },
          { title: 'Revisión de buzón de spam/phishing', required: false }
        ]
      });
    }
    console.log('✅ 7 Plantillas de Checklist creadas e integradas con los turnos.');

    // 6. Catálogos Operación
    const ops = ['Investigación de Alerta', 'Bloqueo de IP', 'Análisis Malware', 'Escalación a TI', 'Soporte Directo'];
    for (const op of ops) {
      await CatalogOperationType.create({ name: op, enabled: true });
    }

    // 7. Importación Historial Sanitizado (226 entradas)
    const importPath = path.resolve(__dirname, '../../backup_final.json');
    if (fs.existsSync(importPath)) {
      const rawData = fs.readFileSync(importPath, 'utf8');
      const backupData = JSON.parse(rawData);
      const recordsMap = backupData.data || backupData;

      let timeDelta = 0;
      if (recordsMap.entries && recordsMap.entries.length > 0) {
        const sortedEntries = [...recordsMap.entries].sort((a, b) => {
          const dateA = a.entryDate?.$date ? new Date(a.entryDate.$date) : new Date(a.entryDate);
          const dateB = b.entryDate?.$date ? new Date(b.entryDate.$date) : new Date(b.entryDate);
          return dateB - dateA;
        });
        const latestDate = sortedEntries[0].entryDate?.$date ? new Date(sortedEntries[0].entryDate.$date).getTime() : new Date(sortedEntries[0].entryDate).getTime();
        timeDelta = new Date().getTime() - latestDate;
      }

      // Restaurar Entries profundizado
      if (recordsMap.entries) {
        const formattedEntries = recordsMap.entries.map(e => {
          if (e._id?.$oid) e._id = new mongoose.Types.ObjectId(e._id.$oid);
          if (e.entryDate?.$date) e.entryDate = new Date(new Date(e.entryDate.$date).getTime() + timeDelta);
          e.clientId = dbClients[0]._id;
          e.clientName = dbClients[0].name;
          e.createdBy = admin._id;
          return e;
        });
        await Entry.insertMany(formattedEntries, { ordered: false });
        console.log(`✅ ${formattedEntries.length} Entradas del historial restauradas.`);
      }
    }

    console.log('\n🚀 ENTORNO 100% GENÉRICO V2 LISTO.');
    console.log('Acceso: admin / Admin123!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error fatal en seed:', error);
    process.exit(1);
  }
}

runSeed();
