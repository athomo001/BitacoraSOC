/**
 * File Purpose: backend/scripts/delete-entries.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

/**
 * Script para eliminar todas las entradas
 * Uso: node scripts/delete-entries.js
 */

const mongoose = require('mongoose');
require('../src/models/Entry');

const Entry = mongoose.model('Entry');

async function deleteAllEntries() {
  try {
    console.log('📡 Conectando a MongoDB...');
    
    const mongoUri = process.env.MONGODB_URI || 'mongodb://bitacora:bitacora123@localhost:27017/bitacora?authSource=admin';
    await mongoose.connect(mongoUri);
    
    console.log('✅ Conectado a MongoDB');

    console.log('🗑️  Eliminando todas las entradas...');
    const result = await Entry.deleteMany({});
    console.log(`✅ ${result.deletedCount} entradas eliminadas`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Conexión cerrada');
  }
}

deleteAllEntries();
