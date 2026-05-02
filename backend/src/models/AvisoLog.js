/**
 * File Purpose: backend/src/models/AvisoLog.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * AvisoLog.js — MAIL-REM-043
 *
 * Registro de auditoría de cada envío de recordatorio periódico de turno.
 */
const mongoose = require('mongoose');

const avisoLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['shift_reminder'],
      default: 'shift_reminder',
      required: true
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkShift',
      default: null
    },
    shiftName: {
      type: String,
      trim: true,
      default: ''
    },
    recipients: {
      type: [String],
      default: []
    },
    recipientsCount: {
      type: Number,
      default: 0
    },
    reminderText: {
      type: String,
      trim: true,
      default: ''
    },
    frequencyType: {
      type: String,
      enum: ['hours', 'fixed'],
      default: 'hours'
    },
    triggerKey: {
      type: String,
      trim: true,
      default: ''
    },
    sentAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    collection: 'avisolog',
    timestamps: false
  }
);

// Índice para deduplicación: shiftId + triggerKey
avisoLogSchema.index({ shiftId: 1, triggerKey: 1 }, { unique: true, sparse: true });
avisoLogSchema.index({ sentAt: -1 });

module.exports = mongoose.model('AvisoLog', avisoLogSchema);
