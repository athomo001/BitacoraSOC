import { WorkShift } from '../shifts/shifts.service';
import { ShiftCheck } from './checklists.service';

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Turno en curso según la hora local: el que contiene "ahora", incluido el
 * turno noche que cruza medianoche (20:00–08:00). Sin coincidencia, el
 * primero — el analista lo puede cambiar igual.
 */
export function currentShift(shifts: readonly WorkShift[], now: Date): WorkShift | null {
  const current = now.getHours() * 60 + now.getMinutes();
  const match = shifts.find((shift) => {
    const start = minutes(shift.startTime);
    const end = minutes(shift.endTime);
    return start <= end ? current >= start && current < end : current >= start || current < end;
  });
  return match ?? shifts[0] ?? null;
}

/**
 * El backend exige alternar inicio/cierre por turno (409 "invalid-sequence"):
 * si el último check del turno fue un inicio, toca cierre; si no, inicio.
 */
export function nextMoment(latest: ShiftCheck | undefined): 'inicio' | 'cierre' {
  return latest?.checkType === 'inicio' ? 'cierre' : 'inicio';
}

/** Hojas en rojo de un check guardado (los grupos calculados no cuentan dos veces). */
export function redLeaves(check: ShiftCheck) {
  return check.services.filter((service) => service.status === 'rojo' && !service.isComputed);
}
