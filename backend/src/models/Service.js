/**
 * File Purpose: backend/src/models/Service.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    required: true
  },
  name: {
    type: String,
    required: true,
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

// Índice compuesto: nombre único por cliente
serviceSchema.index({ clientId: 1, name: 1 }, { unique: true });
serviceSchema.index({ active: 1 });

// Generar code si no viene (slug del nombre + cliente)
serviceSchema.pre('save', function(next) {
  if (!this.code && this.name) {
    const slug = this.name
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    this.code = `${slug}_${this.clientId?.toString() || 'svc'}`;
  }
  next();
});

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;
