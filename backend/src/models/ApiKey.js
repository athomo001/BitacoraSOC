/**
 * File Purpose: backend/src/models/ApiKey.js
 * Responsibilities: Definir el modelo de Mongoose para las claves de API (API Keys).
 * QA Notes: Almacena la versión hash (SHA-256) de la clave para evitar riesgos ante fugas.
 */

const mongoose = require('mongoose');

const ApiKeySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  key: {
    type: String,
    required: true,
    unique: true
  },
  prefix: {
    type: String,
    required: true,
    unique: true // Ejemplo: bsoc_key_a1b2
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'revoked', 'expired'],
    default: 'active'
  },
  permissions: {
    type: [String],
    required: true,
    default: [] // Scopes: 'users:read', 'events:read', 'events:write', 'escalations:read', 'templates:render'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expiresAt: {
    type: Date,
    default: null
  },
  lastUsedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Índices para acelerar la validación y búsqueda de las claves de API
ApiKeySchema.index({ prefix: 1, status: 1 });
ApiKeySchema.index({ key: 1 });

module.exports = mongoose.model('ApiKey', ApiKeySchema);
