/**
 * File Purpose: backend/src/scripts/seed-work-shifts.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');
const WorkShift = require('../models/WorkShift');
require('dotenv').config();

/**
 * Script para crear turnos de trabajo de ejemplo
 * 
 * Ejemplos:
 *   1. Turno único de 9-18 (configuración actual)
 *   2. 3 turnos (mañana, tarde, noche)
 *   3. Turno de emergencia (no hábil)
 * 
 * Uso:
 *   node src/scripts/seed-work-shifts.js
 */

const exampleShifts = [
  // OPCIÓN 1: Turno único (configuración actual)
  {
    name: 'Turno Diurno',
    code: 'DAY',
    description: 'Turno único de oficina - 9:00 a 18:00',
    type: 'regular',
    startTime: '09:00',
    endTime: '18:00',
    timezone: 'America/Santiago',
    emailReportConfig: {
      enabled: false,
      includeChecklist: true,
      includeEntries: true,
      recipients: [],
      subjectTemplate: 'Reporte SOC [fecha] [turno]'
    },
    order: 1,
    active: true,
    color: '#1976d2'
  },
  
  // Turno de emergencia (fuera de horario)
  {
    name: 'Emergencia No Hábil',
    code: 'EMERGENCY',
    description: 'Turno de emergencia fuera de horario de oficina',
    type: 'emergency',
    startTime: '18:00',
    endTime: '09:00',
    timezone: 'America/Santiago',
    emailReportConfig: {
      enabled: false,
      includeChecklist: true,
      includeEntries: true,
      recipients: [],
      subjectTemplate: 'Reporte SOC [fecha] [turno]'
    },
    order: 10,
    active: true,
    color: '#f44336'
  }
];

// Descomentar para 3 turnos (24 horas divididas en 3)
const threeShiftsExample = [
  {
    name: 'Turno Mañana',
    code: 'MORNING',
    description: 'Turno de mañana - 9:00 a 17:00',
    type: 'regular',
    startTime: '09:00',
    endTime: '17:00',
    timezone: 'America/Santiago',
    emailReportConfig: {
      enabled: false,
      includeChecklist: true,
      includeEntries: true,
      recipients: [],
      subjectTemplate: 'Reporte SOC [fecha] [turno]'
    },
    order: 1,
    active: true,
    color: '#4caf50'
  },
  {
    name: 'Turno Tarde',
    code: 'AFTERNOON',
    description: 'Turno de tarde - 17:00 a 01:00',
    type: 'regular',
    startTime: '17:00',
    endTime: '01:00',
    timezone: 'America/Santiago',
    emailReportConfig: {
      enabled: false,
      includeChecklist: true,
      includeEntries: true,
      recipients: [],
      subjectTemplate: 'Reporte SOC [fecha] [turno]'
    },
    order: 2,
    active: true,
    color: '#ff9800'
  },
  {
    name: 'Turno Noche',
    code: 'NIGHT',
    description: 'Turno de noche - 01:00 a 09:00',
    type: 'regular',
    startTime: '01:00',
    endTime: '09:00',
    timezone: 'America/Santiago',
    emailReportConfig: {
      enabled: false,
      includeChecklist: true,
      includeEntries: true,
      recipients: [],
      subjectTemplate: 'Reporte SOC [fecha] [turno]'
    },
    order: 3,
    active: true,
    color: '#7b1fa2'
  },
  {
    name: 'Emergencia',
    code: 'EMERGENCY',
    description: 'Turno de emergencia (backup)',
    type: 'emergency',
    startTime: '00:00',
    endTime: '23:59',
    timezone: 'America/Santiago',
    emailReportConfig: {
      enabled: false,
      includeChecklist: true,
      includeEntries: true,
      recipients: [],
      subjectTemplate: 'Reporte SOC [fecha] [turno]'
    },
    order: 10,
    active: false, // Inactivo por defecto
    color: '#f44336'
  }
];

async function seedWorkShifts() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado a MongoDB');

    // Verificar si ya existen turnos
    const existingCount = await WorkShift.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠️  Ya existen ${existingCount} turnos en la base de datos`);
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('¿Deseas eliminar los turnos existentes y crear nuevos? (s/n): ', resolve);
      });
      readline.close();

      if (answer.toLowerCase() !== 's') {
        console.log('❌ Operación cancelada');
        process.exit(0);
      }

      await WorkShift.deleteMany({});
      console.log('🗑️  Turnos existentes eliminados');
    }

    // CAMBIAR AQUÍ: Usa `exampleShifts` o `threeShiftsExample`
    const shiftsToCreate = exampleShifts; // O threeShiftsExample para 3 turnos

    // Crear turnos
    const created = await WorkShift.insertMany(shiftsToCreate);
    console.log(`✅ ${created.length} turnos creados exitosamente:`);
    
    created.forEach(shift => {
      console.log(`   - ${shift.name} (${shift.code}) [${shift.type}] ${shift.startTime}-${shift.endTime}`);
    });

    console.log('\n📋 Resumen:');
    console.log(`   Total turnos: ${created.length}`);
    console.log(`   Regulares: ${created.filter(s => s.type === 'regular').length}`);
    console.log(`   Emergencia: ${created.filter(s => s.type === 'emergency').length}`);
    console.log(`   Activos: ${created.filter(s => s.active).length}`);

    console.log('\n✅ Seed completado exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en seed:', error);
    process.exit(1);
  }
}

// Ejecutar
seedWorkShifts();
