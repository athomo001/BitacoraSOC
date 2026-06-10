/**
 * File Purpose: backend/src/models/ShiftCheck.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Check de Turno SOC
 * 
 * Función:
 *   - Registrar estado de servicios al inicio/cierre de turno
 *   - Forzar evaluación completa (todos los servicios activos)
 *   - Capturar observaciones de servicios en estado rojo
 * 
 * Reglas SOC críticas:
 *   1. Tipo alternado: NO permitir inicio->inicio o cierre->cierre consecutivos
 *   2. Cooldown: Bloquear checks si no han pasado N minutos desde último check
 *   3. Todos los servicios: Frontend envía TODOS, backend valida completitud
 *   4. Rojos con observación: Servicios en rojo REQUIEREN texto explicativo
 *   5. hasRedServices: Marca checks con problemas (para filtros/alertas)
 * 
 * Campos:
 *   - type: 'inicio' (empezar turno) | 'cierre' (terminar turno)
 *   - services: Array con estado de cada servicio (verde/rojo + obs)
 *   - checkDate: Timestamp del check (America/Santiago)
 *   - hasRedServices: Boolean para queries rápidas de checks problemáticos
 */
const mongoose = require('mongoose');

// Registro de checklist de turno
const shiftCheckSchema = new mongoose.Schema({
  checklistId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChecklistTemplate'
  },
  checklistName: {
    type: String,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['inicio', 'cierre'],
    required: true
  },
  checkDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  services: [{
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceCatalog',
      required: true
    },
    parentServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceCatalog'
    },
    serviceTitle: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['verde', 'rojo'],
      required: true
    },
    observation: {
      type: String,
      default: '',
      maxlength: 1000
    }
  }],
  hasRedServices: {
    type: Boolean,
    default: false
  },
  // Metadata
  ipAddress: String,
  userAgent: String,
  // Identificador del turno asociado para segregación secuencial
  shiftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkShift',
    default: null
  }
}, {
  timestamps: true
});

// Índices
shiftCheckSchema.index({ userId: 1, createdAt: -1 });
shiftCheckSchema.index({ type: 1 });
shiftCheckSchema.index({ checkDate: -1 });
shiftCheckSchema.index({ hasRedServices: 1 });
shiftCheckSchema.index({ checklistId: 1 });
shiftCheckSchema.index({ shiftId: 1 });

module.exports = mongoose.model('ShiftCheck', shiftCheckSchema);
