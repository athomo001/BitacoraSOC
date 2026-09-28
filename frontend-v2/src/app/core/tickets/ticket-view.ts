import { MessageKey } from '../i18n/messages';
import { ClockState, Impact, SlaClock, TicketPriority, TicketStatus, Urgency } from './tickets.service';

/** Tono del semáforo (tokens --status-*): la pantalla nunca decide colores sueltos. */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'system' | 'neutral' | 'accent';

export const PRIORITY_SHORT: Record<TicketPriority, string> = { p1_critical: 'P1', p2_high: 'P2', p3_medium: 'P3', p4_low: 'P4' };
export const PRIORITY_TONE: Record<TicketPriority, Tone> = { p1_critical: 'bad', p2_high: 'warn', p3_medium: 'info', p4_low: 'neutral' };

export const STATUS_TONE: Record<TicketStatus, Tone> = {
  new: 'system', assigned: 'info', in_progress: 'info', pending_vendor: 'warn', resolved: 'ok', closed: 'neutral', cancelled: 'neutral',
};

export const CLOCK_TONE: Record<ClockState, Tone> = { on_time: 'accent', at_risk: 'warn', breached: 'bad', paused: 'warn', met: 'ok' };

/** Misma matriz ITIL que el backend (internal/tickets.Priority), para mostrar la prioridad antes de crear. */
export function priorityOf(impact: Impact, urgency: Urgency): TicketPriority {
  if (impact === 'high' && (urgency === 'high' || urgency === 'critical')) return 'p1_critical';
  if (impact === 'high' || urgency === 'critical') return 'p2_high';
  if (impact === 'medium' || urgency === 'medium') return 'p3_medium';
  return 'p4_low';
}

/** "2 h 55 min", "2 d 18 h", "45 min": nunca segundos crudos. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.abs(Math.round(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  if (days > 0) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

export interface ClockText {
  key: MessageKey;
  value: string;
}

/** Texto del reloj: la clave de i18n trae el verbo ("Quedan", "Vencido hace"…) y `value` la duración. */
export function clockText(clock: SlaClock): ClockText {
  switch (clock.state) {
    case 'met':
      return { key: 'tickets.sla.met', value: formatDuration(clock.elapsedSeconds) };
    case 'breached':
      return { key: 'tickets.sla.breached', value: formatDuration(clock.remainingSeconds) };
    case 'paused':
      return { key: 'tickets.sla.paused', value: formatDuration(clock.remainingSeconds) };
    default:
      return { key: 'tickets.sla.remaining', value: formatDuration(clock.remainingSeconds) };
  }
}

export interface TransitionAction {
  to: TicketStatus;
  key: MessageKey;
  icon: string;
  primary: boolean;
}

/** Acción de la botonera para cada transición válida que devuelve el backend. */
export function transitionAction(from: TicketStatus, to: TicketStatus): TransitionAction {
  if (to === 'in_progress' && (from === 'resolved' || from === 'closed')) return { to, key: 'tickets.action.reopen', icon: 'replay', primary: false };
  const actions: Record<TicketStatus, Omit<TransitionAction, 'to'>> = {
    assigned: { key: 'tickets.action.take', icon: 'person_add', primary: true },
    in_progress: { key: from === 'pending_vendor' ? 'tickets.action.resume' : 'tickets.action.start', icon: 'play_arrow', primary: true },
    pending_vendor: { key: 'tickets.action.waitVendor', icon: 'pause', primary: false },
    resolved: { key: 'tickets.action.resolve', icon: 'task_alt', primary: true },
    closed: { key: 'tickets.action.close', icon: 'lock', primary: true },
    cancelled: { key: 'tickets.action.cancel', icon: 'block', primary: false },
    new: { key: 'tickets.status.new', icon: 'fiber_new', primary: false },
  };
  return { to, ...actions[to] };
}

/** Enlace público que se entrega al cliente (spec/06 §6.4). */
export function publicTrackingUrl(origin: string, token: string): string {
  return `${origin}/p/tickets/${token}`;
}
