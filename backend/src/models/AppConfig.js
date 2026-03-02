/**
 * Modelo de Configuración Global de Aplicación
 * 
 * Función:
 *   - Configuración dinámica del SOC (sin reiniciar servidor)
 *   - Solo admin puede modificar (frontend settings)
 *   - Singleton: solo existe 1 registro
 * 
 * Parámetros SOC:
 *   - guestModeEnabled: Permitir creación de invitados (true/false)
 *   - guestMaxDurationDays: Duración de cuenta guest (1-30 días)
 *   - shiftCheckCooldownHours: Tiempo mínimo entre checks (minutos)
 *   - logoUrl/logoType: Personalización de logo (URL o upload)
 *   - faviconUrl/faviconType: Ícono de pestaña independiente del logo
 * 
 * Uso:
 *   - Al crear guest: calcular expiresAt = now + guestMaxDurationDays
 *   - Al registrar check: validar cooldown con shiftCheckCooldownHours (minutos)
 *   - Frontend: mostrar/ocultar botón crear guest según guestModeEnabled
 * 
 * Singleton pattern: GET siempre retorna el único registro (crea si no existe)
 */
const mongoose = require('mongoose');

// Configuración global de la aplicación
const appConfigSchema = new mongoose.Schema({
  // Modo invitado
  guestModeEnabled: {
    type: Boolean,
    default: false
  },
  guestMaxDurationDays: {
    type: Number,
    default: 2,
    min: 1,
    max: 30
  },
  // Cooldown checklist (minutos)
  shiftCheckCooldownHours: {
    type: Number,
    default: 240,
    min: 1,
    max: 1440
  },
  // Enviar correo automáticamente al registrar checklist de cierre
  checklistCloseEmailEnabled: {
    type: Boolean,
    default: false
  },
  // Alertas de checklist (B4-7)
  checklistAlertEnabled: {
    type: Boolean,
    default: true
  },
  checklistAlertTime: {
    type: String,
    default: '09:30'
  },
  lastChecklistAlertDate: {
    type: Date,
    default: null
  },
  // Logo
  logoUrl: {
    type: String,
    default: ''
  },
  logoType: {
    type: String,
    enum: ['url', 'upload', 'external'],
    default: 'url'
  },
  // Favicon
  faviconUrl: {
    type: String,
    default: ''
  },
  faviconType: {
    type: String,
    enum: ['url', 'upload', 'external'],
    default: 'url'
  },
  // LogSource por defecto para entradas sin cliente
  defaultLogSourceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CatalogLogSource',
    default: null
  },
  // Configuración global de reenvío de reportes por email
  emailReportConfig: {
    enabled: {
      type: Boolean,
      default: false
    },
    recipients: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    includeChecklist: {
      type: Boolean,
      default: true
    },
    includeEntries: {
      type: Boolean,
      default: true
    },
    subjectTemplate: {
      type: String,
      default: 'Reporte SOC [fecha] [turno]'
    },
    reportTableColor: {
      type: String,
      default: '#4CAF50',
      trim: true,
      match: /^#([A-Fa-f0-9]{6})$/
    }
  },
  // Configuración SMTP para envío de emails
  smtpConfig: {
    host: {
      type: String,
      default: 'smtp.gmail.com'
    },
    port: {
      type: Number,
      default: 587
    },
    secure: {
      type: Boolean,
      default: false
    },
    user: {
      type: String,
      default: ''
    },
    pass: {
      type: String,
      default: ''
    },
    from: {
      type: String,
      default: ''
    }
  },
  // Configuración de Backups Automáticos
  backupConfig: {
    enabled: {
      type: Boolean,
      default: false
    },
    intervalDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 365
    },
    destinationType: {
      type: String,
      enum: ['local', 's3', 'smb', 'nfs'],
      default: 'local'
    },
    localRetentionDays: {
      type: Number,
      default: 30,
      min: 1,
      max: 365
    },
    // Configuración para destinos externos (encriptados/seguros)
    destinationConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  // Última actualización
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AppConfig', appConfigSchema);
