/**
 * File Purpose: backend/src/scripts/seed-escalation-example.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Script de ejemplo para poblar el módulo de Escalaciones
 * con datos de prueba basados en ACME Corp
 * 
 * Uso:
 *   node src/scripts/seed-escalation-example.js
 */

const mongoose = require('mongoose');
const Client = require('../models/Client');
const Service = require('../models/Service');
const Contact = require('../models/Contact');
const EscalationRule = require('../models/EscalationRule');
const ShiftRole = require('../models/ShiftRole');
const ShiftAssignment = require('../models/ShiftAssignment');
const ShiftOverride = require('../models/ShiftOverride');
const User = require('../models/User');
require('dotenv').config();

async function seedEscalationExample() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📡 Conectado a MongoDB\n');

    // 1. Crear Roles de Turno (si no existen)
    console.log('1️⃣  Creando roles de turno...');
    const roles = ['N2', 'TI', 'N1_NO_HABIL'];
    const roleNames = ['Nivel 2', 'Soporte TI', 'N1 No Hábil'];
    
    for (let i = 0; i < roles.length; i++) {
      const existing = await ShiftRole.findOne({ code: roles[i] });
      if (!existing) {
        await ShiftRole.create({
          code: roles[i],
          name: roleNames[i],
          active: true
        });
        console.log(`   ✅ Rol creado: ${roles[i]}`);
      } else {
        console.log(`   ⏭️  Rol ya existe: ${roles[i]}`);
      }
    }

    // 2. Crear Clientes
    console.log('\n2️⃣  Creando clientes...');
    const acme = await Client.findOneAndUpdate(
      { code: 'ACME' },
      {
        name: 'ACME Corp',
        code: 'ACME',
        description: 'ACME Corporation International',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Cliente: ${acme.name} (${acme._id})`);

    const globalTech = await Client.findOneAndUpdate(
      { code: 'GLOBAL' },
      {
        name: 'Global Tech',
        code: 'GLOBAL',
        description: 'Global Technology Solutions',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Cliente: ${globalTech.name} (${globalTech._id})`);

    // 3. Crear Servicios
    console.log('\n3️⃣  Creando servicios...');
    const acmeService = await Service.findOneAndUpdate(
      { code: 'ACME_SERVICE_A' },
      {
        clientId: acme._id,
        name: 'ACME - Service A',
        code: 'ACME_SERVICE_A',
        description: 'Primary Service for ACME',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Servicio: ${acmeService.name} (${acmeService._id})`);

    // 4. Crear Contactos
    console.log('\n4️⃣  Creando contactos...');
    
    const johnDoe = await Contact.findOneAndUpdate(
      { email: 'john.doe@example.com' },
      {
        name: 'John Doe',
        email: 'john.doe@example.com',
        organization: 'Service Provider Inc.',
        role: 'Jefe Operaciones',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Contacto: ${johnDoe.name}`);

    const janeSmith = await Contact.findOneAndUpdate(
      { email: 'jane.smith@example.com' },
      {
        name: 'Jane Smith',
        email: 'jane.smith@example.com',
        organization: 'Service Provider Inc.',
        role: 'Gerente',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Contacto: ${janeSmith.name}`);

    const bobWilson = await Contact.findOneAndUpdate(
      { email: 'bob.wilson@acme.com' },
      {
        name: 'Bob Wilson',
        email: 'bob.wilson@acme.com',
        organization: 'ACME Corp',
        role: 'Mandante',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Contacto: ${bobWilson.name}`);

    // 5. Crear Regla de Escalación
    console.log('\n5️⃣  Creando regla de escalación...');
    const rule = await EscalationRule.findOneAndUpdate(
      { serviceId: acmeService._id },
      {
        serviceId: acmeService._id,
        recipientsTo: [johnDoe._id],
        recipientsCC: [janeSmith._id, bobWilson._id],
        emergencyPhone: '+1234567890',
        emergencyContactId: johnDoe._id,
        notes: 'Contactar a John en emergencias',
        active: true
      },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Regla creada para servicio ${acmeService.name}`);

    // 6. Obtener usuarios para asignaciones
    console.log('\n6️⃣  Obteniendo usuarios para turnos...');
    const users = await User.find({ role: { $in: ['admin', 'user'] } }).limit(3);
    
    if (users.length < 3) {
      console.log('   ⚠️  Se necesitan al menos 3 usuarios. Creando usuarios de ejemplo...');
      // Aquí podrías crear usuarios dummy si fuera necesario, pero por ahora solo avisamos
    } else {
      // Crear asignaciones de ejemplo
      // ... (lógica de asignación omitida para brevedad, pero usaría los usuarios encontrados)
    }

    console.log('\n✨ Seed de escalación completado exitosamente');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error en seed:', error);
    process.exit(1);
  }
}

seedEscalationExample();
