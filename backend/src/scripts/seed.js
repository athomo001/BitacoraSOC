const mongoose = require('mongoose');
const path = require('path');
const User = require('../models/User');

// Cargar variables desde backend/.env y también desde raíz del repo (sin sobreescribir existentes)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// FIXED: Use MONGODB_URI to match .env file
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bitacora_soc';

const adminUser = {
  username: process.env.ADMIN_USERNAME,
  password: process.env.ADMIN_PASSWORD,
  email: process.env.ADMIN_EMAIL,
  fullName: 'Administrador',
  role: 'admin',
  theme: 'dark'
};

async function seedAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    if (!adminUser.username || !adminUser.password) {
      console.log('⚠️  Variables ADMIN_USERNAME y ADMIN_PASSWORD requeridas. Omitiendo creación de admin por defecto.');
      process.exit(0);
    }

    // Verificar si ya existe el admin configurado
    const existingAdmin = await User.findOne({ username: adminUser.username });
    if (existingAdmin) {
      existingAdmin.password = adminUser.password;
      existingAdmin.email = adminUser.email || existingAdmin.email;
      existingAdmin.fullName = adminUser.fullName;
      existingAdmin.role = 'admin';
      existingAdmin.theme = adminUser.theme || existingAdmin.theme;
      existingAdmin.isActive = true;

      await existingAdmin.save();

      console.log('✅ Usuario admin ya existía: contraseña actualizada según .env');
      console.log(`   Usuario: ${existingAdmin.username}`);
      process.exit(0);
    }

    // Crear admin
    // NOTA: No hashear aquí, el pre-save hook del modelo lo hará automáticamente
    const newAdmin = new User(adminUser);

    await newAdmin.save();
    console.log('✅ Usuario admin creado exitosamente');
    console.log(`   Usuario: ${adminUser.username}`);
    console.log(`   Contraseña: ${adminUser.password}`);
    console.log('   ⚠️  CAMBIA ESTA CONTRASEÑA INMEDIATAMENTE');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en seed:', error.message);
    process.exit(1);
  }
}

seedAdmin();
