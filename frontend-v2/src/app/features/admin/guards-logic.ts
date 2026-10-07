import { Absence, Guard, GuardSlot } from '../../core/shifts/guards.service';

/**
 * Reglas de la línea de tiempo de guardias (canvas "Turnos: guardias"),
 * sin Angular para poder probarlas: huecos, carriles, qué revisar antes de
 * guardar y cuándo toca el próximo cambio. Todo en milisegundos.
 */

export const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface Interval { from: number; to: number; }

export interface Draft { id?: string; cycleId: string; teamMemberId: string; from: number; to: number; }

export type CheckKind = 'ok' | 'error' | 'busy' | 'absence' | 'double' | 'gapBefore' | 'gapAfter' | 'pick';

export interface Check { kind: CheckKind; values: Record<string, string>; }

export const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmt(ms: number, withTime = true, days = DAYS_ES): string {
  const d = new Date(ms);
  const date = `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  return withTime ? `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : date;
}

/** "24 h" / "3 d". */
export function span(ms: number): string {
  const h = Math.round(ms / HOUR);
  return h >= 48 ? `${Math.round(h / 24)} d` : `${h} h`;
}

export function interval(s: GuardSlot): Interval {
  return { from: Date.parse(s.startsAt), to: Date.parse(s.endsAt) };
}

/** Tramos sin nadie de una guardia entre a y b. */
export function gaps(slots: Interval[], a: number, b: number): Interval[] {
  const list = [...slots].sort((x, y) => x.from - y.from);
  const out: Interval[] = [];
  let cursor = a;
  for (const s of list) {
    if (s.from > cursor) out.push({ from: cursor, to: Math.min(s.from, b) });
    cursor = Math.max(cursor, s.to);
    if (cursor >= b) break;
  }
  if (cursor < b) out.push({ from: cursor, to: b });
  return out.filter((g) => g.to - g.from >= 60_000);
}

/** Carril de cada barra: dos personas a la vez se apilan. */
export function lanes(items: Interval[]): number[] {
  const ends: number[] = [];
  return items.map((it) => {
    let lane = ends.findIndex((end) => end <= it.from);
    if (lane < 0) {
      lane = ends.length;
      ends.push(it.to);
    } else {
      ends[lane] = it.to;
    }
    return lane;
  });
}

/** Días de Dotación (AAAA-MM-DD inclusive) como intervalo en hora local. */
export function absenceInterval(a: Absence): Interval {
  const [fy, fm, fd] = a.from.split('-').map(Number);
  const [ty, tm, td] = a.to.split('-').map(Number);
  return { from: new Date(fy, fm - 1, fd).getTime(), to: new Date(ty, tm - 1, td + 1).getTime() };
}

const overlaps = (a: Interval, b: Interval) => a.from < b.to && b.from < a.to;

/** Próximo cambio de la guardia (día y hora configurados) en o después de `ms`. */
export function nextChange(ms: number, guard: Guard): number {
  const [h, m] = guard.changeTime.split(':').map(Number);
  const d = new Date(ms);
  const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
  let add = (guard.changeDay - candidate.getDay() + 7) % 7;
  if (add === 0 && candidate.getTime() < ms) add = 7;
  candidate.setDate(candidate.getDate() + add);
  return candidate.getTime();
}

/** Desde dónde seguiría la guardia: donde termina la última, o el próximo cambio. */
export function suggestedStart(guard: Guard, slots: GuardSlot[], now: number): number {
  const ends = slots.filter((s) => s.cycleId === guard.cycleId).map((s) => Date.parse(s.endsAt)).filter((e) => e > now);
  return ends.length ? Math.max(...ends) : nextChange(now, guard);
}

/** Qué revisar antes de guardar una guardia (mismo orden que el canvas). */
export function checks(d: Draft, guards: Guard[], slots: GuardSlot[], absences: Absence[], days = DAYS_ES): Check[] {
  const f = (ms: number) => fmt(ms, true, days);
  const guard = guards.find((g) => g.cycleId === d.cycleId);
  const member = guard?.members.find((m) => m.teamMemberId === d.teamMemberId);
  if (!guard || !member) return [{ kind: 'pick', values: {} }];
  if (d.to <= d.from) return [{ kind: 'error', values: {} }];
  const out: Check[] = [];
  const me: Interval = { from: d.from, to: d.to };
  const samePerson = (s: GuardSlot) => (member.userId ? s.userId === member.userId : s.name === member.name);
  const others = slots.filter((s) => s.id !== d.id);
  for (const s of others.filter((s) => s.cycleId !== d.cycleId && samePerson(s) && overlaps(interval(s), me))) {
    const g = guards.find((x) => x.cycleId === s.cycleId);
    out.push({ kind: 'busy', values: { p: member.name, g: g?.label ?? '', from: f(Date.parse(s.startsAt)), to: f(Date.parse(s.endsAt)) } });
  }
  for (const a of absences.filter((a) => a.userId === member.userId && overlaps(absenceInterval(a), me))) {
    out.push({ kind: 'absence', values: { p: member.name, c: a.condition, from: a.from.split('-').reverse().slice(0, 2).join('/'), to: a.to.split('-').reverse().slice(0, 2).join('/') } });
  }
  const same = others.filter((s) => s.cycleId === d.cycleId);
  const both = same.filter((s) => overlaps(interval(s), me));
  if (both.length) out.push({ kind: 'double', values: { g: guard.label, p: [...new Set(both.map((s) => s.name))].join(', ') } });
  if (guard.mustBeCovered) {
    const prev = same.filter((s) => interval(s).to <= d.from).sort((x, y) => interval(y).to - interval(x).to)[0];
    const next = same.filter((s) => interval(s).from >= d.to).sort((x, y) => interval(x).from - interval(y).from)[0];
    if (prev && d.from - interval(prev).to >= 60_000) out.push({ kind: 'gapBefore', values: { g: guard.label, s: span(d.from - interval(prev).to), from: f(interval(prev).to), to: f(d.from) } });
    if (next && interval(next).from - d.to >= 60_000) out.push({ kind: 'gapAfter', values: { g: guard.label, s: span(interval(next).from - d.to), from: f(d.to), to: f(interval(next).from) } });
  }
  if (!out.length) out.push({ kind: 'ok', values: { p: member.name, g: guard.label, from: f(d.from), to: f(d.to) } });
  return out;
}

/** <input type="datetime-local"> ↔ milisegundos (hora local). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}
