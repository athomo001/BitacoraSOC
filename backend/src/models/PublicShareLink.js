/**
 * File Purpose: backend/src/models/PublicShareLink.js
 * Responsibilities: Persistir enlaces públicos de solo lectura (token largo aleatorio) para
 *   vistas que un admin decide exponer sin sesión (ej. grilla semanal de teletrabajo en una TV).
 * QA Notes: Un registro por `type`. Regenerar rota el token e invalida el anterior; `enabled=false`
 *   deja la ruta pública respondiendo "no disponible" sin borrar el historial de accesos.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const publicShareLinkSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    unique: true,
    enum: ['telework-weekly']
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdByName: {
    type: String,
    default: ''
  },
  lastAccessedAt: {
    type: Date,
    default: null
  },
  accessCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

/** Token URL-safe de 256 bits (64 hex). Suficiente para que sea impracticable de adivinar. */
publicShareLinkSchema.statics.generateToken = () => crypto.randomBytes(32).toString('hex');

module.exports = mongoose.model('PublicShareLink', publicShareLinkSchema);
