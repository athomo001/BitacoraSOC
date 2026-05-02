/**
 * File Purpose: backend/src/routes/system.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const SmtpConfig = require('../models/SmtpConfig');
const GlpiConfig = require('../models/GlpiConfig');
const LogForwardingConfig = require('../models/LogForwardingConfig');

const router = express.Router();

const buildServiceStatus = (status, detail, lastCheckAt = null) => ({
  status,
  detail,
  lastCheckAt,
  checkedAt: new Date().toISOString()
});

router.get('/health-summary', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const [smtpConfig, glpiConfig, logForwardingConfig] = await Promise.all([
      SmtpConfig.findOne().select('lastTestSuccess lastTestDate host port isActive').lean(),
      GlpiConfig.findOne().select('enabled mode lastTestSuccess lastTestDate lastTestMessage').lean(),
      LogForwardingConfig.findOne().select('enabled transport host port lastTestResult').lean()
    ]);

    const mongoReadyState = mongoose.connection.readyState;
    const mongoStatus = mongoReadyState === 1 ? 'ok' : (mongoReadyState === 2 ? 'warn' : 'down');
    const mongoDetail = mongoReadyState === 1
      ? 'Conectado'
      : mongoReadyState === 2
        ? 'Conectando'
        : 'Desconectado';

    let smtpStatus = 'warn';
    let smtpDetail = 'Sin pruebas recientes';
    if (!smtpConfig) {
      smtpStatus = 'warn';
      smtpDetail = 'Sin configuración SMTP';
    } else if (smtpConfig.lastTestSuccess === true) {
      smtpStatus = 'ok';
      smtpDetail = `Conectado (${smtpConfig.host}:${smtpConfig.port})`;
    } else if (smtpConfig.lastTestSuccess === false) {
      smtpStatus = 'down';
      smtpDetail = `Última prueba fallida (${smtpConfig.host}:${smtpConfig.port})`;
    }

    const glpiEnabled = !!glpiConfig?.enabled;
    const glpiLastSuccess = glpiConfig?.lastTestSuccess;
    const logEnabled = !!logForwardingConfig?.enabled;
    const logLastSuccess = logForwardingConfig?.lastTestResult?.success;

    let integrationsStatus = 'warn';
    let integrationsDetail = 'Sin integraciones habilitadas';

    if (glpiEnabled || logEnabled) {
      const components = [];
      const hasFailure = (glpiEnabled && glpiLastSuccess === false) || (logEnabled && logLastSuccess === false);
      const hasSuccess = (glpiEnabled && glpiLastSuccess === true) || (logEnabled && logLastSuccess === true);

      if (glpiEnabled) {
        components.push(`GLPI:${glpiLastSuccess === true ? 'OK' : glpiLastSuccess === false ? 'FAIL' : 'SIN TEST'}`);
      }
      if (logEnabled) {
        components.push(`LogForward:${logLastSuccess === true ? 'OK' : logLastSuccess === false ? 'FAIL' : 'SIN TEST'}`);
      }

      integrationsStatus = hasFailure ? 'down' : (hasSuccess ? 'ok' : 'warn');
      integrationsDetail = components.join(' | ');
    }

    const nowIso = new Date().toISOString();
    return res.json({
      checkedAt: nowIso,
      services: {
        smtp: buildServiceStatus(smtpStatus, smtpDetail, smtpConfig?.lastTestDate || null),
        mongo: buildServiceStatus(mongoStatus, mongoDetail, nowIso),
        internalApi: buildServiceStatus('ok', 'API interna operativa', nowIso),
        integrations: buildServiceStatus(
          integrationsStatus,
          integrationsDetail,
          glpiConfig?.lastTestDate || logForwardingConfig?.lastTestResult?.timestamp || null
        )
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Error obteniendo estado de salud',
      error: error.message
    });
  }
});

module.exports = router;
