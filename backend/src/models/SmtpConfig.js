/**
 * File Purpose: backend/src/models/SmtpConfig.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Configuración SMTP
 * 
 * Función:
 *   - Almacenar config de email para notificaciones SOC
 *   - UI estilo Passbolt: provider, auth, advanced, sender, recipients
 *   - Cifrado AES-256-GCM en password (NUNCA se retorna a frontend)
 * 
 * Providers soportados:
 *   - Office 365, AWS SES, Elastic Email, Google Mail/Workspace, Mailgun, Custom
 * 
 * Uso SOC:
 *   - Email automático al registrar check con servicios rojos
 *   - Test endpoint: validar config antes de guardar
 *   - Condicional: solo envía si sendOnlyIfRed=true y hay rojos
 * 
 * Seguridad:
 *   - password cifrado con AES-256-GCM (ver utils/encryption.js)
 *   - GET /api/smtp: responde sin password (delete configObj.password)
 *   - Rate limit en test: 3 intentos/15min (prevenir relay abuse)
 */
const mongoose = require('mongoose');

// Configuración SMTP
const smtpConfigSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['office365', 'aws-ses', 'elastic-email', 'google-mail', 'google-workspace', 'mailgun', 'custom'],
    required: true
  },
  authMethod: {
    type: String,
    enum: ['credentials'],
    default: 'credentials'
  },
  username: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true // Cifrada con crypto-js
  },
  // Configuración avanzada
  host: {
    type: String,
    required: true
  },
  port: {
    type: Number,
    required: true,
    default: 587
  },
  useTLS: {
    type: Boolean,
    default: true
  },
  clientHostname: {
    type: String,
    default: ''
  },
  // Remitente
  senderName: {
    type: String,
    required: true
  },
  senderEmail: {
    type: String,
    required: true
  },
  // Destinatarios
  recipients: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  // Reglas de envío
  sendOnlyIfRed: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Test
  lastTestDate: Date,
  lastTestSuccess: Boolean
}, {
  timestamps: true
});

module.exports = mongoose.model('SmtpConfig', smtpConfigSchema);
