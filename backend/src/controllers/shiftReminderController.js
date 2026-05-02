/**
 * File Purpose: backend/src/controllers/shiftReminderController.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * shiftReminderController.js — MAIL-REM-043 (v3)
 * CRUD para la colección ShiftReminder (solo admin).
 */
const { validationResult } = require('express-validator');
const ShiftReminder = require('../models/ShiftReminder');

/** GET /api/shift-reminders */
exports.list = async (req, res) => {
  try {
    const reminders = await ShiftReminder.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json(reminders);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener recordatorios', error: err.message });
  }
};

/** POST /api/shift-reminders */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  try {
    const { label, reminderText, frequencyType, intervalHours, fixedTimes, targetShiftIds, enabled } = req.body;

    const effectiveFrequency = frequencyType || 'hours';
    if (effectiveFrequency === 'fixed' && (!Array.isArray(fixedTimes) || fixedTimes.length === 0)) {
      return res.status(422).json({ message: 'Se requieren horas fijas (fixedTimes) cuando frequencyType es "fixed"' });
    }

    const reminder = await ShiftReminder.create({
      label,
      reminderText,
      frequencyType: frequencyType || 'hours',
      intervalHours: intervalHours ?? 4,
      fixedTimes: Array.isArray(fixedTimes) ? fixedTimes : [],
      targetShiftIds: Array.isArray(targetShiftIds) ? targetShiftIds : [],
      enabled: enabled !== false
    });
    res.status(201).json(reminder);
  } catch (err) {
    res.status(500).json({ message: 'Error al crear recordatorio', error: err.message });
  }
};

/** PUT /api/shift-reminders/:id */
exports.update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  try {
    const reminder = await ShiftReminder.findById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ message: 'Recordatorio no encontrado' });
    }

    const { label, reminderText, frequencyType, intervalHours, fixedTimes, targetShiftIds, enabled } = req.body;

    const effectiveFrequency = frequencyType !== undefined ? frequencyType : reminder.frequencyType;
    const effectiveFixedTimes = fixedTimes !== undefined ? fixedTimes : reminder.fixedTimes;
    if (effectiveFrequency === 'fixed' && (!Array.isArray(effectiveFixedTimes) || effectiveFixedTimes.length === 0)) {
      return res.status(422).json({ message: 'Se requieren horas fijas (fixedTimes) cuando frequencyType es "fixed"' });
    }

    if (label !== undefined) reminder.label = label;
    if (reminderText !== undefined) reminder.reminderText = reminderText;
    if (frequencyType !== undefined) reminder.frequencyType = frequencyType;
    if (intervalHours !== undefined) reminder.intervalHours = intervalHours;
    if (fixedTimes !== undefined) reminder.fixedTimes = Array.isArray(fixedTimes) ? fixedTimes : [];
    if (targetShiftIds !== undefined) reminder.targetShiftIds = Array.isArray(targetShiftIds) ? targetShiftIds : [];
    if (enabled !== undefined) reminder.enabled = Boolean(enabled);

    await reminder.save();
    res.json(reminder);
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar recordatorio', error: err.message });
  }
};

/** DELETE /api/shift-reminders/:id */
exports.remove = async (req, res) => {
  try {
    const reminder = await ShiftReminder.findByIdAndDelete(req.params.id);
    if (!reminder) {
      return res.status(404).json({ message: 'Recordatorio no encontrado' });
    }
    res.json({ message: 'Recordatorio eliminado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al eliminar recordatorio', error: err.message });
  }
};
