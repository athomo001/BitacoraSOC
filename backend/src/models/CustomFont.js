/**
 * File Purpose: backend/src/models/CustomFont.js
 * Responsibilities: Define el esquema de base de datos para almacenar metadatos de fuentes personalizadas.
 * QA Notes: Validar tipos de archivos y nombres únicos.
 */

const mongoose = require('mongoose');

// Esquema para el registro de fuentes tipográficas cargadas por el usuario
const customFontSchema = new mongoose.Schema({
  // Nombre legible de la fuente que se mostrará en los selectores de la aplicación (debe ser único)
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 50
  },
  // Nombre del archivo físico guardado en el sistema de archivos del servidor
  filename: {
    type: String,
    required: true,
    trim: true
  },
  // URL o ruta estática a través de la cual el cliente descargará el archivo
  url: {
    type: String,
    required: true,
    trim: true
  },
  // Formato CSS para el src de @font-face (truetype, opentype, woff, woff2)
  format: {
    type: String,
    required: true,
    enum: ['truetype', 'opentype', 'woff', 'woff2'],
    trim: true
  },
  // Referencia al usuario administrador que realizó la carga de la fuente
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true // Registra de forma automática createdAt y updatedAt
});

module.exports = mongoose.model('CustomFont', customFontSchema);
