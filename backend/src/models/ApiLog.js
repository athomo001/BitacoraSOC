/**
 * File Purpose: backend/src/models/ApiLog.js
 * Responsibilities: Definir el modelo de Mongoose para el historial de auditoría de la API (ApiLog).
 * QA Notes: Permite rastrear la IP, el método, el endpoint y el estado HTTP de cada llamada.
 */

const mongoose = require('mongoose');

const ApiLogSchema = new mongoose.Schema({
  apiKeyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ApiKey',
    default: null // Puede ser null si la petición falla antes de identificar una clave válida
  },
  apiKeyName: {
    type: String,
    default: 'Desconocido / Inválido'
  },
  endpoint: {
    type: String,
    required: true
  },
  method: {
    type: String,
    required: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  status: {
    type: Number,
    required: true // Código HTTP de respuesta
  },
  actionDetails: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('ApiLog', ApiLogSchema);
