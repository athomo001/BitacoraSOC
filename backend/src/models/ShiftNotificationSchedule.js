/**
 * File Purpose: backend/src/models/ShiftNotificationSchedule.js
 * Responsibilities: Definir el esquema para las programaciones personalizadas de notificaciones de turnos.
 * QA Notes: Validar tipos permitidos en el filtro de roles y asegurar consistencia con las asignaciones.
 */

const mongoose = require('mongoose');

const shiftNotificationScheduleSchema = new mongoose.Schema({
  // Nombre descriptivo de la programación (ej: "Reporte de Guardia", "Teletrabajo RRHH")
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Determina si la notificación programada se procesará de forma automática
  enabled: {
    type: Boolean,
    default: true
  },
  // Frecuencia del envío: semanal o mensual
  frequency: {
    type: String,
    enum: ['weekly', 'monthly'],
    default: 'weekly'
  },
  // Día de la semana en que se ejecuta (0 = Domingo, 1 = Lunes, ..., 6 = Sábado)
  dayOfWeek: {
    type: Number,
    default: 1,
    min: 0,
    max: 6
  },
  // Hora en formato HH:mm (ej: "09:30")
  time: {
    type: String,
    default: '09:00',
    trim: true
  },
  // Lista de destinatarios directos de correo
  recipients: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  // Lista de correos en copia (CC)
  ccRecipients: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  // Filtro de roles que delimita qué turnos o asignaciones se incluirán en este reporte
  roleFilter: [{
    type: String,
    trim: true,
    uppercase: true,
    enum: ['N2', 'TI', 'N1_NO_HABIL', 'TELEWORK', 'VACATION', 'MEDICAL_LEAVE', 'OL', 'MEDICAL_APPOINTMENT']
  }],
  // Almacena la fecha y hora del último envío automático exitoso
  lastSentAt: {
    type: Date,
    default: null
  },
  // Determina el período de turnos a notificar (semana en curso o la siguiente semana)
  targetPeriod: {
    type: String,
    enum: ['current_week', 'next_week'],
    default: 'current_week'
  },
  // Formato visual del correo: lista tabular (default, histórico) o calendario tipo grilla Lun-Vie
  emailFormat: {
    type: String,
    enum: ['list', 'calendar'],
    default: 'list'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ShiftNotificationSchedule', shiftNotificationScheduleSchema);
