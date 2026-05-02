/**
 * File Purpose: backend/src/models/ServiceCatalog.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Catálogo de Servicios SOC
 * 
 * Función:
 *   - Lista configurable de servicios que deben verificarse en cada turno
 *   - Admin puede agregar/editar/desactivar servicios (CRUD)
 *   - Analistas evalúan TODOS los servicios activos en check de turno
 * 
 * Campos:
 *   - title: Nombre del servicio (ej: "Firewall Palo Alto", "Antivirus EDR")
 *   - isActive: Solo servicios activos se muestran en checklist
 *   - order: Orden de presentación en UI (sort por order, luego title)
 * 
 * Uso SOC:
 *   - Checklist obligatorio: todos los servicios activos deben ser evaluados
 *   - Si servicio está en rojo, analista DEBE agregar observación
 *   - Historial: rastrear cuándo/por qué un servicio estuvo en rojo
 */
const mongoose = require('mongoose');

// Catálogo de servicios para el checklist
const serviceCatalogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Índices
serviceCatalogSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.model('ServiceCatalog', serviceCatalogSchema);
