/**
 * File Purpose: backend/src/models/ShiftReminder.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * ShiftReminder.js — MAIL-REM-043 (v3)
 *
 * Colección de recordatorios periódicos por email. Cada documento define
 * un recordatorio independiente con su propio texto, frecuencia y
 * destinatarios (turnos). El scheduler lee todos los habilitados y
 * los procesa independientemente.
 */
const mongoose = require('mongoose');

const shiftReminderSchema = new mongoose.Schema(
  {
    /** Nombre descriptivo visible en la tabla de administración */
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
    },
    /** Texto del recordatorio que se envía en el correo */
    reminderText: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },
    /** Modo de frecuencia: cada N horas o a horas fijas */
    frequencyType: {
      type: String,
      enum: ['hours', 'fixed'],
      default: 'hours'
    },
    /** Intervalo en horas (solo si frequencyType === 'hours') */
    intervalHours: {
      type: Number,
      default: 4,
      min: 1,
      max: 24
    },
    /** Horas fijas de envío 'HH:MM' (solo si frequencyType === 'fixed') */
    fixedTimes: [{
      type: String,
      trim: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/
    }],
    /**
     * IDs de turnos destinatarios. Si el array está vacío, se envía
     * a TODOS los turnos activos cuya ventana horaria esté activa.
     */
    targetShiftIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkShift'
    }],
    /** Habilitado/deshabilitado sin necesidad de borrar */
    enabled: {
      type: Boolean,
      default: true
    }
  },
  {
    collection: 'shiftreminders',
    timestamps: true
  }
);

shiftReminderSchema.index({ enabled: 1 });

module.exports = mongoose.model('ShiftReminder', shiftReminderSchema);
