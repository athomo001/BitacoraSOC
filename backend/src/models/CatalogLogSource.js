/**
 * File Purpose: backend/src/models/CatalogLogSource.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Catálogo de Log Sources (Clientes / Fuentes de logs)
 * 
 * Catálogo de clientes y fuentes de logs monitoreadas.
 * Soporta búsqueda incremental server-side con índice de texto.
 * 
 * Campos:
 *   - name: Nombre del log source (ej: "Firewall Cisco ASA")
 *   - parent: Cliente o categoría (ej: "Cliente XYZ")
 *   - description: Detalle del log source
 *   - enabled: Soft delete
 */
const mongoose = require('mongoose');

const escalationFlowContactSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
  tel: { type: String, trim: true, default: '' }
}, { _id: true });

const escalationFlowStepSchema = new mongoose.Schema({
  order: { type: Number, required: true, min: 1 },
  title: { type: String, trim: true, required: true, maxlength: 120 },
  type: { type: String, enum: ['unique', 'pool'], required: true },
  contactName: { type: String, trim: true, default: '' },
  contactTel: { type: String, trim: true, default: '' },
  callAt: { type: Date, default: null },
  contacts: { type: [escalationFlowContactSchema], default: [] }
}, { _id: true });

const catalogLogSourceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  parent: {
    type: String,
    trim: true,
    maxlength: 200,
    default: null
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  enabled: {
    type: Boolean,
    default: true,
    required: true
  },
  isInternal: {
    type: Boolean,
    default: false,
    index: true
  },
  internalEmail: {
    type: String,
    trim: true,
    default: ''
  },
  escalationFlow: {
    type: [escalationFlowStepSchema],
    default: []
  },
  escalationLegend: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: ''
  }
}, {
  timestamps: true
});

// Índice de texto para búsqueda typeahead
catalogLogSourceSchema.index(
  { name: 'text', parent: 'text', description: 'text' },
  { 
    weights: { name: 10, parent: 5, description: 1 },
    name: 'catalog_log_source_search_index'
  }
);

// Índice compuesto para queries de catálogo activo
catalogLogSourceSchema.index({ enabled: 1, name: 1 });

const CatalogLogSource = mongoose.model('CatalogLogSource', catalogLogSourceSchema, 'catalog_log_sources');

module.exports = CatalogLogSource;
