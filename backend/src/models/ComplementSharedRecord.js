/**
 * File Purpose: backend/src/models/ComplementSharedRecord.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const complementSharedRecordSchema = new mongoose.Schema({
  ownerComplementId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  collectionName: {
    type: String,
    required: true,
    trim: true,
    default: 'shared_storage'
  },
  key: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

complementSharedRecordSchema.index({ ownerComplementId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('ComplementSharedRecord', complementSharedRecordSchema);