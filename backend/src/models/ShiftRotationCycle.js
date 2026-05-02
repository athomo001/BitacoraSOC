/**
 * File Purpose: backend/src/models/ShiftRotationCycle.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const shiftRotationCycleSchema = new mongoose.Schema({
  roleCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    enum: ['N2', 'TI', 'N1_NO_HABIL']
  },
  startDayOfWeek: {
    type: Number,
    required: true,
    min: 0,
    max: 6 // 0=Sunday, 6=Saturday
  },
  startTimeUTC: {
    type: String,
    required: true,
    match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/ // HH:MM format
  },
  durationDays: {
    type: Number,
    required: true,
    default: 7
  },
  timezone: {
    type: String,
    required: true,
    default: 'America/Santiago'
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Índices
shiftRotationCycleSchema.index({ roleCode: 1 });
shiftRotationCycleSchema.index({ active: 1 });

const ShiftRotationCycle = mongoose.model('ShiftRotationCycle', shiftRotationCycleSchema);

module.exports = ShiftRotationCycle;
