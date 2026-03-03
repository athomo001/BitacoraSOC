const mongoose = require('mongoose');
const Client = require('../models/Client');
const CatalogLogSource = require('../models/CatalogLogSource');
const Service = require('../models/Service');
const RaciEntry = require('../models/RaciEntry');
const ClientEscalationRule = require('../models/ClientEscalationRule');
require('dotenv').config();

const normalize = (value) => (value || '')
  .toString()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

async function migrateEscalationClients() {
  const report = {
    totalClients: 0,
    mappedByName: 0,
    createdLogSources: 0,
    updatedServices: 0,
    updatedRaciEntries: 0,
    updatedClientAlertRules: 0,
    unmapped: []
  };

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📡 Conectado a MongoDB');

    const clients = await Client.find().lean();
    report.totalClients = clients.length;

    if (clients.length === 0) {
      console.log('ℹ️ No hay clientes legacy para migrar.');
      return;
    }

    const existingLogSources = await CatalogLogSource.find().lean();
    const byNormalizedName = new Map();
    for (const source of existingLogSources) {
      byNormalizedName.set(normalize(source.name), source);
    }

    for (const client of clients) {
      const key = normalize(client.name);
      let targetLogSource = byNormalizedName.get(key);

      if (!targetLogSource) {
        targetLogSource = await CatalogLogSource.create({
          name: client.name,
          parent: 'Migrado Escalación',
          description: client.code ? `Migrado desde Client legacy (${client.code})` : 'Migrado desde Client legacy',
          enabled: client.active !== false
        });
        byNormalizedName.set(key, targetLogSource.toObject());
        report.createdLogSources += 1;
      } else {
        report.mappedByName += 1;
      }

      const [servicesResult, raciResult, alertRulesResult] = await Promise.all([
        Service.updateMany({ clientId: client._id }, { $set: { clientId: targetLogSource._id } }),
        RaciEntry.updateMany({ clientId: client._id }, { $set: { clientId: targetLogSource._id } }),
        ClientEscalationRule.updateMany({ clientId: client._id }, { $set: { clientId: targetLogSource._id } })
      ]);

      report.updatedServices += servicesResult.modifiedCount || 0;
      report.updatedRaciEntries += raciResult.modifiedCount || 0;
      report.updatedClientAlertRules += alertRulesResult.modifiedCount || 0;

      if (!targetLogSource?._id) {
        report.unmapped.push({
          clientId: String(client._id),
          clientName: client.name
        });
      }
    }

    console.log('✅ Migración finalizada');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('❌ Error en migración:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

migrateEscalationClients();
