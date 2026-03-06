const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.resolve(__dirname, 'backend/backup_sanitized.json');
const OUTPUT_FILE = path.resolve(__dirname, 'backend/backup_final.json');

if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ Input file not found: ${INPUT_FILE}`);
    process.exit(1);
}

const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
let content = rawData;

// 1. Mapeo de Reemplazos Globales (Regex insensibles a mayúsculas)
const replacements = [
    { regex: /netics/gi, replacement: 'BitacoraSOC' },
    { regex: /synet/gi, replacement: 'GlobalSOC' },
    { regex: /socradar/gi, replacement: 'ThreatIntel' },
    { regex: /qradar/gi, replacement: 'SIEM-Master' },
    { regex: /scj/gi, replacement: 'Ente-Regulador' },
    { regex: /pjud/gi, replacement: 'Poder-Judicial-G' },
    { regex: /junji/gi, replacement: 'Edu-Infantil' },
    { regex: /dpp/gi, replacement: 'Defensa-Pub' },
    { regex: /afpmodelo/gi, replacement: 'AFP-Generica' },
    { regex: /gnlquintero/gi, replacement: 'Energia-Corp' },
    { regex: /indap/gi, replacement: 'Agro-Gob' },
    { regex: /casinos/gi, replacement: 'Retail-G' },
    { regex: /pveloso/gi, replacement: 'analista_1' },
    { regex: /otics/gi, replacement: 'Soporte-TI' },
    { regex: /110592/gi, replacement: '999999' }
];

console.log('--- Iniciando Sanitización Profunda ---');

replacements.forEach(({ regex, replacement }) => {
    const count = (content.match(regex) || []).length;
    if (count > 0) {
        console.log(`🧹 Reemplazando "${regex}" (${count} veces) -> "${replacement}"`);
        content = content.replace(regex, replacement);
    }
});

// 2. Parsear para limpieza estructural (Tags)
let dataObj = JSON.parse(content);
const records = dataObj.data || dataObj;

if (records.entries) {
    console.log(`🏷️ Limpiando tags en ${records.entries.length} entradas...`);
    records.entries.forEach(entry => {
        if (entry.tags && Array.isArray(entry.tags)) {
            entry.tags = entry.tags.map(tag => {
                let cleaned = tag.toLowerCase();
                // Si el tag es uno de los prohibidos o contiene uno, lo hacemos genérico
                if (/scj|pjud|junji|indap|netics|socradar|qradar|afp|gnl|casinos/.test(cleaned)) {
                    return 'soc_generico';
                }
                return cleaned;
            });
        }
    });
}

// 3. Forzar nombres de clientes genéricos si alguno se escapó
if (records.entries) {
    records.entries.forEach(entry => {
        if (entry.clientName && /scj|pjud|junji|indap|netics|afp|gnl|casinos/i.test(entry.clientName)) {
            entry.clientName = "Empresa Alpha";
        }
    });
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dataObj, null, 2));
console.log(`✅ Sanitización profunda completada. Guardado en: ${OUTPUT_FILE}`);
