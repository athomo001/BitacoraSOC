/**
 * File Purpose: backend/src/models/CatalogOperationType.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Catálogo de Tipos de Operación
 * 
 * Catálogo de tipos de operaciones SOC (investigación, respuesta, monitoreo, etc).
 * Soporta búsqueda incremental server-side con índice de texto.
 * 
 * Campos:
 *   - name: Nombre del tipo de operación (ej: "Investigación de incidente")
 *   - parent: Categoría padre (ej: "Incident Response")
 *   - description: Descripción del tipo de operación
 *   - infoAdicionalDefault: Texto predefinido para campo "Info Adicional"
 *   - enabled: Soft delete
 */
const mongoose = require('mongoose');

const catalogOperationTypeSchema = new mongoose.Schema({
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
  infoAdicionalDefault: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  enabled: {
    type: Boolean,
    default: true,
    required: true
  }
}, {
  timestamps: true
});

// Índice de texto para búsqueda typeahead
catalogOperationTypeSchema.index(
  { name: 'text', parent: 'text', description: 'text' },
  { 
    weights: { name: 10, parent: 5, description: 1 },
    name: 'catalog_operation_type_search_index'
  }
);

// Índice compuesto para queries de catálogo activo
catalogOperationTypeSchema.index({ enabled: 1, name: 1 });

const CatalogOperationType = mongoose.model('CatalogOperationType', catalogOperationTypeSchema, 'catalog_operation_types');

module.exports = CatalogOperationType;
