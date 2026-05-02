/**
 * File Purpose: backend/src/models/LogForwardingConfig.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Configuración de Log Forwarding
 * 
 * Propósito:
 *   - Configurar envío de logs a colector externo (SIEM)
 *   - Admin-only (solo admin puede ver/editar)
 * 
 * Modos de envío:
 *   - plain: TCP sin cifrado (desarrollo/red confiable)
 *   - tls: TCP con TLS 1.2+ (producción/internet)
 * 
 * Formato de envío:
 *   - NDJSON (Newline Delimited JSON)
 *   - Compatible con: syslog-ng, Logstash, Fluentd, Graylog
 * 
 * Seguridad:
 *   - Validación host/port
 *   - TLS con rejectUnauthorized=true por defecto
 *   - NO guardar clientKey en claro (usar env)
 */
const mongoose = require('mongoose');

const logForwardingConfigSchema = new mongoose.Schema({
  // Nombre visible de la integración
  name: {
    type: String,
    trim: true,
    default: 'Integración SIEM/SOAR/NDR'
  },

  // Activar/desactivar forwarding
  enabled: {
    type: Boolean,
    default: false
  },
  
  // Destino del colector
  host: {
    type: String,
    required: function() {
      return this.enabled && this.transport !== 'http';
    },
    trim: true,
    validate: {
      validator: function(v) {
        if (!v && this.transport === 'http') {
          return true;
        }
        // Validar IP o hostname válido
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
        return ipRegex.test(v) || hostnameRegex.test(v);
      },
      message: 'Host debe ser IP válida o hostname'
    }
  },
  
  port: {
    type: Number,
    required: function() {
      return this.enabled && this.transport !== 'http';
    },
    min: 1,
    max: 65535
  },

  // Transporte de salida
  transport: {
    type: String,
    enum: ['udp', 'tcp', 'tls', 'http'],
    default: 'tls',
    required: true
  },
  
  // Modo de conexión
  mode: {
    type: String,
    enum: ['plain', 'tls'],
    default: 'tls',
    required: true
  },

  // Formato de salida
  format: {
    type: String,
    enum: ['json', 'rfc5424'],
    default: 'json',
    required: true
  },

  // Configuración para webhook/API (transport=http)
  http: {
    url: {
      type: String,
      default: ''
    },
    method: {
      type: String,
      enum: ['POST', 'PUT'],
      default: 'POST'
    },
    timeoutMs: {
      type: Number,
      min: 500,
      max: 30000,
      default: 5000
    },
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  
  // Opciones TLS (solo si mode=tls)
  tls: {
    // Verificar certificado del servidor
    rejectUnauthorized: {
      type: Boolean,
      default: true
    },
    
    // CA certificate (opcional, para custom CA)
    // Formato: PEM string o path a archivo
    caCert: {
      type: String,
      default: ''
    },
    
    // Client certificate (opcional, para mTLS)
    clientCert: {
      type: String,
      default: ''
    },
    
    // ⚠️ Client key: NO guardar en DB (usar env: LOG_FORWARD_CLIENT_KEY)
    // Este campo es placeholder para documentación
    _clientKeyNote: {
      type: String,
      default: 'Use env LOG_FORWARD_CLIENT_KEY instead of storing in DB'
    }
  },
  
  // Configuración de reintento
  retry: {
    enabled: {
      type: Boolean,
      default: true
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0,
      max: 10
    },
    backoffMs: {
      type: Number,
      default: 1000,
      min: 100,
      max: 60000
    }
  },
  
  // Qué logs enviar
  forwardLevel: {
    type: String,
    enum: ['audit-only', 'info', 'warn', 'error'],
    default: 'audit-only',
    required: true
  },
  
  // Metadata de config
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastTestedAt: {
    type: Date,
    default: null
  },
  
  lastTestResult: {
    success: Boolean,
    message: String,
    timestamp: Date
  }
  
}, {
  timestamps: true // Añade createdAt y updatedAt automáticamente
});

/**
 * NOTA: NO definir índice en _id
 * 
 * MongoDB crea automáticamente un índice único en _id para todas las colecciones.
 * Intentar definirlo manualmente causa warning:
 *   "Cannot specify a custom index on `_id` for model name 'LogForwardingConfig'"
 * 
 * Para Singleton Pattern (solo 1 documento):
 *   - Usar _id fijo en lógica de negocio: { _id: 'singleton' }
 *   - El índice único de _id ya garantiza unicidad
 */
// logForwardingConfigSchema.index({ _id: 1 }, { unique: true }); <- ELIMINADO

/**
 * Hook de Validación: Advertir TLS Inseguro
 * 
 * Si se configura mode=tls con rejectUnauthorized=false:
 *   - El servidor SIEM NO valida certificado
 *   - Vulnerable a Man-in-the-Middle
 *   - Solo permitir en DEV, NUNCA en producción
 */
logForwardingConfigSchema.pre('save', function(next) {
  if (this.mode === 'tls' && !this.tls.rejectUnauthorized) {
    const { logger } = require('../utils/logger');
    logger.warn({
      event: 'logforward.config.insecure_tls',
      config: { host: this.host, port: this.port }
    }, '⚠️ TLS configured with rejectUnauthorized=false (insecure, DEV only)');
  }
  next();
});

module.exports = mongoose.model('LogForwardingConfig', logForwardingConfigSchema);
