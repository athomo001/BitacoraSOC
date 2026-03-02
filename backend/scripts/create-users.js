/**
 * Script para crear usuarios pveloso y mfuentes
 * Uso: node scripts/create-users.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('../src/models/User');

const User = mongoose.model('User');

async function createUsers() {
  try {
    console.log('📡 Conectando a MongoDB...');

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bitacora_soc';
    await mongoose.connect(mongoUri);

    console.log('✅ Conectado a MongoDB');

    const defaultPassword = process.env.INITIAL_USERS_PASSWORD;
    if (!defaultPassword) {
      console.error('❌ Error: Requerida variable de entorno INITIAL_USERS_PASSWORD');
      process.exit(1);
    }

    const users = [
      {
        username: 'pveloso',
        email: 'pveloso@netics.cl',
        password: defaultPassword,
        fullName: 'Pablo Veloso',
        role: 'analyst'
      },
      {
        username: 'mfuentes',
        email: 'mfuentes@netics.cl',
        password: defaultPassword,
        fullName: 'Matías Fuentes',
        role: 'analyst'
      }
    ];

    for (const userData of users) {
      // Verificar si ya existe
      const existing = await User.findOne({ username: userData.username });

      if (existing) {
        console.log(`⚠️  Usuario ${userData.username} ya existe`);
        continue;
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);

      // Crear usuario
      const user = new User({
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        fullName: userData.fullName,
        role: userData.role,
        isActive: true
      });

      await user.save();
      console.log(`✅ Usuario ${userData.username} creado`);
    }

    console.log('🎉 Proceso completado');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Conexión cerrada');
  }
}

createUsers();
