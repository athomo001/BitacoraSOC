/**
 * File Purpose: backend/src/models/WorkShiftAssignment.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const workShiftAssignmentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    workShiftId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WorkShift',
        required: true
    },
    weekdays: {
        type: [Number],
        required: true,
        validate: {
            validator: function (v) {
                return Array.isArray(v) && v.every(day => day >= 0 && day <= 6);
            },
            message: 'Los días de la semana deben ser números entre 0 (Domingo) y 6 (Sábado).'
        }
    },
    active: {
        type: Boolean,
        default: true
    },
    validFrom: {
        type: Date,
        default: null
    },
    validTo: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Índices para búsquedas optimizadas
workShiftAssignmentSchema.index({ userId: 1, active: 1 });
workShiftAssignmentSchema.index({ workShiftId: 1, active: 1 });

const WorkShiftAssignment = mongoose.model('WorkShiftAssignment', workShiftAssignmentSchema);

module.exports = WorkShiftAssignment;
