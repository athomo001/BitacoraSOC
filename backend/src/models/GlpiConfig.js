const mongoose = require('mongoose');

const glpiConfigSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  mode: {
    type: String,
    enum: ['api', 'email'],
    default: 'api'
  },
  dispatchMode: {
    type: String,
    enum: ['daily-summary', 'immediate'],
    default: 'daily-summary'
  },
  api: {
    baseUrl: {
      type: String,
      trim: true,
      default: ''
    },
    appToken: {
      type: String,
      default: ''
    },
    userToken: {
      type: String,
      default: ''
    },
    verifyTls: {
      type: Boolean,
      default: true
    },
    timeoutMs: {
      type: Number,
      default: 8000,
      min: 1000,
      max: 30000
    }
  },
  email: {
    collectorAddress: {
      type: String,
      trim: true,
      default: ''
    },
    subjectTemplate: {
      type: String,
      trim: true,
      default: '[SOC] Cierre de turno {{date}}'
    }
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastTestDate: {
    type: Date,
    default: null
  },
  lastTestSuccess: {
    type: Boolean,
    default: null
  },
  lastTestMessage: {
    type: String,
    default: ''
  },
  lastDispatchDate: {
    type: Date,
    default: null
  },
  lastDispatchSuccess: {
    type: Boolean,
    default: null
  },
  lastDispatchMessage: {
    type: String,
    default: ''
  },
  lastDispatchMode: {
    type: String,
    enum: ['daily-summary', 'immediate', 'manual-test', 'unknown'],
    default: 'unknown'
  },
  lastDispatchEvent: {
    type: String,
    default: ''
  },
  lastDispatchChannel: {
    type: String,
    enum: ['api', 'email', 'none'],
    default: 'none'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GlpiConfig', glpiConfigSchema);
