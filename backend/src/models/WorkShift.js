/**
 * File Purpose: backend/src/models/WorkShift.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

/**
 * Modelo de Turnos de Trabajo
 * 
 * Función:
 *   - Definir turnos de trabajo con horarios personalizados
 *   - Asociar usuarios a turnos (opcional)
 *   - Vincular checklists específicos por turno
 *   - Diferenciar turnos regulares (oficina) de emergencia (no hábil)
 * 
 * Tipos:
 *   - regular: Turnos normales de oficina (ej: mañana 9-18, tarde 18-2, noche 2-9)
 *   - emergency: Turno de emergencia fuera de horario hábil
 * 
 * Uso:
 *   - Admin crea turnos con horarios flexibles
 *   - Puede asignar usuarios específicos o dejar sin asignar
 *   - Sistema determina turno actual según hora
 *   - Checklists pueden variar por turno (noche vs día)
 */

const workShiftSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
    // Ejemplos: "Turno Mañana", "Turno Tarde", "Turno Noche", "Emergencia No Hábil"
  },
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    unique: true
    // Ejemplos: "MORNING", "AFTERNOON", "NIGHT", "EMERGENCY"
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['regular', 'emergency'],
    default: 'regular'
    // regular: turnos normales de oficina
    // emergency: turno de emergencia fuera de horario
  },
  startTime: {
    type: String,
    required: true,
    match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/
    // Formato HH:MM (24h). Ejemplo: "09:00", "18:00"
  },
  endTime: {
    type: String,
    required: true,
    match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/
    // Formato HH:MM (24h). Puede ser menor que startTime si cruza medianoche
  },
  timezone: {
    type: String,
    required: true,
    default: 'America/Santiago'
    // Zona horaria para interpretar startTime/endTime
  },
  // Usuario asignado al turno (opcional)
  assignedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
    // null = sin asignar, puede ser asignado por admin
  },
  assignedUserIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: []
    // Soporte de múltiples analistas por turno
  },
    // Checklist template asociado (opcional, legacy)
  checklistTemplateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChecklistTemplate',
    default: null
  },
  // Checklist template de Inicio
  checklistTemplateStartId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChecklistTemplate',
    default: null
  },
  // Checklist template de Cierre
  checklistTemplateEndId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChecklistTemplate',
    default: null
  },
  // Fecha último reporte automático
  lastReportSentAt: {
    type: Date,
    default: null
  },
  // Configuración de reenvío de información por correo
  emailReportConfig: {
    enabled: {
      type: Boolean,
      default: false
      // Si está habilitado, envía reporte al finalizar turno
    },
    includeChecklist: {
      type: Boolean,
      default: true
      // Incluir tabla con checklist entrada/salida
    },
    includeEntries: {
      type: Boolean,
      default: true
      // Incluir lista de entradas de bitácora
    },
    recipients: {
      type: [String],
      default: []
      // Lista de correos que recibirán el reporte
      // Validación de emails en el controlador
    },
    subjectTemplate: {
      type: String,
      default: 'Reporte SOC [fecha] [turno]'
      // Plantilla del asunto con variables: [fecha], [turno], [hora]
    }
  },
  // Orden de visualización
  order: {
    type: Number,
    default: 0
    // Para ordenar turnos en UI
  },
  active: {
    type: Boolean,
    default: true
  },
  // Color para UI (opcional)
  color: {
    type: String,
    default: '#1976d2'
    // Color hex para identificar turno en frontend
  }
}, {
  timestamps: true
});

// Índices
workShiftSchema.index({ type: 1, active: 1 });
workShiftSchema.index({ order: 1 });

// Validación: endTime diferente de startTime
workShiftSchema.pre('save', function(next) {
  if (this.startTime === this.endTime) {
    return next(new Error('startTime and endTime must be different'));
  }
  next();
});

const WorkShift = mongoose.model('WorkShift', workShiftSchema);

module.exports = WorkShift;
