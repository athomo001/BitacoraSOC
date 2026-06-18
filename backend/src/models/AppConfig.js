/**
 * File Purpose: backend/src/models/AppConfig.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

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

const easterEggPayloadSchema = new mongoose.Schema({
  blackout: {
    type: Boolean,
    default: true
  },
  imageUrl: {
    type: String,
    default: '/scripts/Bender.png'
  },
  durationMs: {
    type: Number,
    default: 3000,
    min: 250,
    max: 30000
  },
  cooldownMs: {
    type: Number,
    default: 0,
    min: 0,
    max: 300000
  }
}, { _id: false });

const easterEggRuleSchema = new mongoose.Schema({
  scope: {
    type: String,
    enum: ['login', 'entry'],
    required: true
  },
  triggerType: {
    type: String,
    enum: ['credentials', 'hashtag'],
    required: true
  },
  username: {
    type: String,
    default: ''
  },
  password: {
    type: String,
    default: ''
  },
  pattern: {
    type: String,
    default: ''
  },
  hashtag: {
    type: String,
    default: ''
  },
  payload: {
    type: easterEggPayloadSchema,
    default: () => ({})
  },
  enabled: {
    type: Boolean,
    default: true
  }
}, { _id: false });

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
  // Alerta por items NOK (rojo) en checklist
  alertNokEnabled: {
    type: Boolean,
    default: false
  },
  alertNokRoleTarget: {
    type: [String],
    default: ['N2']
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
  checklistWeeklyAlertEnabled: {
    type: Boolean,
    default: false
  },
  checklistWeeklyReminderDay: {
    type: Number,
    default: 1,
    min: 0,
    max: 6
  },
  checklistWeeklyReminderTime: {
    type: String,
    default: '16:00'
  },
  checklistWeeklyCutoffTime: {
    type: String,
    default: '18:00'
  },
  checklistWeeklyTimezone: {
    type: String,
    default: 'America/Santiago',
    trim: true
  },
  escalationReminderEnabled: {
    type: Boolean,
    default: false
  },
  escalationReminderCargoLabels: {
    type: [String],
    default: ['N2']
  },
  escalationReminderDaysAhead: {
    type: Number,
    default: 7,
    min: 1,
    max: 60
  },
  lastEscalationReminderDate: {
    type: Date,
    default: null
  },
  lastEscalationReminderWeekStartDate: {
    type: Date,
    default: null
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
  // Título de la aplicación (toolbar principal)
  appTitle: {
    type: String,
    default: '',
    trim: true,
    maxlength: 80
  },
  // Fuente tipográfica para el título de la barra superior.
  // Permite seleccionar dinámicamente entre las fuentes predefinidas o las subidas por el usuario.
  titleFont: {
    type: String,
    default: 'Monarchia Momentum'
  },
  // Seguridad HTTPS
  security: {
    httpsEnabled: {
      type: Boolean,
      default: false
    },
    forceHttps: {
      type: Boolean,
      default: false
    },
    httpsPort: {
      type: Number,
      default: undefined,
      min: 1,
      max: 65535
    },
    tlsCertPath: {
      type: String,
      default: '',
      trim: true
    },
    tlsKeyPath: {
      type: String,
      default: '',
      trim: true
    },
    tlsCaPath: {
      type: String,
      default: '',
      trim: true
    }
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
  // Configuración de Single Sign-On (SSO) Google
  googleSsoEnabled: {
    type: Boolean,
    default: false
  },
  googleClientId: {
    type: String,
    default: '',
    trim: true
  },
  // Configuración de Single Sign-On (SSO) Microsoft
  microsoftSsoEnabled: {
    type: Boolean,
    default: false
  },
  microsoftClientId: {
    type: String,
    default: '',
    trim: true
  },
  microsoftTenantId: {
    type: String,
    default: 'common',
    trim: true
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
    },
    reportTableColorByDocumentType: {
      incident: {
        type: String,
        default: '#4CAF50',
        trim: true,
        match: /^#([A-Fa-f0-9]{6})$/
      },
      bulletin: {
        type: String,
        default: '#4CAF50',
        trim: true,
        match: /^#([A-Fa-f0-9]{6})$/
      }
    }
  },
  // Paleta de colores seleccionada para el correo de incidentes
  incidentEmailPaletteKey: {
    type: String,
    default: 'cdc-verde',
    trim: true
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
    },
    scheduleAnchorAt: {
      type: Date,
      default: null
    },
    lastAutoAttemptAt: {
      type: Date,
      default: null
    },
    lastAutoRunAt: {
      type: Date,
      default: null
    },
    nextAutoRunAt: {
      type: Date,
      default: null
    },
    lastAutoRunStatus: {
      type: String,
      enum: ['idle', 'scheduled', 'success', 'error'],
      default: 'idle'
    },
    lastAutoRunMessage: {
      type: String,
      default: ''
    }
  },
  // Automatización de envío de turnos de escalación
  escalationScheduleAutomation: {
    enabled: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['weekly', 'monthly'],
      default: 'weekly'
    },
    dayOfWeek: {
      type: Number,
      default: 1, // Lunes (0=Domingo, 1=Lunes...)
      min: 0,
      max: 6
    },
    time: {
      type: String,
      default: '09:00'
    },
    recipients: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    ccRecipients: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    lastSentAt: {
      type: Date,
      default: null
    }
  },
  // Tema visual del login
  loginTheme: {
    type: String,
    // Se añade el tema 'modern' y 'surrealism' para soportar los diseños visuales adicionales
    enum: ['crt', 'infoflow', 'modern', 'surrealism'],
    default: 'crt'
  },
  easterEggRules: {
    type: [easterEggRuleSchema],
    default: () => ([
      { scope: 'login', triggerType: 'credentials', username: 'admin', password: 'admin', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: '1234', password: '1234', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: 'admin', password: '1234', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: '1234', password: 'admin', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: 'password', password: 'password', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: 'admin', password: 'password', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: 'root', password: 'root', enabled: true },
      { scope: 'login', triggerType: 'credentials', username: 'superuser', password: 'superuser', enabled: true },
      { scope: 'entry', triggerType: 'hashtag', hashtag: 'bender', enabled: true }
    ])
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
