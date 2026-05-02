/**
 * File Purpose: backend/scripts/import-entries.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

/**
 * Script para importar entradas de bitácora de forma masiva desde un archivo JSON
 * 
 * Uso:
 * 1. Crea un archivo JSON con tus entradas (ej: entradas.json)
 * 2. Ejecuta: node scripts/import-entries.js <ruta-al-archivo.json> <username>
 * 
 * Formato del JSON:
 * [
 *   {
 *     "content": "Texto de la entrada con #tags",
 *     "entryType": "operativa",
 *     "entryDate": "2025-12-17",
 *     "entryTime": "14:30"
 *   }
 * ]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Entry = require('../src/models/Entry');
const User = require('../src/models/User');

const MONGODB_URI = process.env.MONGODB_URI || 
  `mongodb://${process.env.MONGO_ROOT_USER}:${process.env.MONGO_ROOT_PASSWORD}@localhost:27017/${process.env.MONGO_DATABASE}?authSource=admin`;

// Extraer tags del contenido (#tag)
function extractTags(content) {
  const tagPattern = /#(\w+)/g;
  const tags = [];
  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return [...new Set(tags)]; // Eliminar duplicados
}

async function importEntries(filePath, defaultUsername) {
  try {
    // Conectar a MongoDB
    console.log('📡 Conectando a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado a MongoDB');

    // Leer archivo JSON
    console.log(`📂 Leyendo archivo: ${filePath}`);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const entries = JSON.parse(fileContent);

    if (!Array.isArray(entries)) {
      throw new Error('El archivo JSON debe contener un array de entradas');
    }

    console.log(`📊 Se encontraron ${entries.length} entradas para importar\n`);

    // Validar estructura básica
    const invalidEntries = entries.filter(e => !e.content || !e.entryType || !e.entryDate || !e.entryTime);
    if (invalidEntries.length > 0) {
      console.warn(`⚠️  ${invalidEntries.length} entradas no tienen campos requeridos y serán omitidas`);
      console.warn('   Campos requeridos: content, entryType, entryDate, entryTime\n');
    }

    const validEntries = entries.filter(e => e.content && e.entryType && e.entryDate && e.entryTime);

    let insertedCount = 0;
    let errorCount = 0;
    const userCache = {}; // Cache de usuarios para no buscar repetidamente

    console.log('📝 Importando entradas...\n');
    
    for (const entryData of validEntries) {
      try {
        // Determinar username (del JSON o default)
        const username = entryData._username || defaultUsername;
        
        // Buscar usuario en cache o en BD
        let user = userCache[username];
        if (!user) {
          user = await User.findOne({ username });
          if (!user) {
            console.warn(`⚠️  Usuario "${username}" no encontrado, usando "${defaultUsername}"`);
            user = await User.findOne({ username: defaultUsername });
            if (!user) {
              throw new Error(`Usuario por defecto "${defaultUsername}" no encontrado`);
            }
          }
          userCache[username] = user;
        }
        // Validar entryType
        if (!['operativa', 'incidente'].includes(entryData.entryType)) {
          throw new Error(`entryType inválido: ${entryData.entryType}. Debe ser "operativa" o "incidente"`);
        }

        // Validar formato de fecha (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entryData.entryDate)) {
          throw new Error(`Formato de fecha inválido: ${entryData.entryDate}. Use YYYY-MM-DD`);
        }

        // Validar formato de hora (HH:MM)
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(entryData.entryTime)) {
          throw new Error(`Formato de hora inválido: ${entryData.entryTime}. Use HH:MM (24h)`);
        }

        // Extraer tags del contenido
        const tags = extractTags(entryData.content);

        // Crear entrada
        const entry = await Entry.create({
          content: entryData.content,
          entryType: entryData.entryType,
          entryDate: entryData.entryDate,
          entryTime: entryData.entryTime,
          tags: tags,
          createdBy: user._id,
          createdByUsername: user.username,
          isGuestEntry: user.role === 'guest'
        });

        console.log(`✅ [${entry.entryDate} ${entry.entryTime}] ${user.username} - ${entryData.entryType.toUpperCase()}: ${entryData.content.substring(0, 50)}...`);
        insertedCount++;

      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        console.error(`   Entrada: ${JSON.stringify(entryData).substring(0, 100)}...\n`);
        errorCount++;
      }
    }

    // Resumen
    console.log('\n📊 RESUMEN DE IMPORTACIÓN:');
    console.log(`✅ Insertadas: ${insertedCount}`);
    if (errorCount > 0) console.log(`❌ Errores: ${errorCount}`);
    console.log(`📈 Total procesadas: ${validEntries.length}`);

    // Mostrar conteo final por usuario
    console.log(`\n💾 Resumen por usuario:`);
    for (const [username, user] of Object.entries(userCache)) {
      const count = await Entry.countDocuments({ createdBy: user._id });
      console.log(`   ${username}: ${count} entradas`);
    }

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
if (process.argv.length < 4) {
  console.error('❌ Uso: node scripts/import-entries.js <archivo.json> <username>');
  console.error('\nEjemplo: node scripts/import-entries.js entradas.json admin');
  console.error('\nFormato del JSON:');
  console.error(`[
  {
    "content": "Revisión de alertas en #Trellix. Todo operativo. #hunting",
    "entryType": "operativa",
    "entryDate": "2025-12-17",
    "entryTime": "14:30"
  },
  {
    "content": "Incidente detectado en #QRadar: múltiples fallos de autenticación #incidente",
    "entryType": "incidente",
    "entryDate": "2025-12-17",
    "entryTime": "15:45"
  }
]`);
  process.exit(1);
}

const filePath = path.resolve(process.argv[2]);
const username = process.argv[3];

if (!fs.existsSync(filePath)) {
  console.error(`❌ Archivo no encontrado: ${filePath}`);
  process.exit(1);
}

// Ejecutar importación
importEntries(filePath, username);
