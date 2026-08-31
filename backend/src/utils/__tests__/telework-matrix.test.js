/**
 * File Purpose: backend/src/utils/__tests__/telework-matrix.test.js
 * Responsibilities: Verificar la resolución por día de la grilla semanal de teletrabajo/apoyo y el
 *   render de la página pública, manteniendo paridad con `computeMatrixRows` del frontend.
 */

const {
  buildTeleworkWeeklyMatrix,
  renderTeleworkWeeklyPage
} = require('../telework-matrix');

// Miércoles 2026-09-02 al mediodía → semana Lun 2026-08-31 .. Vie 2026-09-04.
const NOW = new Date('2026-09-02T12:00:00');
const at = (iso) => new Date(iso);

const USERS = [
  { _id: 'u-ana', fullName: 'Ana', role: 'analyst', cargoLabel: 'Analista N1' },
  { _id: 'u-beto', fullName: 'Beto', role: 'analyst', cargoLabel: 'Analista N2' },
  { _id: 'u-zoe', fullName: 'Zoe', role: 'analyst', cargoLabel: 'Analista N1' },
  { _id: 'u-guest', fullName: 'Invitada', role: 'guest', cargoLabel: '' },
  { _id: 'u-aud', fullName: 'Auditor', role: 'auditor', cargoLabel: '' }
];

describe('buildTeleworkWeeklyMatrix', () => {
  test('arma 5 columnas Lun-Vie y el rótulo de semana', () => {
    const { columns, weekRangeText } = buildTeleworkWeeklyMatrix({ assignments: [], users: [], now: NOW });
    expect(columns).toHaveLength(5);
    // Formato es-CL (ICU) sin cero a la izquierda — paridad con la grilla en pantalla del frontend.
    expect(columns[0].dateShort).toBe('31/8');
    expect(columns[4].dateShort).toBe('4/9');
    expect(weekRangeText).toBe('Semana del Lunes 31 de Agosto al Viernes 4 de Septiembre de 2026');
  });

  test('teletrabajo parcial: solo marca los días cubiertos', () => {
    const assignments = [{
      _id: 'a1', userId: 'u-beto', roleCode: 'TELEWORK',
      weekStartDate: at('2026-08-31T00:00:00'), weekEndDate: at('2026-09-01T23:59:59'), isPaused: false
    }];
    const { rows } = buildTeleworkWeeklyMatrix({ assignments, users: USERS, now: NOW });
    const beto = rows.find((r) => r.name === 'Beto');
    expect(beto.days.map((d) => d.status)).toEqual(['telework', 'telework', 'office', 'office', 'office']);
    expect(beto.hasSpecial).toBe(true);
  });

  test('vacaciones de semana completa marca los 5 días', () => {
    const assignments = [{
      _id: 'a2', userId: 'u-ana', roleCode: 'VACATION',
      weekStartDate: at('2026-08-30T00:00:00'), weekEndDate: at('2026-09-06T23:59:59'), isPaused: false
    }];
    const { rows } = buildTeleworkWeeklyMatrix({ assignments, users: USERS, now: NOW });
    const ana = rows.find((r) => r.name === 'Ana');
    expect(ana.days.every((d) => d.status === 'vacation')).toBe(true);
  });

  test('prioridad: licencia médica gana sobre teletrabajo el mismo día', () => {
    const assignments = [
      { _id: 'a3', userId: 'u-beto', roleCode: 'TELEWORK', weekStartDate: at('2026-08-31T00:00:00'), weekEndDate: at('2026-09-04T23:59:59'), isPaused: false },
      { _id: 'a4', userId: 'u-beto', roleCode: 'MEDICAL_LEAVE', weekStartDate: at('2026-09-02T00:00:00'), weekEndDate: at('2026-09-02T23:59:59'), isPaused: false }
    ];
    const { rows } = buildTeleworkWeeklyMatrix({ assignments, users: USERS, now: NOW });
    const beto = rows.find((r) => r.name === 'Beto');
    expect(beto.days[2].status).toBe('medical-leave'); // miércoles
    expect(beto.days[0].status).toBe('telework');
  });

  test('ordena hasSpecial primero y luego alfabético; ignora guest/auditor y pausadas', () => {
    const assignments = [
      { _id: 'a5', userId: 'u-ana', roleCode: 'TELEWORK', weekStartDate: at('2026-08-31T00:00:00'), weekEndDate: at('2026-08-31T23:59:59'), isPaused: false },
      { _id: 'a6', userId: 'u-zoe', roleCode: 'TELEWORK', weekStartDate: at('2026-08-31T00:00:00'), weekEndDate: at('2026-08-31T23:59:59'), isPaused: true },
      { _id: 'a7', userId: 'u-guest', roleCode: 'VACATION', weekStartDate: at('2026-08-31T00:00:00'), weekEndDate: at('2026-09-04T23:59:59'), isPaused: false }
    ];
    const { rows } = buildTeleworkWeeklyMatrix({ assignments, users: USERS, now: NOW });
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Beto', 'Zoe']);
    expect(rows[0].hasSpecial).toBe(true);
    expect(rows[1].hasSpecial).toBe(false);
  });
});

describe('renderTeleworkWeeklyPage', () => {
  test('emite HTML autónomo con nombres, semana y auto-refresco', () => {
    const matrix = buildTeleworkWeeklyMatrix({
      assignments: [{
        _id: 'a8', userId: 'u-ana', roleCode: 'TELEWORK',
        weekStartDate: at('2026-08-31T00:00:00'), weekEndDate: at('2026-09-04T23:59:59'), isPaused: false
      }],
      users: USERS,
      now: NOW
    });
    const html = renderTeleworkWeeklyPage({ matrix, appTitle: 'SOC Demo', generatedAt: NOW });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('Personal en Teletrabajo y Apoyo');
    expect(html).toContain('Semana del Lunes 31 de Agosto al Viernes 4 de Septiembre de 2026');
    expect(html).toContain('Ana');
    expect(html).toContain('Teletrabajo');
  });

  test('sin filas muestra el vacío', () => {
    const matrix = buildTeleworkWeeklyMatrix({ assignments: [], users: [], now: NOW });
    const html = renderTeleworkWeeklyPage({ matrix, appTitle: 'SOC Demo', generatedAt: NOW });
    expect(html).toContain('Sin personal fuera de la oficina esta semana');
  });
});
