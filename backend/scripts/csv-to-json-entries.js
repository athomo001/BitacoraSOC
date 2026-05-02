/**
 * File Purpose: backend/scripts/csv-to-json-entries.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

/**
 * Script para convertir CSV de entradas antiguas a JSON para importación
 * 
 * Formato CSV de entrada:
 * id,email,date,text,tags
 * 
 * Formato JSON de salida:
 * [{ content, entryType, entryDate, entryTime, _username }]
 * 
 * Uso:
 * node scripts/csv-to-json-entries.js input.csv output.json
 */

const fs = require('fs');
const path = require('path');

// Usuarios permitidos (solo estos se importarán)
const ALLOWED_USERS = ['mfuentes', 'pveloso'];

// Mapa de correcciones UTF-8 comunes
const UTF8_FIXES = {
  '\u00C3\u00B3': 'ó',
  '\u00C3\u00A1': 'á',
  '\u00C3\u00A9': 'é',
  '\u00C3\u00AD': 'í',
  '\u00C3\u00BA': 'ú',
  '\u00C3\u00B1': 'ñ',
  'Ã³': 'ó',
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ãº': 'ú',
  'Ã±': 'ñ'
};

// Función para corregir texto con problemas de encoding
function fixUTF8(text) {
  if (!text) return text;
  let fixed = text;
  
  // Reemplazos básicos
  fixed = fixed.replace(/Ã³/g, 'ó');
  fixed = fixed.replace(/Ã¡/g, 'á');
  fixed = fixed.replace(/Ã©/g, 'é');
  fixed = fixed.replace(/Ã­/g, 'í');
  fixed = fixed.replace(/Ãº/g, 'ú');
  fixed = fixed.replace(/Ã±/g, 'ñ');
  fixed = fixed.replace(/Ã"/g, 'Ó');
  fixed = fixed.replace(/Ã/g, 'Á');
  fixed = fixed.replace(/Ã‰/g, 'É');
  fixed = fixed.replace(/Ã/g, 'Í');
  fixed = fixed.replace(/Ãš/g, 'Ú');
  fixed = fixed.replace(/Ã'/g, 'Ñ');
  
  return fixed;
}

function parseCSV(csvContent) {
  const entries = [];
  const lines = csvContent.split('\n');
  
  // Primera línea son los headers
  let i = 0;
  const headerLine = lines[i++];
  const headers = [];
  let current = '';
  let inQuotes = false;
  
  // Parse headers
  for (let j = 0; j < headerLine.length; j++) {
    const char = headerLine[j];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim());

  // Parse cada entrada (puede ocupar múltiples líneas)
  while (i < lines.length) {
    const values = [];
    let current = '';
    let inQuotes = false;
    let currentFieldIndex = 0;

    // Leer hasta completar todos los campos (5: id,email,date,text,tags)
    while (i < lines.length && currentFieldIndex < headers.length) {
      const line = lines[i];
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          // Toggle quotes, pero NO agregamos las comillas al contenido
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          // Fin de campo
          values.push(current);
          current = '';
          currentFieldIndex++;
        } else {
          current += char;
        }
      }

      // Si estamos dentro de comillas, agregar el salto de línea
      if (inQuotes) {
        current += '\n';
        i++;
      } else {
        // Agregar el último campo de esta línea
        if (currentFieldIndex === headers.length - 1) {
          values.push(current);
          current = '';
          currentFieldIndex++;
        }
        i++;
        break;
      }
    }

    // Si completamos una entrada
    if (values.length === headers.length) {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = values[index].trim();
      });
      entries.push(entry);
    }
  }

  return entries;
}

function parseDate(dateStr) {
  // Intenta varios formatos de fecha
  // Ejemplos: "2025-12-17 14:30", "2025-12-17T14:30:00", "17/12/2025 14:30"
  
  let date, time;

  // Formato ISO: 2025-12-17T14:30:00 o 2025-12-17 14:30
  if (dateStr.includes('T') || dateStr.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)) {
    const parts = dateStr.split(/[T\s]+/);
    date = parts[0]; // YYYY-MM-DD
    time = parts[1] ? parts[1].substring(0, 5) : '00:00'; // HH:MM
  }
  // Formato DD/MM/YYYY HH:MM
  else if (dateStr.match(/\d{2}\/\d{2}\/\d{4}/)) {
    const [datePart, timePart] = dateStr.split(' ');
    const [day, month, year] = datePart.split('/');
    date = `${year}-${month}-${day}`;
    time = timePart || '00:00';
  }
  // Solo fecha YYYY-MM-DD
  else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = dateStr;
    time = '00:00';
  }
  else {
    // Intento con Date parser
    const d = new Date(dateStr);
    if (!isNaN(d)) {
      date = d.toISOString().split('T')[0];
      time = d.toTimeString().substring(0, 5);
    } else {
      console.warn(`⚠️  No se pudo parsear fecha: ${dateStr}, usando fecha actual`);
      date = new Date().toISOString().split('T')[0];
      time = '00:00';
    }
  }

  return { date, time };
}

