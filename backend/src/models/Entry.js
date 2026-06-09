/**
 * File Purpose: backend/src/models/Entry.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Entrada de Bitácora
 * 
 * Campos SOC críticos:
 *   - entryType: 'operativa' (rutina) | 'incidente' (evento anormal)
 *   - entryDate + entryTime: timestamp manual del analista (no createdAt)
 *   - tags: Hashtags extraídos del contenido (#vulnerabilidad, #firewall)
 *   - isGuestEntry: Marca entradas de invitados (para auditoría)
 * 
 * Búsqueda:
 *   - content: indexed text search (MongoDB full-text)
 *   - tags: índice array para filtro rápido
 *   - entryType + createdAt: índice compuesto para dashboards
 * 
 * Metadata:
 *   - ipAddress, userAgent: capturados por middleware (auditoría)
 *   - createdByUsername: desnormalizado (evita populate en listados)
 */
const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50000 // 50KB de texto máximo
  },
  entryType: {
    type: String,
    enum: ['operativa', 'incidente', 'ofensa'],
    default: 'operativa',
    required: true
  },
  entryDate: {
    type: Date,
    required: true
  },
  entryTime: {
    type: String,
    required: true
  },
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required() {
      return !this.ownerComplementId;
    }
  },
  createdByUsername: {
    type: String,
    required: true
  },
  ownerComplementId: {
    type: String,
    default: null,
    index: true
  },
  isGuestEntry: {
    type: Boolean,
    default: false
  },
  // Cliente/Log Source (B2i)
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    default: null
  },
  clientName: {
    type: String,
    default: null
  },
  // Metadata
  ipAddress: String,
  userAgent: String
}, {
  timestamps: true
});

// Índices para búsqueda y filtrado
entrySchema.index({ content: 'text' });
entrySchema.index({ tags: 1 });
entrySchema.index({ clientId: 1 });
entrySchema.index({ entryType: 1 });
entrySchema.index({ createdAt: -1 });
entrySchema.index({ entryDate: -1 });
entrySchema.index({ createdBy: 1 });
entrySchema.index({ isGuestEntry: 1 });
entrySchema.index({ ownerComplementId: 1, createdAt: -1 });

// QA-DB-INDEX-OPTIMIZATION-001: Índice compuesto para optimizar el ordenamiento por fecha y hora de la bitácora
entrySchema.index({ entryDate: -1, entryTime: -1, createdAt: -1 });

// Índice compuesto para filtros comunes
entrySchema.index({ entryType: 1, createdAt: -1 });
entrySchema.index({ tags: 1, createdAt: -1 });
entrySchema.index({ clientId: 1, createdAt: -1 });

module.exports = mongoose.model('Entry', entrySchema);
