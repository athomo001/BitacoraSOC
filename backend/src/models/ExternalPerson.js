/**
 * File Purpose: backend/src/models/ExternalPerson.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
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

const externalPersonSchema = new mongoose.Schema({
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
  position: {
    type: String,
    trim: true,
    default: ''
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// Hook para hashear de forma determinista antes de guardar
externalPersonSchema.pre('save', function (next) {
  if (this.isModified('email')) {
    this.emailHash = this.email ? sha256(this.email) : '';
  }
  if (this.isModified('phone')) {
    this.phoneHash = this.phone ? sha256(this.phone) : '';
  }
  next();
});

externalPersonSchema.index({ name: 1 });
externalPersonSchema.index({ emailHash: 1 });
externalPersonSchema.index({ phoneHash: 1 });

module.exports = mongoose.model('ExternalPerson', externalPersonSchema);
