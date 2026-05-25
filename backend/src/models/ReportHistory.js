/**
 * File Purpose: backend/src/models/ReportHistory.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const reportHistorySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['report', 'newsletter'],
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 240
  },
  html: {
    type: String,
    required: true,
    maxlength: 2000000
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdByUsername: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

reportHistorySchema.index({ timestamp: -1 });

module.exports = mongoose.model('ReportHistory', reportHistorySchema);
