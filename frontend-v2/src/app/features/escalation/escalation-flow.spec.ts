import { ActionLog, ResolvedMember, ResolvedStep, StepMode } from '../../core/escalation/escalation.service';
import { flowState, formatCountdown, secondsUntilEscalation } from './escalation-flow';

const member = (id: string): ResolvedMember => ({
  id: `m-${id}`, contactId: `c-${id}`, name: id, roleInTeam: 'primary', recipientType: 'to', priority: 0, onCallNow: false, channels: [],
});
const step = (order: number, mode: StepMode, ids: string[], wait = 10): ResolvedStep => ({
  order, mode, waitBeforeEscalateMinutes: wait,
  team: { id: `t${order}`, name: `Equipo ${order}`, kind: 'contractor_field', audience: 'internal', members: ids.map(member) },
});
let seq = 0;
const act = (stepOrder: number, id: string, result: ActionLog['result']): ActionLog => ({
  id: `a${seq}`, stepOrder, contactId: `c-${id}`, channelType: 'call', result, operatorId: 'u1',
  createdAt: `2026-09-23T10:00:${String(seq++).padStart(2, '0')}Z`,
});

const STEPS = [step(1, 'sequential', ['juan', 'pedro']), step(2, 'unique', ['carlos'], 15), step(3, 'pool', ['marta', 'ana'])];
const SINCE = '2026-09-23T09:59:00Z';

describe('flowState (tarjeta de escalación)', () => {
  beforeEach(() => (seq = 0));

  it('sin intentos: el paso 1 está en curso y toca llamar al primero', () => {
    const s = flowState(STEPS, [], SINCE);
    expect(s.current).toBe(1);
    expect(s.nextMemberId).toBe('m-juan');
    expect([...s.statusByStep.values()]).toEqual(['current', 'pending', 'pending']);
    expect(s.currentSince).toBe(SINCE);
  });

  it('sequential: un no_answer pasa al siguiente miembro del mismo paso', () => {
    const s = flowState(STEPS, [act(1, 'juan', 'no_answer')], SINCE);
    expect(s.current).toBe(1);
    expect(s.nextMemberId).toBe('m-pedro');
    expect(s.lastResultByContact.get('c-juan')).toBe('no_answer');
  });

  it('agotado el paso sequential escala al siguiente y la cuenta regresiva parte del último intento', () => {
    const acts = [act(1, 'juan', 'no_answer'), act(1, 'pedro', 'busy')];
    const s = flowState(STEPS, acts, SINCE);
    expect(s.current).toBe(2);
    expect(s.statusByStep.get(1)).toBe('failed');
    expect(s.currentSince).toBe(acts[1].createdAt);
  });

  it('unique: un intento fallido basta para escalar', () => {
    const s = flowState(STEPS, [act(1, 'juan', 'no_answer'), act(1, 'pedro', 'no_answer'), act(2, 'carlos', 'unreachable')], SINCE);
    expect(s.current).toBe(3);
  });

  it('contestó: se detiene el flujo y el resto queda pendiente', () => {
    const s = flowState(STEPS, [act(1, 'juan', 'no_answer'), act(1, 'pedro', 'answered')], SINCE);
    expect(s.answered).toBe(true);
    expect(s.current).toBeNull();
    expect(s.statusByStep.get(1)).toBe('answered');
    expect(s.statusByStep.get(2)).toBe('pending');
    expect(s.currentSince).toBeNull();
  });

  it('todos fallan: exhausted', () => {
    const acts = [act(1, 'juan', 'no_answer'), act(1, 'pedro', 'no_answer'), act(2, 'carlos', 'busy'), act(3, 'marta', 'no_answer')];
    const s = flowState(STEPS, acts, SINCE);
    expect(s.exhausted).toBe(true);
    expect(s.current).toBeNull();
  });

  it('el orden de llegada de la línea de tiempo no importa', () => {
    const acts = [act(1, 'juan', 'no_answer'), act(1, 'pedro', 'no_answer')].reverse();
    expect(flowState(STEPS, acts, SINCE).current).toBe(2);
  });
});

describe('cuenta regresiva', () => {
  it('calcula los segundos restantes desde que el paso quedó en curso', () => {
    const now = new Date('2026-09-23T10:05:00Z').getTime();
    expect(secondsUntilEscalation(step(1, 'unique', ['x'], 10), '2026-09-23T10:00:00Z', now)).toBe(300);
    expect(secondsUntilEscalation(step(1, 'unique', ['x'], 0), '2026-09-23T10:00:00Z', now)).toBeNull();
  });

  it('formatea mm:ss, con signo cuando ya venció', () => {
    expect(formatCountdown(305)).toBe('05:05');
    expect(formatCountdown(-70)).toBe('-01:10');
  });
});
