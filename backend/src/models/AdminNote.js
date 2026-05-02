/**
 * File Purpose: backend/src/models/AdminNote.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Nota del Administrador (global)
 * 
 * Función:
 *   - Nota única visible para TODOS los usuarios (broadcast)
 *   - Solo admin puede editar (users/guests solo lectura)
 *   - Autosave frontend: se guarda automáticamente cada 3s
 * 
 * Uso SOC:
 *   - Anuncios operativos: "Mantenimiento SIEM mañana 2am"
 *   - Cambios de protocolo: "Nueva plantilla para incidentes XSS"
 *   - Recordatorios: "Revisar alertas críticas cada hora"
 * 
 * Campos:
 *   - content: Texto libre (Markdown compatible en frontend)
 *   - lastEditedBy: Último admin que modificó (auditoría)
 *   - lastEditedByUsername: Nombre legible (evita populate)
 * 
 * Singleton pattern: Solo existe 1 registro (findOne sin filtros)
 */
const mongoose = require('mongoose');

// Notas del Administrador (globales)
const adminNoteSchema = new mongoose.Schema({
  content: {
    type: String,
    default: ''
  },
  lastEditedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastEditedByUsername: String
}, {
  timestamps: true
});

module.exports = mongoose.model('AdminNote', adminNoteSchema);
