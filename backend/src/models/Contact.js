/**
 * File Purpose: backend/src/models/Contact.js
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

const contactSchema = new mongoose.Schema({
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
  organization: {
    type: String,
    trim: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    default: null
  },
  role: {
    type: String,
    trim: true
  },
  contactType: {
    type: String,
    enum: ['escalation', 'preventive'],
    default: 'escalation'
  },
  isMailingList: {
    type: Boolean,
    default: false
  },
  favorite: {
    type: Boolean,
    default: false
  },
  doNotSend: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 500
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

// Hook para hashear de forma determinista para búsquedas exactas antes de guardar
contactSchema.pre('save', function (next) {
  if (this.isModified('email')) {
    this.emailHash = this.email ? sha256(this.email) : '';
  }
  if (this.isModified('phone')) {
    this.phoneHash = this.phone ? sha256(this.phone) : '';
  }
  next();
});

// Índices
contactSchema.index({ emailHash: 1 });
contactSchema.index({ phoneHash: 1 });
contactSchema.index({ active: 1 });
contactSchema.index({ serviceId: 1 });
contactSchema.index({ contactType: 1, active: 1 });
contactSchema.index({ organization: 1 });
contactSchema.index({ favorite: 1, doNotSend: 1 });

const Contact = mongoose.model('Contact', contactSchema);

module.exports = Contact;
