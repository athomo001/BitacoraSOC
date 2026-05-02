/**
 * File Purpose: backend/src/scripts/seed-admin.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bitacora_soc';

// Models
const User = require('../models/User');

async function runAdminSeed() {
    try {
        console.log('--- Iniciando Semilla Exclusiva: ROOT ADMIN ---');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado a MongoDB');

        const adminUser = process.env.ADMIN_USERNAME || 'admin';
        const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!';

        // Revisar si ya existe el usuario admin
        const existingAdmin = await User.findOne({ username: adminUser });

        if (existingAdmin) {
            console.log(`⚠️ El usuario administrador maestro (${adminUser}) ya existe en la base de datos.`);
            console.log(`🔑 Las credenciales definidas actualmente para inyectar son: ${adminUser} / ${adminPass}`);
            console.log('Operación abortada por seguridad para no sobreescribir la contraseña real.');
            process.exit(0);
        }

        // Crear únicamente el Admin
        await User.create({
            username: adminUser,
            password: adminPass,
            email: process.env.ADMIN_EMAIL || 'admin@example.com',
            fullName: 'Administrador Maestro SOC',
            role: 'admin',
            cargoLabel: 'Líder Técnico SOC',
            isActive: true,
            theme: 'dark'
        });

        console.log('✅ Usuario Super Admin creado exitosamente.');
        console.log(`Acceso: ${adminUser} / ${adminPass}`);
        console.log('\n🚀 ENTORNO BASE (SOLO USUARIO) LISTO.');

        process.exit(0);

    } catch (error) {
        console.error('❌ Error fatal en seed de admin:', error);
        process.exit(1);
    }
}

runAdminSeed();
