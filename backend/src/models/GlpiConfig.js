/**
 * File Purpose: backend/src/models/GlpiConfig.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

// Override de tipo de entrada por categoría GLPI (itilcategories_id) dentro de una entidad mapeada.
const glpiCategoryOverrideSchema = new mongoose.Schema({
  itilCategoriesId: {
    type: Number,
    required: true
  },
  entryType: {
    type: String,
    enum: ['operativa', 'incidente'],
    required: true
  }
}, { _id: false });

// Vincula una Entidad de GLPI (entities_id) con un cliente/log source de la bitácora,
// y define qué tipo de entrada se crea por defecto al importar tickets de esa entidad.
const glpiEntityMappingSchema = new mongoose.Schema({
  entitiesId: {
    type: Number,
    required: true
  },
  label: {
    type: String,
    trim: true,
    default: ''
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    default: null
  },
  defaultEntryType: {
    type: String,
    enum: ['operativa', 'incidente'],
    default: 'operativa'
  },
  categoryOverrides: {
    type: [glpiCategoryOverrideSchema],
    default: []
  },
  enabled: {
    type: Boolean,
    default: true
  },
  // Cursor propio de esta entidad (independiente del resto) para el poll de tickets:
  // si una entidad falla durante un ciclo, las demás igual avanzan su cursor.
  lastPolledAt: {
    type: Date,
    default: null
  }
}, { _id: true });

const glpiConfigSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  // Muestra el campo opcional "Ticket GLPI" en el formulario de Nueva Entrada, para
  // vincular la entrada a un ticket existente al momento de crearla (no requiere enabled=true
  // para poder ocultarse independiente del resto de la integración).
  manualLinkFieldEnabled: {
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
  },
  // Mapeo de entidades GLPI -> cliente/tipo de entrada, usado por la importación entrante.
  entityMappings: {
    type: [glpiEntityMappingSchema],
    default: []
  },
  // Importación entrante (GLPI -> Bitácora): polling periódico de tickets nuevos/actualizados.
  inbound: {
    enabled: {
      type: Boolean,
      default: false
    },
    pollingIntervalMinutes: {
      type: Number,
      default: 5,
      min: 1,
      max: 1440
    },
    importUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    lastPollAt: {
      type: Date,
      default: null
    },
    lastPollSuccess: {
      type: Boolean,
      default: null
    },
    lastPollMessage: {
      type: String,
      default: ''
    },
    lastImportedCount: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GlpiConfig', glpiConfigSchema);
