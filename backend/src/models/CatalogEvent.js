/**
 * File Purpose: backend/src/models/CatalogEvent.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Catálogo de Eventos
 * 
 * Catálogo centralizado de eventos SOC (1900+ registros y creciendo).
 * Soporta búsqueda incremental server-side con índice de texto.
 * 
 * Campos:
 *   - name: Nombre del evento (ej: "Phishing detectado")
 *   - parent: Categoría padre (ej: "Email Security")
 *   - description: Descripción técnica
 *   - motivoDefault: Texto predefinido para campo "Motivo" en bitácora
 *   - enabled: Soft delete (false = deshabilitado, solo admin puede cambiar)
 * 
 * Índices:
 *   - Text search en name, parent, description para typeahead rápido
 *   - enabled + name para queries de catálogo activo
 */
const mongoose = require('mongoose');

const catalogEventSchema = new mongoose.Schema({
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
  motivoDefault: {
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

// Índice de texto para búsqueda typeahead (name tiene más peso)
catalogEventSchema.index(
  { name: 'text', parent: 'text', description: 'text' },
  { 
    weights: { name: 10, parent: 5, description: 1 },
    name: 'catalog_event_search_index'
  }
);

// Índice compuesto para queries de catálogo activo ordenadas
catalogEventSchema.index({ enabled: 1, name: 1 });

const CatalogEvent = mongoose.model('CatalogEvent', catalogEventSchema, 'catalog_events');

module.exports = CatalogEvent;
