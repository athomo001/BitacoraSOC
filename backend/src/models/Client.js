/**
 * File Purpose: backend/src/models/Client.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Índices
clientSchema.index({ active: 1 });

// Generar code si no viene (slug del nombre)
clientSchema.pre('save', function(next) {
  if (!this.code && this.name) {
    this.code = this.name
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/[^a-zA-Z0-9]+/g, '_')                   // reemplazar no alfanum
      .replace(/^_+|_+$/g, '')                          // quitar guiones extremos
      .toLowerCase();
  }
  next();
});

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;
