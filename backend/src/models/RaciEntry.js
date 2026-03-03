/**
 * Modelo RACI por cliente/servicio
 */
const mongoose = require('mongoose');

const raciEntrySchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    required: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    default: null
  },
  topic: {
    type: String,
    default: '',
    trim: true,
    maxlength: 180
  },
  activity: {
    type: String,
    required: true,
    trim: true
  },
  responsible: {
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true }
  },
  accountable: {
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true }
  },
  consulted: {
    name: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true }
  },
  informed: {
    name: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true }
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

raciEntrySchema.index({ clientId: 1, serviceId: 1, topic: 1, activity: 1 });

module.exports = mongoose.model('RaciEntry', raciEntrySchema);
