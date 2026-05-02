/**
 * File Purpose: backend/scripts/add-netics.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

/**
 * Script para agregar "Netics" al catálogo de Log Sources
 * Ejecutar: node scripts/add-netics.js
 */
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const CatalogLogSource = require('../src/models/CatalogLogSource');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bitacora-soc';

async function addNetics() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000,
    });
    
    console.log('✅ Conectado a MongoDB\n');

    // Verificar si "Netics" ya existe
    const existing = await CatalogLogSource.findOne({ name: 'Netics' });
    
    if (existing) {
      console.log('✅ "Netics" ya existe en la base de datos');
      if (!existing.enabled) {
        console.log('   Habilitando "Netics"...');
        existing.enabled = true;
        await existing.save();
        console.log('   ✅ "Netics" habilitado');
      }
    } else {
      console.log('📝 Creando "Netics"...');
      const netics = new CatalogLogSource({
        name: 'Netics',
        parent: 'Sistema Interno',
        description: 'Log source por defecto del sistema',
        enabled: true
      });
      
      await netics.save();
      console.log('✅ "Netics" creado exitosamente');
      console.log(`   ID: ${netics._id}`);
    }

    console.log('\n✨ Tarea completada');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

addNetics();
