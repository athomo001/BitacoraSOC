/**
 * File Purpose: backend/src/models/ShiftAssignment.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const shiftAssignmentSchema = new mongoose.Schema({
  roleCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    enum: ['N2', 'TI', 'N1_NO_HABIL', 'TELEWORK', 'OL', 'VACATION', 'MEDICAL_LEAVE', 'MEDICAL_APPOINTMENT']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  externalPersonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalPerson'
  },
  weekStartDate: {
    type: Date,
    required: true
  },
  weekEndDate: {
    type: Date,
    required: true
  },
  notes: {
    type: String,
    trim: true
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  pausedByMedicalLeaveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShiftAssignment',
    default: null
  },
  pausedByVacationId: {
    // Registra el ID del turno de vacaciones que pausó esta asignación
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShiftAssignment',
    default: null
  }
}, {
  timestamps: true
});

// Índices
shiftAssignmentSchema.index({ roleCode: 1, weekStartDate: 1, weekEndDate: 1 });
shiftAssignmentSchema.index({ userId: 1 });
shiftAssignmentSchema.index({ externalPersonId: 1 });
shiftAssignmentSchema.index({ pausedByMedicalLeaveId: 1 });
shiftAssignmentSchema.index({ pausedByVacationId: 1 });

// Validación: weekEndDate debe ser mayor a weekStartDate
shiftAssignmentSchema.pre('save', function(next) {
  if (this.weekEndDate <= this.weekStartDate) {
    return next(new Error('weekEndDate must be greater than weekStartDate'));
  }
  next();
});

// Validación: se requiere userId o externalPersonId (pero no ambos)
shiftAssignmentSchema.pre('validate', function(next) {
  const hasUser = !!this.userId;
  const hasExternal = !!this.externalPersonId;
  if (!hasUser && !hasExternal) {
    return next(new Error('userId or externalPersonId is required'));
  }
  if (hasUser && hasExternal) {
    return next(new Error('Only one of userId or externalPersonId is allowed'));
  }
  next();
});

const ShiftAssignment = mongoose.model('ShiftAssignment', shiftAssignmentSchema);

module.exports = ShiftAssignment;
