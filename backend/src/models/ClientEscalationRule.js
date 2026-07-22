/**
 * File Purpose: backend/src/models/ClientEscalationRule.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ── readBy sub-document (ESC-MAINT-042) ──────────────────────────────────────
const readByEntrySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    trim: true,
    default: ''
  },
  context: {
    type: String,
    default: 'report'
  },
  readAt: {
    type: Date,
    default: Date.now
  },
  occurrenceKey: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: false });

const channelSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['email', 'whatsapp', 'telefono', 'otro'],
    required: true
  },
  target: {
    type: String,
    trim: true,
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: false });

const timeWindowSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: [
      'always',
      'outside_business_hours',
      'between_hours',
      'after_hour',
      'before_hour',
      'weekend_only',
      'weekdays_only'
    ],
    default: 'always'
  },
  startTime: {
    type: String,
    default: '09:00',
    validate: {
      validator: (v) => HHMM_REGEX.test(v),
      message: 'startTime debe tener formato HH:mm'
    }
  },
  endTime: {
    type: String,
    default: '17:00',
    validate: {
      validator: (v) => HHMM_REGEX.test(v),
      message: 'endTime debe tener formato HH:mm'
    }
  },
  daysOfWeek: [{
    type: Number,
    min: 0,
    max: 6
  }],
  holidayOnly: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const clientEscalationRuleSchema = new mongoose.Schema({
  // En report-generator el "cliente" proviene del catálogo de Log Sources.
  // null = regla global (aplica a todos los clientes); solo permitido para scheduled_maintenance,
  // validado a nivel de aplicación en clientAlertController (special_alert siempre exige clientId).
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    default: null,
    index: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  enabled: {
    type: Boolean,
    default: true,
    index: true
  },
  contexts: [{
    type: String,
    enum: ['report', 'copy-report'],
    default: 'report'
  }],
  timezone: {
    type: String,
    default: 'America/Santiago',
    trim: true
  },
  priority: {
    type: Number,
    default: 100,
    min: 1,
    max: 10000
  },
  validFrom: {
    type: Date,
    default: null
  },
  validTo: {
    type: Date,
    default: null
  },
  holidayDates: [{
    type: String,
    match: /^\d{4}-\d{2}-\d{2}$/
  }],
  timeWindows: {
    type: [timeWindowSchema],
    default: [{ mode: 'always' }]
  },
  channels: {
    type: [channelSchema],
    default: []
  },
  alertMessage: {
    type: String,
    required: true,
    trim: true,
    maxlength: 4000
  },
  acknowledgementRequired: {
    type: Boolean,
    default: true
  },
  // ── ESC-MAINT-042: campos de mantenimiento programado ─────────────────────
  ruleType: {
    type: String,
    enum: ['special_alert', 'scheduled_maintenance'],
    default: 'special_alert',
    index: true
  },
  blocking: {
    type: Boolean,
    default: false
  },
  maintenanceTitle: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  readBy: {
    type: [readByEntrySchema],
    default: []
  },
  // ─────────────────────────────────────────────────────────────────────────
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

clientEscalationRuleSchema.index({ clientId: 1, enabled: 1, priority: 1 });
clientEscalationRuleSchema.index({ validFrom: 1, validTo: 1 });

clientEscalationRuleSchema.pre('validate', function(next) {
  if (!Array.isArray(this.contexts) || this.contexts.length === 0) {
    this.contexts = ['report'];
  }
  next();
});

module.exports = mongoose.model('ClientEscalationRule', clientEscalationRuleSchema);
