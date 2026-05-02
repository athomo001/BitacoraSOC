/**
 * File Purpose: backend/src/scripts/seed-services.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');
const ServiceCatalog = require('../models/ServiceCatalog');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bitacora_soc';

const defaultServices = [
  {
    title: 'Firewall Perimetral',
    description: 'Monitoreo del estado del firewall principal',
    category: 'Infraestructura',
    isActive: true
  },
  {
    title: 'IDS/IPS',
    description: 'Sistema de detección y prevención de intrusiones',
    category: 'Seguridad',
    isActive: true
  },
  {
    title: 'SIEM',
    description: 'Plataforma de gestión de eventos de seguridad',
    category: 'Monitoreo',
    isActive: true
  },
  {
    title: 'Antivirus Corporativo',
    description: 'Estado de antivirus en endpoints',
    category: 'Endpoint',
    isActive: true
  },
  {
    title: 'VPN',
    description: 'Conectividad VPN para acceso remoto',
    category: 'Infraestructura',
    isActive: true
  },
  {
    title: 'Backup',
    description: 'Respaldos automatizados',
    category: 'Continuidad',
    isActive: true
  }
];

async function seedServices() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const existingCount = await ServiceCatalog.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠️  Ya existen ${existingCount} servicios. No se requiere seed.`);
      process.exit(0);
    }

    await ServiceCatalog.insertMany(defaultServices);
    console.log(`✅ ${defaultServices.length} servicios creados exitosamente`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en seed:', error.message);
    process.exit(1);
  }
}

seedServices();
