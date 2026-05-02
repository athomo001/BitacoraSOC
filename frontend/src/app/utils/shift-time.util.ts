/**
 * File Purpose: frontend/src/app/utils/shift-time.util.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Utilidades compartidas para parseo y comparación de horarios de turnos operativos.
 * Creado para OPS-ASSIGN-006.
 */

/**
 * Convierte un string HH:mm a la cantidad de minutos desde medianoche.
 * @param timeStr - string en formato HH:mm (ej. "09:30")
 * @returns {number} - minutos totales
 */
export function timeToMinutes(timeStr: string | null | undefined): number {
    if (!timeStr) return 0;

    const parts = String(timeStr).split(':');
    if (parts.length !== 2) return 0;

    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);

    return ((Number.isFinite(hours) ? hours : 0) * 60) + (Number.isFinite(minutes) ? minutes : 0);
}

/**
 * Determina si un rango de tiempo cruza la medianoche (ej. 22:00 a 06:00).
 */
export function isOvernight(startTime: string, endTime: string): boolean {
    return timeToMinutes(endTime) < timeToMinutes(startTime);
}

/**
 * Chequea si una hora dada (minutos) está dentro del rango horario especificado.
 *
 * @param targetMinutes - Minutos a evaluar
 * @param startMinutes - Minutos de inicio del rango
 * @param endMinutes - Minutos de fin del rango
 * @param isOvernightRange - Si el rango cruza medianoche
 */
export function isTimeInRange(targetMinutes: number, startMinutes: number, endMinutes: number, isOvernightRange: boolean): boolean {
    if (startMinutes === endMinutes) {
        return true; // Asumimos 24h
    }

    if (isOvernightRange) {
        return targetMinutes >= startMinutes || targetMinutes < endMinutes;
    }

    return targetMinutes >= startMinutes && targetMinutes < endMinutes;
}

/**
 * Verifica si un turno está activo en este preciso instante según la hora local del navegador
 * y un arreglo de días asignados (0 = Dom, 6 = Sáb).
 * @param startTime - HH:mm de inicio
 * @param endTime - HH:mm de fin
 * @param assignedWeekdays - Arreglo de enteros con los días de la semana activos
 */
export function isShiftActiveNow(startTime: string, endTime: string, assignedWeekdays?: number[]): boolean {
    const now = new Date();
    const currentMinutes = (now.getHours() * 60) + now.getMinutes();
    const today = now.getDay();

    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    const overnight = isOvernight(startTime, endTime);

    // Si no estamos en el rango de horario, falso de inmediato
    if (!isTimeInRange(currentMinutes, startMins, endMins, overnight)) {
        return false;
    }

    // Si no nos pasan días específicos, se asume activo basandose solo en la hora 
    if (!assignedWeekdays || assignedWeekdays.length === 0) {
        return true;
    }

    // Averiguar cuál es el "día efectivo" lógico para la asignación
    // Ej: Si el turno es Lun 22:00 a Mar 06:00, y hoy es Martes a las 02:00 am,
    //     el día efectivo es Lunes (Día anterior), para que el checklist entienda
    //     que este turno comenzó en su franja del Lunes.

    const effectiveWeekday = (overnight && currentMinutes < endMins)
        ? (today + 6) % 7
        : today;

    return assignedWeekdays.includes(effectiveWeekday);
}
