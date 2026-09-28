import { WorkShift } from '../shifts/shifts.service';
import { ShiftCheck } from './checklists.service';
import { currentShift, nextMoment, redLeaves } from './shift-detect';

const shift = (id: string, startTime: string, endTime: string): WorkShift => ({
  id, name: id, startTime, endTime, timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: [], active: true,
});
const DAY = shift('dia', '08:00:00', '20:00:00');
const NIGHT = shift('noche', '20:00:00', '08:00:00');

const at = (hh: number, mm = 0) => new Date(2026, 8, 27, hh, mm);

describe('shift-detect', () => {
  it('elige el turno que contiene la hora actual, incluido el nocturno que cruza medianoche', () => {
    expect(currentShift([DAY, NIGHT], at(9))?.id).toBe('dia');
    expect(currentShift([DAY, NIGHT], at(19, 59))?.id).toBe('dia');
    expect(currentShift([DAY, NIGHT], at(20))?.id).toBe('noche');
    expect(currentShift([DAY, NIGHT], at(3))?.id).toBe('noche');
  });

  it('sin coincidencia devuelve el primero; sin turnos, null', () => {
    expect(currentShift([shift('corto', '10:00', '11:00')], at(15))?.id).toBe('corto');
    expect(currentShift([], at(15))).toBeNull();
  });

  it('alterna el momento como exige el backend: tras un inicio toca cierre, si no inicio', () => {
    const check = (checkType: 'inicio' | 'cierre') => ({ checkType }) as ShiftCheck;
    expect(nextMoment(undefined)).toBe('inicio');
    expect(nextMoment(check('inicio'))).toBe('cierre');
    expect(nextMoment(check('cierre'))).toBe('inicio');
  });

  it('las hojas en rojo no cuentan los grupos calculados', () => {
    const check = {
      services: [
        { id: '1', serviceTitle: 'Sede', status: 'rojo', isComputed: true },
        { id: '2', serviceTitle: 'Router', status: 'rojo', isComputed: false },
        { id: '3', serviceTitle: 'Switch', status: 'verde', isComputed: false },
      ],
    } as ShiftCheck;
    expect(redLeaves(check).map((s) => s.serviceTitle)).toEqual(['Router']);
  });
});
