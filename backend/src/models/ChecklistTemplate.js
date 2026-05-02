/**
 * File Purpose: backend/src/models/ChecklistTemplate.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Plantilla de Checklist
 *
 * Objetivo:
 *   - Permitir que el admin defina multiples plantillas de checklist
 *   - Seleccionar una plantilla activa que veran todos los usuarios/guests
 *   - Cada item representa un servicio a evaluar en el check de turno
 *
 * Campos:
 *   - name: Nombre visible de la plantilla
 *   - description: Texto corto descriptivo
 *   - isActive: Solo una plantilla puede estar activa a la vez
 *   - items: Lista de servicios/items del checklist
 *     - title: Nombre del servicio
 *     - description: Texto corto opcional
 *     - order: Orden de despliegue
 *     - isActive: Permite ocultar items sin borrarlos
 *     - children: Sub-items (item 1.1, 1.2, etc.)
 */
const mongoose = require('mongoose');

const childItemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: true });

const checklistItemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  children: {
    type: [childItemSchema],
    default: []
  }
}, { _id: true });

const checklistTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: false
  },
  assignedTo: [{
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkShift' },
    type: { type: String, enum: ['inicio', 'cierre'] }
  }],
  activatedAt: Date,
  items: {
    type: [checklistItemSchema],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

checklistTemplateSchema.index({ isActive: 1, updatedAt: -1 });
checklistTemplateSchema.index({ name: 1 });

module.exports = mongoose.model('ChecklistTemplate', checklistTemplateSchema);
