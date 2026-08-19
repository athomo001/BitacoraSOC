/**
 * File Purpose: backend/src/models/GlpiTicketLink.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Ledger de sincronización entrante GLPI -> Bitácora.
 *
 * Un ticket GLPI puede generar varias entradas de bitácora a lo largo del tiempo
 * (la entrada original + una entrada nueva por cada seguimiento externo posterior),
 * por lo que el cursor de sincronización (`lastSyncedDateMod`) vive aquí y no en `Entry`.
 */
const mongoose = require('mongoose');

const glpiTicketLinkSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  entitiesId: {
    type: Number,
    default: null
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    default: null
  },
  entryType: {
    type: String,
    enum: ['operativa', 'incidente'],
    default: 'operativa'
  },
  originEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Entry',
    default: null
  },
  lastSyncedDateMod: {
    type: Date,
    default: null
  },
  firstImportedAt: {
    type: Date,
    default: null
  },
  lastImportedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GlpiTicketLink', glpiTicketLinkSchema);
