/**
 * File Purpose: backend/scripts/import-catalog-events.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

/**
 * Script para importar eventos del catálogo de forma masiva desde un archivo JSON
 * 
 * Uso:
 * 1. Crea un archivo JSON con tus eventos (ej: eventos.json)
 * 2. Ejecuta: node scripts/import-catalog-events.js <ruta-al-archivo.json>
 * 
 * Formato del JSON:
 * [
 *   {
 *     "name": "Nombre del Evento",
 *     "parent": "Categoría Padre",
 *     "motivoDefault": "Descripción del evento",
 *     "description": "Motivo por defecto (opcional)",
 *     "enabled": true
 *   }
 * ]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const CatalogEvent = require('../src/models/CatalogEvent');

const MONGODB_URI = process.env.MONGODB_URI || 
  `mongodb://${process.env.MONGO_ROOT_USER}:${process.env.MONGO_ROOT_PASSWORD}@localhost:27017/${process.env.MONGO_DATABASE}?authSource=admin`;

async function importCatalogEvents(filePath) {
  try {
    // Conectar a MongoDB
    console.log('📡 Conectando a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado a MongoDB');

    // Leer archivo JSON
    console.log(`📂 Leyendo archivo: ${filePath}`);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const events = JSON.parse(fileContent);

    if (!Array.isArray(events)) {
      throw new Error('El archivo JSON debe contener un array de eventos');
    }

    console.log(`📊 Se encontraron ${events.length} eventos para importar`);

    // Validar estructura básica
    const invalidEvents = events.filter(e => !e.name || !e.parent);
    if (invalidEvents.length > 0) {
      console.warn(`⚠️  ${invalidEvents.length} eventos no tienen name o parent y serán omitidos`);
    }

    const validEvents = events.filter(e => e.name && e.parent);

    // Opciones de importación
    console.log('\n🔄 Opciones de importación:');
    console.log('1. Insertar solo eventos nuevos (por nombre)');
    console.log('2. Actualizar eventos existentes y agregar nuevos (upsert)');
    console.log('3. Eliminar todos y reimportar (PELIGROSO)\n');

    // Por defecto usamos opción 1 (insertar solo nuevos)
    // Para usar otra opción, pasa un segundo argumento: node script.js eventos.json 2
    const importMode = process.argv[3] || '1';

    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    switch (importMode) {
      case '1':
        console.log('📝 Modo: Insertar solo eventos nuevos\n');
        for (const eventData of validEvents) {
          try {
            const exists = await CatalogEvent.findOne({ name: eventData.name });
            if (exists) {
              console.log(`⏭️  Ya existe: ${eventData.name}`);
              skippedCount++;
            } else {
              await CatalogEvent.create({
                name: eventData.name,
                parent: eventData.parent,
                motivoDefault: eventData.motivoDefault || '',
                description: eventData.description || '',
                enabled: eventData.enabled !== false // true por defecto
              });
              console.log(`✅ Insertado: ${eventData.name}`);
              insertedCount++;
            }
          } catch (error) {
            console.error(`❌ Error en "${eventData.name}": ${error.message}`);
            errorCount++;
          }
        }
        break;

      case '2':
        console.log('🔄 Modo: Actualizar existentes y agregar nuevos (upsert)\n');
        for (const eventData of validEvents) {
          try {
            const result = await CatalogEvent.findOneAndUpdate(
              { name: eventData.name },
              {
                $set: {
                  parent: eventData.parent,
                  motivoDefault: eventData.motivoDefault || '',
                  description: eventData.description || '',
                  enabled: eventData.enabled !== false
                }
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            
            if (result) {
              const action = result.createdAt && result.updatedAt && 
                new Date(result.createdAt).getTime() === new Date(result.updatedAt).getTime() 
                ? 'Insertado' : 'Actualizado';
              console.log(`✅ ${action}: ${eventData.name}`);
              if (action === 'Insertado') insertedCount++;
              else updatedCount++;
            }
          } catch (error) {
            console.error(`❌ Error en "${eventData.name}": ${error.message}`);
            errorCount++;
          }
        }
        break;

      case '3':
        console.log('⚠️  Modo: ELIMINAR TODOS Y REIMPORTAR\n');
        console.log('⏳ Esperando 3 segundos... (Ctrl+C para cancelar)');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const deleteResult = await CatalogEvent.deleteMany({});
        console.log(`🗑️  Eliminados: ${deleteResult.deletedCount} eventos`);
        
        const bulkResult = await CatalogEvent.insertMany(
          validEvents.map(e => ({
            name: e.name,
            parent: e.parent,
            motivoDefault: e.motivoDefault || '',
            description: e.description || '',
            enabled: e.enabled !== false
          }))
        );
        insertedCount = bulkResult.length;
        console.log(`✅ Insertados: ${insertedCount} eventos`);
        break;

      default:
        throw new Error('Modo de importación inválido');
    }

    // Resumen
    console.log('\n📊 RESUMEN DE IMPORTACIÓN:');
    console.log(`✅ Insertados: ${insertedCount}`);
    if (updatedCount > 0) console.log(`🔄 Actualizados: ${updatedCount}`);
    if (skippedCount > 0) console.log(`⏭️  Omitidos (ya existían): ${skippedCount}`);
    if (errorCount > 0) console.log(`❌ Errores: ${errorCount}`);
    console.log(`📈 Total procesados: ${validEvents.length}`);

    // Mostrar conteo final
    const totalInDB = await CatalogEvent.countDocuments();
    console.log(`\n💾 Total de eventos en BD: ${totalInDB}`);

    await mongoose.connection.close();
    console.log('\n✅ Importación completada');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error durante la importación:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Validar argumentos
if (process.argv.length < 3) {
  console.error('❌ Uso: node scripts/import-catalog-events.js <archivo.json> [modo]');
  console.error('\nModos disponibles:');
  console.error('  1 - Insertar solo nuevos (por defecto)');
  console.error('  2 - Actualizar existentes y agregar nuevos');
  console.error('  3 - Eliminar todos y reimportar (PELIGROSO)');
  console.error('\nEjemplo: node scripts/import-catalog-events.js eventos.json 1');
  process.exit(1);
}

const filePath = path.resolve(process.argv[2]);

if (!fs.existsSync(filePath)) {
  console.error(`❌ Archivo no encontrado: ${filePath}`);
  process.exit(1);
}

// Ejecutar importación
importCatalogEvents(filePath);
