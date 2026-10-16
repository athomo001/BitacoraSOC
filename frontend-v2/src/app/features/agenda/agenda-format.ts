import { AgendaOccurrence, Recurrence } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/agenda';

/** Fechas de la Agenda: días civiles "YYYY-MM-DD" (se leen en UTC para no correrse de día). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const locale = (lang: string): string => (lang === 'en' ? 'en-US' : 'es-CL');

/** "mié 14 oct" / "Wed, Oct 14". */
export function fmtDay(iso: string, lang: string, withYear = false): string {
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}),
  }).format(parseDay(iso));
}

/** Nombres cortos de los días (0 = domingo … 6 = sábado). */
export function weekdayNames(lang: string): string[] {
  const f = new Intl.DateTimeFormat(locale(lang), { weekday: 'short', timeZone: 'UTC' });
  // 2026-10-11 es domingo.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 9, 11 + i))));
}

export function monthLabel(year: number, month: number, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
}

/** Texto de una recurrencia: «El 5.º día hábil de cada mes». */
export function recurrenceText(rec: Recurrence, i18n: I18nService, lang: string): string {
  switch (rec.kind) {
    case 'once': return i18n.tf('ag.rec.once', rec.date ? fmtDay(rec.date, lang, true) : '—');
    case 'days': return i18n.tf('ag.rec.days', rec.every ?? 1);
    case 'weekly': {
      const names = weekdayNames(lang);
      return i18n.tf('ag.rec.weekly', (rec.weekdays ?? []).map((d) => names[d]).join(', '));
    }
    case 'bizN': return i18n.tf('ag.rec.bizN', rec.n ?? 1);
    case 'lastBiz': return i18n.t('ag.rec.lastBiz');
    case 'fixed': return i18n.tf(rec.shift === 'prev' ? 'ag.rec.fixedPrev' : 'ag.rec.fixedNext', rec.day ?? 1);
  }
}

/** «hoy, 20:00», «en 3 días hábiles», «atrasada 1 día hábil». */
export function dueText(o: AgendaOccurrence, i18n: I18nService, dayEnd: string): string {
  if (o.late) {
    const n = -o.bizDays;
    if (n <= 0) return i18n.t('ag.due.late0');
    return n === 1 ? i18n.t('ag.due.late1') : i18n.tf('ag.due.late', n);
  }
  if (o.bizDays <= 0) return i18n.tf('ag.due.today', dayEnd);
  return o.bizDays === 1 ? i18n.t('ag.due.in1') : i18n.tf('ag.due.inDays', o.bizDays);
}

/** Grupo de «Mis pendientes». waiting: paso de un flujo que espera al anterior (9.7). */
export type AgendaBucket = 'late' | 'today' | 'soon' | 'later' | 'waiting' | 'done';
export function bucketOf(o: AgendaOccurrence): AgendaBucket {
  if (o.status === 'waiting') return 'waiting';
  if (o.status !== 'pending') return 'done';
  if (o.late) return 'late';
  if (o.bizDays <= 0) return 'today';
  if (o.bizDays <= 3) return 'soon';
  return 'later';
}
