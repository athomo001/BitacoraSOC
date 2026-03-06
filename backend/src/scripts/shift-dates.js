const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bitacora_soc';
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');

async function shiftDates() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado a MongoDB para Shift de Fechas');

        const entries = await Entry.find({}).sort({ entryDate: -1 });
        if (entries.length === 0) {
            console.log('No hay entradas para mover');
            process.exit(0);
        }

        // The most recent entry in the DB
        const latestDate = new Date(entries[0].entryDate).getTime();
        const now = new Date().getTime();

        // Difference between now and the most recent entry
        const timeDelta = now - latestDate;

        console.log(`Moviendo ${entries.length} entradas en el tiempo por ${timeDelta / (1000 * 3600 * 24)} días hacia el presente...`);

        let updated = 0;
        for (const entry of entries) {
            if (entry.entryDate) {
                entry.entryDate = new Date(new Date(entry.entryDate).getTime() + timeDelta);
            }
            if (entry.createdAt) {
                entry.createdAt = new Date(new Date(entry.createdAt).getTime() + timeDelta);
            }
            if (entry.updatedAt) {
                entry.updatedAt = new Date(new Date(entry.updatedAt).getTime() + timeDelta);
            }
            await entry.save({ timestamps: false }); // Avoid auto-updating updatedAt
            updated++;
        }

        const checks = await ShiftCheck.find({});
        for (const chk of checks) {
            if (chk.createdAt) {
                chk.createdAt = new Date(new Date(chk.createdAt).getTime() + timeDelta);
            }
            if (chk.updatedAt) {
                chk.updatedAt = new Date(new Date(chk.updatedAt).getTime() + timeDelta);
            }
            await chk.save({ timestamps: false });
        }

        console.log(`✅ ${updated} entradas y ${checks.length} checklists movidas a fechas recientes (Hoy).`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error shifting dates:', error);
        process.exit(1);
    }
}

shiftDates();
