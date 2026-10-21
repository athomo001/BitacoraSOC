import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { ActionKind } from '../../core/agenda/agenda.service';
import { ClientHealth, GoalState, HealthReason, HealthState, MgmtPeriod } from '../../core/management/management.service';
import { fmtDay } from '../agenda/agenda-format';

/** Ícono y tono de cada color de la salud (el color nunca va solo: ícono + texto). */
export const HEALTH_ICON: Record<HealthState, string> = { red: 'error', amber: 'warning', green: 'check_circle' };
export const HEALTH_TONE: Record<HealthState, string> = { red: 'bad', amber: 'warn', green: 'ok' };
export const HEALTH_RANK: Record<HealthState, number> = { red: 0, amber: 1, green: 2 };

export const GOAL_TONE: Record<GoalState, string> = { open: 'system', risk: 'warn', confirm: 'info', done: 'ok', failed: 'bad', not_needed: 'neutral' };
export const GOAL_ICON: Record<GoalState, string> = { open: 'pending', risk: 'warning', confirm: 'hourglass_top', done: 'check_circle', failed: 'cancel', not_needed: 'do_not_disturb_on' };
/** Orden de los escalones en la fila de una persona (sin escalón, al final). */
export const RANK_ORDER: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2 };

export const ACTION_KINDS: ActionKind[] = ['meeting', 'committee', 'contact', 'report', 'other'];
export const PERIODS: MgmtPeriod[] = ['month', 'prev', '90'];

export function kindKey(k: ActionKind): MessageKey {
  return `mg.k.${k}` as MessageKey;
}

export function healthKey(s: HealthState): MessageKey {
  return `mg.h.${s}` as MessageKey;
}

export function goalStateKey(s: GoalState): MessageKey {
  return `mg.gs.${s}` as MessageKey;
}

/** El motivo del color, como lo lee la CSM («TKT-2026-00039 fuera de SLA»). */
export function reasonText(r: HealthReason, i18n: I18nService): string {
  switch (r.code) {
    case 'ticketBreached':
      return i18n.tf('mg.r.ticketBreached', r.ticket ?? '');
    case 'noContact':
      return i18n.t('mg.r.noContact');
    case 'noMeeting':
      return i18n.t('mg.r.noMeeting');
    case 'keyLate':
      return i18n.tf('mg.r.keyLate', r.task ?? '');
  }
}

/** «Comité hace 12 días» para el componente Contacto. */
export function contactText(h: ClientHealth, i18n: I18nService): string {
  const c = h.contact;
  if (c.fromBaseline) return i18n.tf('mg.c.noContactYet', c.contactDays);
  const ago = (days: number) => (days === 0 ? i18n.t('mg.c.agoToday') : i18n.tf('mg.c.ago', days));
  const kind = c.contactKind ? i18n.t(kindKey(c.contactKind)) : '';
  let text = i18n.tf('mg.c.lastContact', `${kind} ${ago(c.contactDays)}`.trim());
  if (c.state !== 'green' && c.meetingKind) text += `; ${i18n.tf('mg.c.lastMeeting', ago(c.meetingDays))}`;
  return text;
}

/** Tiempo medio: «9 min», «6,2 h», «1,6 d» («—» sin datos). */
export function durationText(secs: number, lang: string): string {
  if (!secs || secs <= 0) return '—';
  const nf = (v: number) => v.toLocaleString(lang === 'en' ? 'en-US' : 'es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  if (secs < 86_400) return `${nf(secs / 3600)} h`;
  return `${nf(secs / 86_400)} d`;
}

export function pct(v: number): string {
  return v < 0 ? '—' : `${v} %`;
}

export function day(iso: string, lang: string, withYear = false): string {
  return fmtDay(iso, lang, withYear);
}

/** «oct» / «Oct» del mes «2026-10». */
export function monthShort(ym: string, lang: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CL', { month: 'short', timeZone: 'UTC' }).replace('.', '');
}

export function monthLong(ym: string, lang: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
