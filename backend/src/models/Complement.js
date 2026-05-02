/**
 * File Purpose: backend/src/models/Complement.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const COMPLEMENT_SCOPE_VALUES = [
  'READ_CONTEXT',
  'READ_LOGS',
  'WRITE_ENTRIES',
  'READ_STORAGE',
  'WRITE_STORAGE',
  'WRITE_LOGS'
];

const COMPLEMENT_COLLECTION_VALUES = ['entries', 'auditlogs', 'shared_storage'];
const COMPLEMENT_VISIBLE_ROLE_VALUES = ['admin', 'user', 'auditor', 'guest'];

const complementSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 32,
    match: /^[a-z0-9-]{1,32}$/
  },
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 80
  },
  baseUrl: {
    type: String,
    required: true,
    trim: true
  },
  internalBaseUrl: {
    type: String,
    trim: true,
    default: ''
  },
  dbName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    match: /^bitacora_ext_[a-z0-9][a-z0-9_-]{0,48}$/
  },
  apiVersion: {
    type: String,
    enum: ['v1', 'v2'],
    default: 'v1'
  },
  status: {
    type: String,
    enum: ['active', 'disabled', 'maintenance'],
    default: 'active'
  },
  cleanupHookPath: {
    type: String,
    trim: true,
    default: '/hook/cleanup'
  },
  healthPath: {
    type: String,
    trim: true,
    default: '/health'
  },
  iframePath: {
    type: String,
    trim: true,
    default: '/'
  },
  permissions: {
    scopes: [{
      type: String,
      enum: COMPLEMENT_SCOPE_VALUES
    }],
    allowedCollections: [{
      type: String,
      enum: COMPLEMENT_COLLECTION_VALUES
    }]
  },
  visibility: {
    roles: [{
      type: String,
      enum: COMPLEMENT_VISIBLE_ROLE_VALUES
    }],
    cargoLabels: [{
      type: String,
      trim: true,
      maxlength: 120
    }]
  },
  tokenHash: {
    type: String,
    default: null
  },
  lastTokenIssuedAt: {
    type: Date,
    default: null
  },
  sourceArtifact: {
    sourceType: {
      type: String,
      enum: ['manual', 'zip-static'],
      default: 'manual'
    },
    stackKey: {
      type: String,
      default: null
    },
    originalFileName: {
      type: String,
      default: null
    },
    previewUrl: {
      type: String,
      default: null
    },
    previewRelativePath: {
      type: String,
      default: null
    },
    publishedUrl: {
      type: String,
      default: null
    },
    publishedRelativePath: {
      type: String,
      default: null
    },
    managedByPlatform: {
      type: Boolean,
      default: false
    },
    lastPreviewAt: {
      type: Date,
      default: null
    },
    publishedAt: {
      type: Date,
      default: null
    }
  },
  runtimePolicy: {
    csp: {
      allowUnsafeEval: {
        type: Boolean,
        default: false
      },
      allowBlobWorker: {
        type: Boolean,
        default: false
      },
      extraConnectSrc: [{
        type: String,
        trim: true,
        maxlength: 255
      }],
      extraChildSrc: [{
        type: String,
        trim: true,
        maxlength: 255
      }]
    },
    iframeSandbox: {
      allowPointerLock: {
        type: Boolean,
        default: false
      },
      allowPopups: {
        type: Boolean,
        default: false
      },
      allowDownloads: {
        type: Boolean,
        default: false
      }
    }
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

complementSchema.index({ status: 1, slug: 1 });

module.exports = mongoose.model('Complement', complementSchema);