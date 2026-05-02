/**
 * File Purpose: backend/src/models/AuditLog.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Auditoría Persistente
 * 
 * Propósito:
 *   - Registro inmutable de eventos críticos
 *   - Compliance: QUIÉN hizo QUÉ CUÁNDO
 *   - Forense: reconstruir timeline de incidentes
 * 
 * Eventos auditados:
 *   - auth.*: login success/fail, unauthorized, guest.expired
 *   - entry.*: create, update, delete
 *   - shiftcheck.*: submit, block.*
 *   - smtp.*: test, send.*
 *   - admin.*: config, users, services, backup
 *   - logforward.*: config.update, test
 * 
 * Retención:
 *   - Índice TTL configurable vía env (default 90 días)
 *   - Producción: configurar backup externo antes de purga
 */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Timestamp del evento (NO usar index: true aquí, se define abajo en índice TTL)
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
    // index: true <- ELIMINADO: Causa warning de índice duplicado con TTL
  },
  
  // Evento estructurado (namespace.action) - NO indexar individualmente
  event: {
    type: String,
    required: true
    // index: true <- ELIMINADO: Se indexa en índice compuesto
  },
  
  // Nivel de severidad - NO indexar (pocas queries lo usan)
  level: {
    type: String,
    enum: ['info', 'warn', 'error'],
    default: 'info'
    // index: true <- ELIMINADO: Rarely queried alone
  },
  
  // Actor (quién ejecutó la acción)
  actor: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
      // index: true <- ELIMINADO: Se indexa en índice compuesto
    },
    username: String,
    role: String,
    isGuest: Boolean
  },
  
  // Request context
  request: {
    requestId: String,
    ip: String,
    userAgent: String,
    method: String,
    path: String,
    deviceFingerprint: String,
    devicePlatform: String,
    deviceLanguage: String,
    forwardedFor: String,
    isLikelyVpnOrProxy: Boolean,
    vpnSignals: [String],
    sessionKey: String,
    ipChanged: Boolean,
    previousIp: String
  },
  
  // Resultado
  result: {
    success: {
      type: Boolean,
      required: true
    },
    reason: String, // Mensaje descriptivo
    statusCode: Number
  },
  
  // Metadata específica del evento (flexible)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  source: {
    type: String,
    default: 'core'
  },

  sourceId: {
    type: String,
    default: null
  },
  
  // Marca para forwarding (procesado por logForwarder)
  forwarded: {
    type: Boolean,
    default: false
    // index: true <- ELIMINADO: Forwarding se procesa en batch, no necesita índice
  }
}, {
  timestamps: false // Usamos timestamp manual para control exacto
});

/**
 * Índices Compuestos Optimizados
 * 
 * Estrategia: Evitar índices simples duplicados, usar solo compuestos
 * Los índices compuestos TAMBIÉN funcionan para queries de su primer campo
 * 
 * Queries soportadas:
 *   1. timestamp: -1, event: 1  →  Timeline de eventos específicos
 *   2. actor.userId: 1, timestamp: -1  →  Actividad de usuario
 *   3. event: 1, result.success: 1  →  Eventos fallidos
 *   4. timestamp: 1 (TTL)  →  Expiración automática
 */
auditLogSchema.index({ timestamp: -1, event: 1 }); // Query: eventos recientes de tipo X
auditLogSchema.index({ 'actor.userId': 1, timestamp: -1 }); // Query: actividad de usuario
auditLogSchema.index({ event: 1, 'result.success': 1 }); // Query: fallos por tipo
auditLogSchema.index({ source: 1, sourceId: 1, timestamp: -1 });

/**
 * Índice TTL: Expiración Automática
 * 
 * Configuración:
 *   - AUDIT_TTL_DAYS=90 (default) en .env
 *   - MongoDB elimina documentos automáticamente cuando timestamp + TTL < now
 * 
 * Advertencia:
 *   - Este índice NO causa warning porque NO es duplicado
 *   - Solo hay UN índice en timestamp (este TTL)
 *   - Los índices compuestos arriba NO cuentan como duplicado
 */
const ttlEnv = Number.parseInt(process.env.AUDIT_TTL_DAYS, 10);
const TTL_DAYS = Number.isFinite(ttlEnv) && ttlEnv > 0 ? ttlEnv : 395; // ~13 meses
auditLogSchema.index(
  { timestamp: 1 }, // Ascendente para TTL
  { expireAfterSeconds: TTL_DAYS * 24 * 60 * 60 }
);

/**
 * Hook: Inmutabilidad de Registros de Auditoría
 * 
 * Compliance: Los logs de auditoría NO pueden modificarse ni eliminarse
 * Solo INSERT está permitido (immutable audit trail)
 */
auditLogSchema.pre('save', function(next) {
  if (!this.isNew) {
    return next(new Error('AuditLog records are immutable (no UPDATE allowed)'));
  }
  next();
});

auditLogSchema.pre('remove', function(next) {
  next(new Error('AuditLog records cannot be deleted manually (use TTL expiration)'));
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
