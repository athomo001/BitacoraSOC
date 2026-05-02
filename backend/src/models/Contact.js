/**
 * File Purpose: backend/src/models/Contact.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
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
  timestamps: true
});

// Índices
contactSchema.index({ email: 1 });
contactSchema.index({ active: 1 });
contactSchema.index({ serviceId: 1 });
contactSchema.index({ contactType: 1, active: 1 });
contactSchema.index({ organization: 1 });
contactSchema.index({ favorite: 1, doNotSend: 1 });

const Contact = mongoose.model('Contact', contactSchema);

module.exports = Contact;
