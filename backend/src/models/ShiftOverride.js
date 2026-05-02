/**
 * File Purpose: backend/src/models/ShiftOverride.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const shiftOverrideSchema = new mongoose.Schema({
  roleCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    enum: ['N2', 'TI', 'N1_NO_HABIL']
  },
  originalUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  replacementUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Índices
shiftOverrideSchema.index({ roleCode: 1, startDate: 1, endDate: 1 });
shiftOverrideSchema.index({ active: 1 });
shiftOverrideSchema.index({ replacementUserId: 1 });

// Validación: endDate debe ser mayor a startDate
shiftOverrideSchema.pre('save', function(next) {
  if (this.endDate <= this.startDate) {
    return next(new Error('endDate must be greater than startDate'));
  }
  next();
});

const ShiftOverride = mongoose.model('ShiftOverride', shiftOverrideSchema);

module.exports = ShiftOverride;
