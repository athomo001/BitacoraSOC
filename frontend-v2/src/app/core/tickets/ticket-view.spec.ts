import { clockText, formatDuration, priorityOf, publicProgress, transitionAction } from './ticket-view';
import { SlaClock } from './tickets.service';

const clock = (state: SlaClock['state'], remainingSeconds: number, elapsedSeconds = 0): SlaClock => ({ state, remainingSeconds, elapsedSeconds, percent: 50, dueAt: '' });

describe('ticket-view', () => {
  it('formatea duraciones legibles, nunca segundos', () => {
    expect(formatDuration(10_500)).toBe('2 h 55 min');
    expect(formatDuration(3_600)).toBe('1 h');
    expect(formatDuration(2_700)).toBe('45 min');
    expect(formatDuration(237_600)).toBe('2 d 18 h');
    expect(formatDuration(-720)).toBe('12 min');
    expect(formatDuration(15)).toBe('0 min');
  });

  it('usa la misma matriz ITIL que el backend', () => {
    expect(priorityOf('high', 'high')).toBe('p1_critical');
    expect(priorityOf('high', 'low')).toBe('p2_high');
    expect(priorityOf('low', 'critical')).toBe('p2_high');
    expect(priorityOf('medium', 'low')).toBe('p3_medium');
    expect(priorityOf('low', 'low')).toBe('p4_low');
  });

  it('describe el reloj según su estado', () => {
    expect(clockText(clock('on_time', 10_500))).toEqual({ key: 'tickets.sla.remaining', value: '2 h 55 min' });
    expect(clockText(clock('breached', -720))).toEqual({ key: 'tickets.sla.breached', value: '12 min' });
    expect(clockText(clock('met', 0, 480))).toEqual({ key: 'tickets.sla.met', value: '8 min' });
    expect(clockText(clock('paused', 7_200)).key).toBe('tickets.sla.paused');
  });

  it('distingue empezar, retomar tras la pausa y reabrir', () => {
    expect(transitionAction('assigned', 'in_progress').key).toBe('tickets.action.start');
    expect(transitionAction('pending_vendor', 'in_progress').key).toBe('tickets.action.resume');
    expect(transitionAction('resolved', 'in_progress')).toMatchObject({ key: 'tickets.action.reopen', primary: false });
    expect(transitionAction('new', 'assigned')).toMatchObject({ key: 'tickets.action.take', primary: true });
  });

  it('reduce los 7 estados internos a los 3 pasos que ve el cliente', () => {
    expect(publicProgress('new')).toMatchObject({ step: 0, done: false, tone: 'info' });
    for (const status of ['assigned', 'in_progress', 'pending_vendor'] as const) {
      expect(publicProgress(status)).toMatchObject({ step: 1, done: false, tone: 'warn' });
    }
    expect(publicProgress('pending_vendor').title).toBe('publicTicket.state.pending_vendor');
    expect(publicProgress('resolved')).toMatchObject({ step: 2, done: true, tone: 'ok' });
    expect(publicProgress('closed')).toMatchObject({ step: 2, done: true, tone: 'ok' });
    expect(publicProgress('cancelled')).toMatchObject({ step: null, tone: 'neutral' });
  });
});
