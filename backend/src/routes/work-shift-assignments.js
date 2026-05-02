/**
 * File Purpose: backend/src/routes/work-shift-assignments.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const router = express.Router();
const WorkShiftAssignment = require('../models/WorkShiftAssignment');
const WorkShift = require('../models/WorkShift');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const mongoose = require('mongoose');

// Utility to convert HH:MM to minutes for overlap checking (OPS-ASSIGN-004)
const timeToMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

// Obtener todas las asignaciones operativas
router.get('/', authenticate, async (req, res) => {
    try {
        const assignments = await WorkShiftAssignment.find()
            .populate('userId', 'email fullName role isActive')
            .populate('workShiftId', 'name code type startTime endTime timezone')
            .sort({ createdAt: -1 });

        res.json(assignments);
    } catch (err) {
        logger.error({ event: 'workshift.assignments.get.error', error: err.message });
        res.status(500).json({ error: 'Error al obtener asignaciones' });
    }
});

// Comprobar solapamientos de turnos (OPS-ASSIGN-007)
const checkOverlap = async (userId, workShiftId, weekdays, excludeAssignmentId = null) => {
    // Primero necesitamos obtener los detalles del turno que estamos intentando asignar
    const targetShift = await WorkShift.findById(workShiftId);
    if (!targetShift) {
        throw new Error('El turno seleccionado no existe');
    }

    const targetStart = timeToMinutes(targetShift.startTime);
    const targetEnd = timeToMinutes(targetShift.endTime);
    const isTargetOvernight = targetEnd < targetStart;

    // Buscar todas las asignaciones activas de este usuario (excluyendo la actual si es una actualización)
    const query = { userId, active: true };
    if (excludeAssignmentId) {
        query._id = { $ne: excludeAssignmentId };
    }

    const existingAssignments = await WorkShiftAssignment.find(query).populate('workShiftId');

    for (const asg of existingAssignments) {
        if (!asg.workShiftId) continue;

        // Si no comparten ningún día, no hay solapamiento
        const sharedDays = weekdays.filter(day => asg.weekdays.includes(day));
        if (sharedDays.length === 0) continue;

        const existStart = timeToMinutes(asg.workShiftId.startTime);
        const existEnd = timeToMinutes(asg.workShiftId.endTime);
        const isExistOvernight = existEnd < existStart;

        // Lógica para detectar solapamiento de tiempo
        let overlaps = false;

        if (!isTargetOvernight && !isExistOvernight) {
            // Caso normal diurno: [start1, end1) cruza con [start2, end2)
            overlaps = targetStart < existEnd && targetEnd > existStart;
        } else {
            // Para overnight, lo más fácil es chequear minuto a minuto (máx 1440 mins) si ambos están activos a la vez.
            // Optimizado:
            const isActiveInMinute = (min, start, end, isOvernight) => {
                if (start === end) return true; // 24h
                return isOvernight
                    ? (min >= start || min < end)
                    : (min >= start && min < end);
            };

            for (let m = 0; m < 1440; m++) {
                if (
                    isActiveInMinute(m, targetStart, targetEnd, isTargetOvernight) &&
                    isActiveInMinute(m, existStart, existEnd, isExistOvernight)
                ) {
                    overlaps = true;
                    break;
                }
            }
        }

        if (overlaps) {
            return {
                overlaps: true,
                conflictingShiftName: asg.workShiftId.name
            };
        }
    }

    return { overlaps: false };
};


// Crear nueva asignación operativa
router.post('/', [authenticate, authorize('admin')], async (req, res) => {
    try {
        const { userId, workShiftId, weekdays } = req.body;

        if (!userId || !workShiftId || !Array.isArray(weekdays) || weekdays.length === 0) {
            return res.status(400).json({ error: 'Faltan campos requeridos o inválidos (userId, workShiftId, weekdays)' });
        }

        // Comprobar si ya existe la misma asignación exacta (analista + turno)
        const exactMatch = await WorkShiftAssignment.findOne({ userId, workShiftId });
        if (exactMatch) {
            return res.status(409).json({ error: 'Este analista ya está asignado a este turno.' });
        }

        // Validación anti-solapamiento operativo (OPS-ASSIGN-007)
        try {
            const overlapCheck = await checkOverlap(userId, workShiftId, weekdays);

            if (overlapCheck.overlaps) {
                return res.status(409).json({
                    error: `Solapamiento de horario detectado con el turno: "${overlapCheck.conflictingShiftName}". Un analista no puede estar en dos turnos simultáneos los mismos días.`
                });
            }
        } catch (overlapErr) {
            return res.status(400).json({ error: overlapErr.message });
        }

        const assignment = new WorkShiftAssignment({
            userId,
            workShiftId,
            weekdays,
            active: true
        });

        await assignment.save();

        // Registrar auditoría manual aquí si lo requiere el sistema

        res.status(201).json(assignment);
    } catch (err) {
        logger.error({ event: 'workshift.assignments.create.error', error: err.message });
        res.status(500).json({ error: 'Error al crear asignación', details: err.message });
    }
});

// Actualizar asignación operativa
router.put('/:id', [authenticate, authorize('admin')], async (req, res) => {
    try {
        const { weekdays, active, validFrom, validTo } = req.body;

        const assignment = await WorkShiftAssignment.findById(req.params.id);
        if (!assignment) {
            return res.status(404).json({ error: 'Asignación no encontrada' });
        }

        // Validación anti-solapamiento si se actualizan los días y está activa (OPS-ASSIGN-007)
        if (active !== false && Array.isArray(weekdays)) {
            try {
                const overlapCheck = await checkOverlap(
                    assignment.userId,
                    assignment.workShiftId,
                    weekdays,
                    assignment._id
                );

                if (overlapCheck.overlaps) {
                    return res.status(409).json({
                        error: `Solapamiento de horario detectado con el turno: "${overlapCheck.conflictingShiftName}". Un analista no puede estar en dos turnos simultáneos los mismos días.`
                    });
                }
            } catch (overlapErr) {
                return res.status(400).json({ error: overlapErr.message });
            }
        }

        if (Array.isArray(weekdays)) assignment.weekdays = weekdays;
        if (active !== undefined) assignment.active = active;
        if (validFrom !== undefined) assignment.validFrom = validFrom;
        if (validTo !== undefined) assignment.validTo = validTo;

        await assignment.save();

        res.json(assignment);
    } catch (err) {
        logger.error({ event: 'workshift.assignments.update.error', error: err.message });
        res.status(500).json({ error: 'Error al actualizar asignación' });
    }
});

// Eliminar asignación operativa
router.delete('/:id', [authenticate, authorize('admin')], async (req, res) => {
    try {
        const assignment = await WorkShiftAssignment.findByIdAndDelete(req.params.id);
        if (!assignment) {
            return res.status(404).json({ error: 'Asignación no encontrada' });
        }
        res.json({ message: 'Asignación eliminada', id: assignment._id });
    } catch (err) {
        logger.error({ event: 'workshift.assignments.delete.error', error: err.message });
        res.status(500).json({ error: 'Error al eliminar asignación' });
    }
});

module.exports = router;
