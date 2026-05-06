/**
 * File Purpose: backend/src/models/DirectoryContact.js
 * Responsibilities: Define the centralized directory contact schema.
 * QA Notes: Keep validation strict for shared contact data integrity.
 */

const mongoose = require('mongoose');

const directoryContactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  company: {
    type: String,
    trim: true,
    default: ''
  },
  position: {
    type: String,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    enum: ['Internal', 'External', 'List'],
    default: 'External'
  },
  scope: {
    type: String,
    enum: ['Internal', 'External'],
    default: 'External'
  },
  source: {
    type: String,
    enum: ['User', 'Manual', 'Sync'],
    default: 'Manual'
  },
  isFavorite: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

directoryContactSchema.index({ name: 1 });
directoryContactSchema.index({ email: 1 });
directoryContactSchema.index({ company: 1 });
directoryContactSchema.index({ type: 1, isFavorite: 1 });

module.exports = mongoose.model('DirectoryContact', directoryContactSchema);
