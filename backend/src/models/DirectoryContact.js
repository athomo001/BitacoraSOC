/**
 * File Purpose: backend/src/models/DirectoryContact.js
 * Responsibilities: Define the centralized directory contact schema.
 * QA Notes: Keep validation strict for shared contact data integrity.
 */

const mongoose = require('mongoose');
const { encrypt, decrypt, sha256 } = require('../utils/encryption');

// Helper para descifrar PII de forma tolerante a datos legacy en texto plano
const decryptPII = (val) => {
  if (!val) return val;
  if (!val.includes(':') && !val.startsWith('U2FsdGVkX1')) {
    return val;
  }
  try {
    const decrypted = decrypt(val);
    return decrypted || val;
  } catch {
    return val;
  }
};

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
    set: encrypt,
    get: decryptPII
  },
  emailHash: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    set: encrypt,
    get: decryptPII
  },
  phoneHash: {
    type: String,
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
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// Hook para hashear de forma determinista antes de guardar
directoryContactSchema.pre('save', function (next) {
  if (this.isModified('email')) {
    this.emailHash = this.email ? sha256(this.email) : '';
  }
  if (this.isModified('phone')) {
    this.phoneHash = this.phone ? sha256(this.phone) : '';
  }
  next();
});

directoryContactSchema.index({ name: 1 });
directoryContactSchema.index({ emailHash: 1 });
directoryContactSchema.index({ phoneHash: 1 });
directoryContactSchema.index({ company: 1 });
directoryContactSchema.index({ type: 1, isFavorite: 1 });

module.exports = mongoose.model('DirectoryContact', directoryContactSchema);
