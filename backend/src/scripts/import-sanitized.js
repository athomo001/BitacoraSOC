const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bitacora_soc';

// Mapear claves del JSON a los nombres de los Modelos de Mongoose
const collectionToModelMap = {
    'users': require('../models/User'),
    'entries': require('../models/Entry'),
    'catalog_log_sources': require('../models/CatalogLogSource'),
    'catalog_events': require('../models/CatalogEvent'),
    'catalog_operation_types': require('../models/CatalogOperationType'),
    'escalations': require('../models/EscalationRule'),
    'client_escalations': require('../models/ClientEscalationRule'),
    'contacts': require('../models/Contact'),
    'external_persons': require('../models/ExternalPerson'),
    'services': require('../models/Service'),
    'service_catalogs': require('../models/ServiceCatalog'),
    'clients': require('../models/Client'),
    'raci_matrices': require('../models/RaciEntry'),
    'checklists': require('../models/ShiftCheck'),
    'checklist_templates': require('../models/ChecklistTemplate'),
    'checklist_notification_logs': require('../models/ChecklistNotificationLog'),
    'app_configs': require('../models/AppConfig'),
    'smtp_configs': require('../models/SmtpConfig'),
    'glpi_configs': require('../models/GlpiConfig'),
    'work_shifts': require('../models/WorkShift'),
    'work_shift_assignments': require('../models/WorkShiftAssignment'),
    'shift_overrides': require('../models/ShiftOverride'),
    'shift_roles': require('../models/ShiftRole'),
    'admin_notes': require('../models/AdminNote'),
    // 'saved_reports' depends on model, maybe Report? Or just ignore if not strictly seeded.
};

async function importData() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado a MongoDB para Restauración Directa');

        const rawData = fs.readFileSync(path.resolve(__dirname, '../../backup_sanitized.json'), 'utf8');
        const backupData = JSON.parse(rawData);
        const recordsMap = backupData.data ? backupData.data : backupData;

        // Iterar por cada colección y restaurar
        for (const [collectionName, records] of Object.entries(recordsMap)) {
            if (!Array.isArray(records) || records.length === 0) continue;

            const Model = collectionToModelMap[collectionName];
            if (!Model) {
                console.log(`⚠️ Modelo no encontrado para la colección '${collectionName}'. Saltando ${records.length} registros.`);
                continue;
            }

            console.log(`🧹 Limpiando colección: ${collectionName}...`);
            await Model.deleteMany({});

            // Filtrar y convertir `_id.$oid` a `_id` de string para Mongoose
            const formattedRecords = records.map(record => {
                if (record._id && record._id.$oid) {
                    record._id = new mongoose.Types.ObjectId(record._id.$oid);
                }

                // Ajustar referencias de OIDs en campos comunes para evitar crash
                const fieldsToCheck = [
                    'clientId', 'createdBy', 'updatedBy', 'escalationRuleId', 'workShiftId', 'userId', 'shiftId'
                ];
                fieldsToCheck.forEach(field => {
                    if (record[field] && record[field].$oid) {
                        record[field] = new mongoose.Types.ObjectId(record[field].$oid);
                    }
                });

                // Fechas
                Object.keys(record).forEach(k => {
                    if (record[k] && record[k].$date) {
                        record[k] = new Date(record[k].$date);
                    }
                });

                return record;
            });

            console.log(`📥 Importando ${formattedRecords.length} registros en ${collectionName}...`);
            await Model.insertMany(formattedRecords, { ordered: false });
        }

        console.log('');
        console.log('🎉 RESTAURACIÓN COMPLETADA EXITOSAMENTE 🎉');
        console.log('Todos los datos sanitizados (entradas, checklists, escalaciones) han sido inyectados.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error fatal en restauración directa:', error);
        process.exit(1);
    }
}

importData();
