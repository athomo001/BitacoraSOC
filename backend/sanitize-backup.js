const fs = require('fs');

const inputFile = './backup.json';
const outputFile = './backup_sanitized.json';

try {
    console.log('Leyendo backup.json...');
    const rawData = fs.readFileSync(inputFile, 'utf8');
    const parsed = JSON.parse(rawData);

    // Support both direct array/object or nested in .data
    const data = parsed.data ? parsed.data : parsed;
    const root = parsed.data ? parsed : null;

    // 1. Sanitizar Users
    if (data.users && Array.isArray(data.users)) {
        console.log(`Sanitizando ${data.users.length} usuarios...`);
        data.users = data.users.map((user, index) => {
            if (user.username === 'admin') {
                user.password = '$2b$10$EpA0dZ6C1gHwE1T6z/J.Z.hF7lU99vS6V1D50fT0E51O5eT5I1Z9a'; // Admin123!
                user.email = 'admin@soc.local';
                user.fullName = 'Administrador Maestro';
                return user;
            }
            return {
                ...user,
                username: `analista_${index}`,
                fullName: `Usuario Genérico ${index}`,
                email: `analista${index}@soc.local`,
                password: '$2b$10$EpA0dZ6C1gHwE1T6z/J.Z.hF7lU99vS6V1D50fT0E51O5eT5I1Z9a'
            };
        });
    }

    // 2. Mapeo de Clientes/LogSources
    const clientMap = {
        'netics': 'Empresa Alpha',
        'junji': 'Corp Beta',
        'dpp': 'Gob Gamma',
        'scj': 'Casino Delta',
        'pjud': 'Justicia Epsilon',
        'gnlquinteros': 'Energia Zeta',
        'afmodelo': 'Financiera Eta',
        'banco estado': 'Banco Theta',
        'bancoestado': 'Banco Theta',
        'sii': 'Impuestos Iota',
        'mineduc': 'Educacion Kappa'
    };

    const genericPrefix = 'Organizacion ';
    let genericCounter = 1;
    const idToNameMap = {};

    if (data.catalog_log_sources && Array.isArray(data.catalog_log_sources)) {
        console.log(`Sanitizando ${data.catalog_log_sources.length} Clientes (Log Sources)...`);
        data.catalog_log_sources = data.catalog_log_sources.map(source => {
            let originalName = (source.name || '').toLowerCase();
            let newName = null;

            for (const [key, value] of Object.entries(clientMap)) {
                if (originalName.includes(key)) {
                    newName = value;
                    break;
                }
            }

            if (!newName) {
                if (originalName.includes('netics') || originalName.includes('synet') || originalName.includes('soc')) {
                    newName = 'SOC Interno';
                } else {
                    newName = `${genericPrefix}${genericCounter++} (Demo)`;
                }
            }

            idToNameMap[source._id?.$oid || source._id] = newName;
            source.name = newName;
            source.description = `Descripción genérica para ${newName}`;
            return source;
        });
    }

    const sanitizeText = (text) => {
        if (!text || typeof text !== 'string') return text;
        let newText = text;
        for (const [key, value] of Object.entries(clientMap)) {
            const regex = new RegExp(key, 'gi');
            newText = newText.replace(regex, value);
        }
        // Simple email replacement
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
        newText = newText.replace(emailRegex, 'usuario@demo.local');
        // Replace names like Pveloso
        const pvelosoRegex = /Pveloso|PVeloso|pveloso/gi;
        newText = newText.replace(pvelosoRegex, 'Analista_X');
        return newText;
    };

    // Sanitizar Entradas
    if (data.entries && Array.isArray(data.entries)) {
        console.log(`Sanitizando ${data.entries.length} Entradas...`);
        data.entries = data.entries.map(entry => {
            if (entry.clientId) {
                const oId = entry.clientId.$oid || entry.clientId;
                if (idToNameMap[oId]) {
                    entry.clientName = idToNameMap[oId];
                } else {
                    entry.clientName = sanitizeText(entry.clientName) || 'Cliente Genérico';
                }
            } else if (entry.clientName) {
                entry.clientName = sanitizeText(entry.clientName);
            }

            const userIdObj = entry.createdBy?.$oid || entry.createdBy;
            // We didn't map usernames strictly by ID, so let's just make it generic
            entry.createdByUsername = entry.createdByUsername === 'admin' ? 'admin' : 'analista_generico';

            if (entry.title) entry.title = sanitizeText(entry.title);
            if (entry.content) entry.content = sanitizeText(entry.content);
            if (entry.description) entry.description = sanitizeText(entry.description);
            if (entry.investigationNotes) entry.investigationNotes = sanitizeText(entry.investigationNotes);
            if (entry.closureNotes) entry.closureNotes = sanitizeText(entry.closureNotes);
            if (entry.notes) entry.notes = sanitizeText(entry.notes);

            return entry;
        });
    }

    // Sanitizar Escalations
    if (data.escalations && Array.isArray(data.escalations)) {
        console.log(`Sanitizando ${data.escalations.length} Escalaciones...`);
        data.escalations = data.escalations.map(esc => {
            if (esc.client) esc.client = sanitizeText(esc.client);
            if (esc.contacts && Array.isArray(esc.contacts)) {
                esc.contacts = esc.contacts.map((c, i) => {
                    c.name = `Contacto ${i + 1}`;
                    c.email = `contacto@demo.local`;
                    if (c.phone) c.phone = '+56900000000';
                    return c;
                });
            }
            return esc;
        });
    }

    // Sanitizar Raci
    if (data.raci_matrices && Array.isArray(data.raci_matrices)) {
        console.log(`Sanitizando ${data.raci_matrices.length} RACI...`);
        data.raci_matrices = data.raci_matrices.map(raci => {
            if (raci.client) raci.client = sanitizeText(raci.client);
            return raci;
        });
    }

    // Sanitizar Checklists
    if (data.checklists && Array.isArray(data.checklists)) {
        console.log(`Sanitizando ${data.checklists.length} Checklists (instancias)...`);
        data.checklists = data.checklists.map(chk => {
            if (chk.notes) chk.notes = sanitizeText(chk.notes);
            if (chk.authorName && chk.authorName !== 'admin' && chk.authorName !== 'Super Admin' && chk.authorName !== 'Administrador Maestro') {
                chk.authorName = 'Analista Generico';
            }
            return chk;
        });
    }

    // Sanitizar Reportes Guardados
    if (data.saved_reports && Array.isArray(data.saved_reports)) {
        console.log(`Sanitizando ${data.saved_reports.length} reportes guardados...`);
        data.saved_reports = data.saved_reports.map(rep => {
            if (rep.title) rep.title = sanitizeText(rep.title);
            return rep;
        });
    }

    // Fix AppConfig defaultLogSourceId if available in map
    if (data.app_configs && Array.isArray(data.app_configs)) {
        // No real PII here usually, except defaults
    }

    console.log('Escribiendo backup_sanitized.json...');
    // Ensure we write back with the correct root structure
    const finalOutput = root ? root : data;
    fs.writeFileSync(outputFile, JSON.stringify(finalOutput, null, 2), 'utf8');
    console.log('¡Sanitización completada exitosamente!');

} catch (error) {
    console.error('Error procesando el backup:', error);
}
