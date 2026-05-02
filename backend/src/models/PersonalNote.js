/**
 * File Purpose: backend/src/models/PersonalNote.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Notas Personales
 * 
 * Cada usuario tiene UNA nota personal privada (1:1 relationship)
 * 
 * Características:
 *   - Solo el usuario propietario puede ver/editar su nota
 *   - Autosave cada 3 segundos en frontend
 *   - Máx 10,000 caracteres (configurable en frontend)
 * 
 * Índice:
 *   - userId único: Garantiza 1 nota por usuario
 *   - El campo unique: true ya crea el índice automáticamente
 */
const mongoose = require('mongoose');

const personalNoteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // Crea índice único automáticamente, NO duplicar con .index()
  },
  content: {
    type: String,
    default: '',
    maxlength: 50000 // Límite backend (frontend 10k por UX)
  }
}, {
  timestamps: true // createdAt = primera nota, updatedAt = último autosave
});

// NO definir índice explícito en userId (ya está por unique: true)
// personalNoteSchema.index({ userId: 1 }); <- ELIMINADO: Causa warning de duplicado

module.exports = mongoose.model('PersonalNote', personalNoteSchema);
