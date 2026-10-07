import { Guard, GuardSlot } from '../../core/shifts/guards.service';
import { DAY, checks, gaps, lanes, nextChange, suggestedStart } from './guards-logic';

const H = 3_600_000;
const t0 = new Date(2026, 9, 5, 9, 0).getTime(); // lunes 5/10 09:00

const guard = (over: Partial<Guard> = {}): Guard => ({
  cycleId: 'c2',
  teamId: 't2',
  label: 'N2',
  mustBeCovered: true,
  changeDay: 1,
  changeTime: '09:00',
  timezone: 'America/Santiago',
  members: [
    { teamMemberId: 'm1', name: 'Ana', userId: 'u1' },
    { teamMemberId: 'm2', name: 'Beto', userId: 'u2' },
  ],
  ...over,
});

const slot = (id: string, cycleId: string, teamMemberId: string, name: string, userId: string, from: number, to: number): GuardSlot => ({
  id, cycleId, teamMemberId, name, userId, startsAt: new Date(from).toISOString(), endsAt: new Date(to).toISOString(), paused: false,
});

describe('guards-logic', () => {
  it('gaps: tramos sin nadie entre guardias, ignorando solapes', () => {
    const out = gaps([{ from: 0, to: 10 * H }, { from: 5 * H, to: 12 * H }, { from: 20 * H, to: 30 * H }], 0, 40 * H);
    expect(out).toEqual([{ from: 12 * H, to: 20 * H }, { from: 30 * H, to: 40 * H }]);
  });

  it('lanes: dos personas a la vez se apilan; si no se cruzan vuelven al primer carril', () => {
    expect(lanes([{ from: 0, to: 10 }, { from: 5, to: 15 }, { from: 10, to: 20 }])).toEqual([0, 1, 0]);
  });

  it('nextChange: el próximo lunes 09:00 (o el mismo día si aún no pasa)', () => {
    expect(nextChange(t0 - H, guard())).toBe(t0);
    expect(nextChange(t0 + H, guard())).toBe(t0 + 7 * DAY);
    expect(new Date(nextChange(t0, guard({ changeDay: 5, changeTime: '20:00' }))).getHours()).toBe(20);
  });

  it('suggestedStart: sigue donde termina la última guardia futura', () => {
    const s = [slot('s1', 'c2', 'm1', 'Ana', 'u1', t0, t0 + 7 * DAY)];
    expect(suggestedStart(guard(), s, t0 + H)).toBe(t0 + 7 * DAY);
    expect(suggestedStart(guard(), [], t0 + H)).toBe(t0 + 7 * DAY);
  });

  it('checks: sin problemas cuando empalma justo', () => {
    const s = [slot('s1', 'c2', 'm1', 'Ana', 'u1', t0, t0 + 7 * DAY)];
    const out = checks({ cycleId: 'c2', teamMemberId: 'm2', from: t0 + 7 * DAY, to: t0 + 14 * DAY }, [guard()], s, []);
    expect(out.map((c) => c.kind)).toEqual(['ok']);
  });

  it('checks: avisa hueco antes, otra guardia, vacaciones y dos a la vez', () => {
    const ti = guard({ cycleId: 'c3', label: 'TI', members: [{ teamMemberId: 'm9', name: 'Beto', userId: 'u2' }] });
    const s = [
      slot('s1', 'c2', 'm1', 'Ana', 'u1', t0, t0 + 7 * DAY),
      slot('s2', 'c3', 'm9', 'Beto', 'u2', t0 + 8 * DAY, t0 + 9 * DAY),
      slot('s3', 'c2', 'm1', 'Ana', 'u1', t0 + 9 * DAY, t0 + 12 * DAY),
    ];
    const absences = [{ userId: 'u2', from: '2026-10-14', to: '2026-10-14', condition: 'vacation' as const }];
    const out = checks({ cycleId: 'c2', teamMemberId: 'm2', from: t0 + 8 * DAY, to: t0 + 10 * DAY }, [guard(), ti], s, absences);
    expect(out.map((c) => c.kind)).toEqual(['busy', 'absence', 'double', 'gapBefore']);
    expect(out[0].values['g']).toBe('TI');
    expect(out[3].values['s']).toBe('24 h');
  });

  it('checks: una guardia sin "siempre cubierta" no reclama huecos', () => {
    const s = [slot('s1', 'c2', 'm1', 'Ana', 'u1', t0, t0 + DAY)];
    const out = checks({ cycleId: 'c2', teamMemberId: 'm2', from: t0 + 3 * DAY, to: t0 + 4 * DAY }, [guard({ mustBeCovered: false })], s, []);
    expect(out.map((c) => c.kind)).toEqual(['ok']);
  });

  it('checks: pide persona y que Hasta sea después de Desde', () => {
    expect(checks({ cycleId: 'c2', teamMemberId: '', from: t0, to: t0 + DAY }, [guard()], [], [])[0].kind).toBe('pick');
    expect(checks({ cycleId: 'c2', teamMemberId: 'm1', from: t0, to: t0 }, [guard()], [], [])[0].kind).toBe('error');
  });
});