function convertCSVToJSON(csvEntries) {
  const jsonEntries = [];
  let skipped = 0;
  let wrongUser = 0;

  for (const entry of csvEntries) {
    try {
      // Validar campos requeridos
      if (!entry.text || !entry.date) {
        console.warn(`⚠️  Entrada sin text o date: id=${entry.id}`);
        skipped++;
        continue;
      }

      // Extraer y validar username del email
      let username = '';
      if (entry.email && entry.email.includes('@')) {
        username = entry.email.split('@')[0].toLowerCase().trim();
      } else {
        console.warn(`⚠️  Email inválido en entrada id=${entry.id}: ${entry.email}`);
        skipped++;
        continue;
      }

      // Solo permitir usuarios de la lista
      if (!ALLOWED_USERS.includes(username)) {
        console.warn(`⚠️  Usuario no permitido: ${username} (id=${entry.id})`);
        wrongUser++;
        continue;
      }

      // Parsear fecha y hora
      const { date, time } = parseDate(entry.date);

      // Corregir encoding UTF-8 en texto y tags
      const cleanText = fixUTF8(entry.text.trim());
      const cleanTags = entry.tags ? fixUTF8(entry.tags) : '';

      // Construir contenido con tags
      let content = cleanText;
      
      // Agregar tags como hashtags si existen
      if (cleanTags) {
        const tagsArray = cleanTags.split(',').map(t => t.trim()).filter(t => t);
        // Si el contenido no tiene los tags como hashtags, agregarlos
        tagsArray.forEach(tag => {
          if (!content.includes(`#${tag}`)) {
            content += ` #${tag}`;
          }
        });
      }

      // Tipo de entrada siempre operativa
      const entryType = 'operativa';

      // Crear entrada en nuevo formato
      jsonEntries.push({
        content: content,
        entryType: entryType,
        entryDate: date,
        entryTime: time,
        _username: username,
        _originalId: entry.id,
        _originalEmail: entry.email
      });

    } catch (error) {
      console.error(`❌ Error procesando entrada id=${entry.id}: ${error.message}`);
      skipped++;
    }
  }

  console.log(`\n✅ Convertidas: ${jsonEntries.length}`);
  if (wrongUser > 0) console.log(`⚠️  Usuario no permitido: ${wrongUser} (solo se aceptan: ${ALLOWED_USERS.join(', ')})`);
  if (skipped > 0) console.log(`⚠️  Omitidas (error): ${skipped}`);

  return jsonEntries;
}

// Main
if (process.argv.length < 4) {
  console.error('❌ Uso: node scripts/csv-to-json-entries.js <input.csv> <output.json>');
  console.error('\nEjemplo: node scripts/csv-to-json-entries.js entradas.csv entradas-convertidas.json');
  process.exit(1);
}

const inputFile = path.resolve(process.argv[2]);
const outputFile = path.resolve(process.argv[3]);

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Archivo no encontrado: ${inputFile}`);
  process.exit(1);
}

console.log('📂 Leyendo CSV...');
const csvContent = fs.readFileSync(inputFile, 'utf8');

console.log('🔄 Parseando CSV...');
const csvEntries = parseCSV(csvContent);
console.log(`📊 ${csvEntries.length} entradas encontradas en CSV`);

console.log('🔄 Convirtiendo a formato JSON...');
const jsonEntries = convertCSVToJSON(csvEntries);

console.log(`💾 Guardando en: ${outputFile}`);
fs.writeFileSync(outputFile, JSON.stringify(jsonEntries, null, 2), 'utf8');

console.log('\n✅ Conversión completada');
console.log(`\n📝 Siguiente paso:`);
console.log(`   1. Revisa el archivo: ${outputFile}`);
console.log(`   2. Edita manualmente si es necesario`);
console.log(`   3. Importa con: node scripts/import-entries.js ${outputFile} admin`);
