/**
 * File Purpose: backend/src/models/ShiftClosure.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Cierre de Turno SOC
 *
 * Registra el resumen del turno y el estado de envío (email/API/webhook).
 */
const mongoose = require('mongoose');

const shiftClosureSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  shiftStartAt: {
    type: Date,
    required: true
  },
  shiftEndAt: {
    type: Date,
    required: true
  },
  closureCheckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShiftCheck',
    required: true
  },
  summary: {
    totalEntries: {
      type: Number,
      default: 0
    },
    totalIncidents: {
      type: Number,
      default: 0
    },
    servicesDown: {
      type: [String],
      default: []
    },
    observaciones: {
      type: String,
      default: ''
    }
  },
  sentVia: {
    type: String,
    enum: ['email', 'api', 'webhook', 'none'],
    default: 'none'
  },
  integrationName: {
    type: String,
    default: null
  },
  sentAt: {
    type: Date,
    default: null
  },
  sentStatus: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },
  sentError: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

shiftClosureSchema.index({ userId: 1, shiftEndAt: -1 });
shiftClosureSchema.index({ closureCheckId: 1 });

module.exports = mongoose.model('ShiftClosure', shiftClosureSchema);
