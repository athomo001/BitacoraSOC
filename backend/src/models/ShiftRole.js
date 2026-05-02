/**
 * File Purpose: backend/src/models/ShiftRole.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const shiftRoleSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
    // Flexible: permite N1, N2, TI, AUDITOR, etc. (sin enum fijo)
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  // Nivel de escalada (1=junior, 2=senior, etc)
  escalationLevel: {
    type: Number,
    default: 1
  },
  // Notificaciones automáticas (para B2m cierre turno)
  notifyOnCheckClose: {
    type: Boolean,
    default: false
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Índices
shiftRoleSchema.index({ code: 1 });

const ShiftRole = mongoose.model('ShiftRole', shiftRoleSchema);

module.exports = ShiftRole;
