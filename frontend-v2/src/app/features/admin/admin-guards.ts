import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Absence, Guard, GuardImportResult, GuardSlot, GuardTimeline, GuardsService } from '../../core/shifts/guards.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { Check, DAY, DAYS_EN, DAYS_ES, Draft, absenceInterval, checks, fmt, fromLocalInput, gaps, interval, lanes, span, suggestedStart, toLocalInput } from './guards-logic';

import '../../core/i18n/packs/admin';

/** Panel lateral: una guardia, la rotación, la configuración de una guardia o el CSV. */
type Panel =
  | { kind: 'slot'; draft: Draft }
  | { kind: 'rotation'; cycleId: string; order: string[]; from: number; daysEach: number; count: number }
  | { kind: 'config'; cycleId: string; mustBeCovered: boolean; changeDay: number; workShiftId: string }
  | { kind: 'import' };

const ABSENCE_KEY: Record<Absence['condition'], MessageKey> = {
  vacation: 'shiftsAdmin.cond.vacation',
  medical_leave: 'shiftsAdmin.cond.medicalLeave',
  medical_appointment: 'shiftsAdmin.cond.medicalAppointment',
};

const CHECK_LOOK: Record<Check['kind'], { icon: string; tone: string; key: MessageKey }> = {
  ok: { icon: 'check_circle', tone: 'ok', key: 'guards.check.ok' },
  error: { icon: 'error', tone: 'crit', key: 'guards.check.error' },
  pick: { icon: 'info', tone: 'muted', key: 'guards.check.pick' },
  busy: { icon: 'warning', tone: 'warn', key: 'guards.check.busy' },
  absence: { icon: 'event_busy', tone: 'crit', key: 'guards.check.absence' },
  double: { icon: 'group', tone: 'accent', key: 'guards.check.double' },
  gapBefore: { icon: 'warning', tone: 'warn', key: 'guards.check.gapBefore' },
  gapAfter: { icon: 'warning', tone: 'warn', key: 'guards.check.gapAfter' },
};

/** Lunes 00:00 de la semana de `ms` (hora local). */
function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/**
 * Administración → Turnos → Guardias (canvas "Turnos: guardias", aprobado
 * 2026-10-07): la semana del legacy como línea de tiempo con hora exacta.
 * Arriba quién está ahora y quién sigue; abajo los relevos y lo que falta
 * revisar. N1 y N2 (configurable) no pueden quedar sin nadie: los huecos se
 * marcan en rojo y se cubren con un clic. Antes de guardar, el panel avisa
 * choques con otra guardia, con vacaciones/licencias de Dotación, dos
 * personas a la vez y huecos antes o después.
 */
@Component({
  selector: 'app-admin-guards',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-guards.html',
  styleUrl: './admin-guards.css',
})
export class AdminGuardsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(GuardsService);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Lo que se ve (con margen) y las próximas 4 semanas (ahora, relevos, revisión). */
  protected readonly view = signal<GuardTimeline | null>(null);
  protected readonly upcoming = signal<GuardTimeline | null>(null);
  protected readonly start = signal(weekStart(Date.now()));
  protected readonly spanDays = signal<14 | 28>(14);
  protected readonly panel = signal<Panel | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly importResult = signal<GuardImportResult | null>(null);

  // Reemplazo por unos días (dentro del panel de una guardia ya creada).
  protected readonly overrideOpen = signal(false);
  protected readonly overrideMemberId = signal('');
  protected readonly overrideFrom = signal('');
  protected readonly overrideTo = signal('');
  protected readonly overrideReason = signal('');

  protected readonly guards = computed(() => this.upcoming()?.guards ?? this.view()?.guards ?? []);
  protected readonly now = computed(() => Date.parse(this.upcoming()?.now ?? this.view()?.now ?? new Date().toISOString()));
  private readonly days = computed(() => (this.prefs.language() === 'en' ? DAYS_EN : DAYS_ES));

  protected readonly weekdays = computed(() => {
    const locale = this.prefs.language() === 'es' ? 'es-CL' : 'en-US';
    return Array.from({ length: 7 }, (_, i) => {
      const name = new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'long' });
      return name.charAt(0).toUpperCase() + name.slice(1);
    });
  });

  protected f(ms: number, withTime = true): string {
    return fmt(ms, withTime, this.days());
  }

  protected readonly span = span;

  /** "{p} cubre {g}" con varios valores. */
  protected fill(key: MessageKey, values: Record<string, string>): string {
    return Object.entries(values).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), this.i18n.t(key));
  }

  protected guardOf(cycleId: string): Guard | undefined {
    return this.guards().find((g) => g.cycleId === cycleId);
  }

  // ===== Línea de tiempo =====

  protected readonly end = computed(() => this.start() + this.spanDays() * DAY);

  protected readonly dayHeads = computed(() => {
    const today = new Date(this.now()).setHours(0, 0, 0, 0);
    return Array.from({ length: this.spanDays() }, (_, i) => {
      const d = new Date(this.start());
      d.setDate(d.getDate() + i);
      const ms = d.getTime();
      const label = this.f(ms, false);
      return { ms, label: this.spanDays() > 14 || this.panel() ? label.split(' ')[1] : label, today: ms === today, weekend: d.getDay() === 0 || d.getDay() === 6 };
    });
  });

  private pct(ms: number): number {
    const a = this.start();
    const b = this.end();
    return ((Math.min(Math.max(ms, a), b) - a) / (b - a)) * 100;
  }

  protected readonly nowPct = computed(() => {
    const n = this.now();
    return n >= this.start() && n <= this.end() ? this.pct(n) : null;
  });

  protected readonly rows = computed(() => {
    const data = this.view();
    if (!data) return [];
    const a = this.start();
    const b = this.end();
    const now = this.now();
    const selected = this.panel();
    const selectedId = selected?.kind === 'slot' ? selected.draft.id : undefined;
    return data.guards.map((guard) => {
      const mine = data.slots
        .filter((s) => s.cycleId === guard.cycleId)
        .map((s) => ({ slot: s, ...interval(s) }))
        .filter((s) => s.to > a && s.from < b);
      const swaps = data.overrides
        .filter((o) => o.cycleId === guard.cycleId)
        .map((o) => ({ o, from: Date.parse(o.startsAt), to: Date.parse(o.endsAt) }))
        .filter((o) => o.to > a && o.from < b);
      const all = [...mine.map((m) => ({ from: m.from, to: m.to })), ...swaps.map((o) => ({ from: o.from, to: o.to }))];
      const order = all.map((_, i) => i).sort((x, y) => all[x].from - all[y].from);
      const laneOf = new Array<number>(all.length);
      lanes(order.map((i) => all[i])).forEach((lane, k) => (laneOf[order[k]] = lane));
      const laneCount = Math.max(1, ...laneOf.map((l) => l + 1));
      const h = laneCount > 1 ? 20 : 24;
      const bars = mine.map((m, i) => ({
        id: m.slot.id,
        slot: m.slot,
        label: m.slot.name,
        title: `${m.slot.name} · ${this.f(m.from)} → ${this.f(m.to)}`,
        state: m.slot.paused ? 'paused' : m.to <= now ? 'past' : m.from <= now ? 'now' : 'next',
        selected: m.slot.id === selectedId,
        left: this.pct(m.from),
        width: Math.max(this.pct(m.to) - this.pct(m.from), 0.6),
        top: 8 + laneOf[i] * 24,
        h,
      }));
      const swapBars = swaps.map((s, i) => ({
        id: s.o.id,
        label: `↺ ${s.o.name}`,
        title: `${this.i18n.t('guards.override')}: ${s.o.name} · ${this.f(s.from)} → ${this.f(s.to)}${s.o.reason ? ` · ${s.o.reason}` : ''}`,
        left: this.pct(s.from),
        width: Math.max(this.pct(s.to) - this.pct(s.from), 0.6),
        top: 8 + laneOf[mine.length + i] * 24,
        h,
      }));
      const covered = mine.filter((m) => !m.slot.paused).map((m) => ({ from: m.from, to: m.to }));
      const holes = guard.mustBeCovered
        ? gaps(covered, Math.max(a, now), b).map((g) => ({
            ...g,
            left: this.pct(g.from),
            width: this.pct(g.to) - this.pct(g.from),
            label: this.fill('guards.uncovered', { s: span(g.to - g.from) }),
            title: this.fill('guards.uncoveredTitle', { from: this.f(g.from), to: this.f(g.to) }),
          }))
        : [];
      const hint = this.fill('guards.changeHint', { d: this.weekdays()[guard.changeDay], t: guard.changeTime });
      return { guard, bars, swapBars, holes, hint, height: 16 + laneCount * 24 };
    });
  });

  // ===== Ahora, relevos y revisión =====

  private slotsOf(cycleId: string): (GuardSlot & { from: number; to: number })[] {
    return (this.upcoming()?.slots ?? [])
      .filter((s) => s.cycleId === cycleId && !s.paused)
      .map((s) => ({ ...s, ...interval(s) }))
      .sort((x, y) => x.from - y.from);
  }

  protected readonly nowCards = computed(() => {
    const now = this.now();
    const overrides = this.upcoming()?.overrides ?? [];
    return this.guards().map((guard) => {
      const list = this.slotsOf(guard.cycleId);
      const swap = overrides.find((o) => o.cycleId === guard.cycleId && Date.parse(o.startsAt) <= now && Date.parse(o.endsAt) > now);
      const current = list.filter((s) => s.from <= now && s.to > now);
      const after = list.find((s) => s.from > now);
      const next = after ? this.fill('guards.nextFrom', { p: after.name, from: this.f(after.from) }) : guard.mustBeCovered && current.length ? this.i18n.t('guards.nobodyAfter') : this.i18n.t('guards.nothingPlanned');
      if (!current.length && !swap) {
        return { guard, names: this.i18n.t(guard.mustBeCovered ? 'guards.nobodyNow' : 'guards.noEventNow'), alert: guard.mustBeCovered, until: '', next };
      }
      const names = swap ? `${swap.name} (${this.i18n.t('guards.override').toLowerCase()})` : current.map((s) => s.name).join(' + ');
      const end = swap ? Date.parse(swap.endsAt) : Math.max(...current.map((s) => s.to));
      return { guard, names, alert: false, until: this.fill('guards.until', { to: this.f(end), s: span(end - now) }), next };
    });
  });

  protected readonly handoffs = computed(() => {
    const now = this.now();
    const out: { t: number; when: string; guard: string; from: string; to: string; inText: string; soon: boolean }[] = [];
    for (const guard of this.guards()) {
      const list = this.slotsOf(guard.cycleId);
      for (const s of list) {
        if (s.from <= now || s.from > now + 21 * DAY) continue;
        const prev = list.filter((x) => x.id !== s.id && x.to <= s.from + 60_000).sort((x, y) => y.to - x.to)[0];
        out.push({ t: s.from, when: this.f(s.from), guard: guard.label, from: prev?.name ?? '—', to: s.name, inText: this.fill('guards.in', { s: span(s.from - now) }), soon: s.from - now < 2 * DAY });
      }
    }
    return out.sort((x, y) => x.t - y.t).slice(0, 6);
  });

  protected readonly issues = computed(() => {
    const now = this.now();
    const horizon = now + 28 * DAY;
    const out: { t: number; icon: string; tone: string; text: string; action: MessageKey; fix: () => void }[] = [];
    for (const guard of this.guards().filter((g) => g.mustBeCovered)) {
      const covered = this.slotsOf(guard.cycleId).map((s) => ({ from: s.from, to: s.to }));
      for (const g of gaps(covered, now, horizon)) {
        const text = g.to >= horizon - 60_000
          ? this.fill('guards.issue.gapOpen', { g: guard.label, from: this.f(g.from) })
          : this.fill('guards.issue.gap', { g: guard.label, from: this.f(g.from), to: this.f(g.to) });
        out.push({ t: g.from, icon: 'warning', tone: 'crit', text, action: 'guards.cover', fix: () => this.openNew(guard.cycleId, g.from, Math.min(g.to, g.from + 7 * DAY)) });
      }
    }
    const absences = this.upcoming()?.absences ?? [];
    for (const guard of this.guards()) {
      for (const s of this.slotsOf(guard.cycleId).filter((x) => x.to > now && x.from < horizon)) {
        const clash = absences.find((a) => a.userId === s.userId && absenceInterval(a).from < s.to && s.from < absenceInterval(a).to);
        if (!clash) continue;
        out.push({ t: s.from, icon: 'event_busy', tone: 'warn', text: this.fill('guards.issue.absence', { p: s.name, g: guard.label, c: this.i18n.t(ABSENCE_KEY[clash.condition]).toLowerCase(), from: this.f(s.from, false) }), action: 'guards.review', fix: () => this.edit(s) });
      }
    }
    return out.sort((x, y) => x.t - y.t);
  });

  // ===== Panel: guardia =====

  protected readonly draft = computed(() => {
    const p = this.panel();
    return p?.kind === 'slot' ? p.draft : null;
  });

  protected readonly draftGuard = computed(() => {
    const d = this.draft();
    return d ? this.guardOf(d.cycleId) : undefined;
  });

  /** Todas las guardias que importan para revisar: lo que se ve y lo próximo, sin repetir. */
  private allSlots(): GuardSlot[] {
    const map = new Map<string, GuardSlot>();
    for (const s of [...(this.view()?.slots ?? []), ...(this.upcoming()?.slots ?? [])]) map.set(s.id, s);
    return [...map.values()];
  }

  private allAbsences(): Absence[] {
    const seen = new Set<string>();
    return [...(this.view()?.absences ?? []), ...(this.upcoming()?.absences ?? [])].filter((a) => {
      const k = `${a.userId}|${a.from}|${a.condition}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }

  protected readonly people = computed(() => {
    const d = this.draft();
    const guard = this.draftGuard();
    if (!d || !guard) return [];
    const slots = this.allSlots();
    const absences = this.allAbsences();
    return guard.members.map((m) => {
      const busy = slots.find((s) => s.id !== d.id && (m.userId ? s.userId === m.userId : s.name === m.name) && interval(s).from < d.to && d.from < interval(s).to);
      const away = absences.find((a) => a.userId === m.userId && absenceInterval(a).from < d.to && d.from < absenceInterval(a).to);
      const note = away
        ? { text: this.i18n.t(ABSENCE_KEY[away.condition]), tone: 'crit' }
        : busy
          ? { text: this.fill('guards.inGuard', { g: this.guardOf(busy.cycleId)?.label ?? '' }), tone: 'warn' }
          : { text: this.i18n.t('guards.free'), tone: 'ok' };
      return { member: m, on: m.teamMemberId === d.teamMemberId, note };
    });
  });

  protected readonly draftChecks = computed(() => {
    const d = this.draft();
    if (!d) return [];
    return checks(d, this.guards(), this.allSlots(), this.allAbsences(), this.days()).map((c) => {
      const look = CHECK_LOOK[c.kind];
      const values = c.values['c'] ? { ...c.values, c: this.i18n.t(ABSENCE_KEY[c.values['c'] as Absence['condition']]).toLowerCase() } : c.values;
      return { icon: look.icon, tone: look.tone, text: this.fill(look.key, values) };
    });
  });

  protected readonly lengths: { days: number; key: MessageKey }[] = [
    { days: 7, key: 'guards.len.week' },
    { days: 14, key: 'guards.len.twoWeeks' },
    { days: 2, key: 'guards.len.weekend' },
  ];

  protected openNew(cycleId?: string, from?: number, to?: number): void {
    const guard = cycleId ? this.guardOf(cycleId) : this.guards()[0];
    if (!guard) return;
    const start = from ?? suggestedStart(guard, this.allSlots(), this.now());
    this.setPanel({ kind: 'slot', draft: { cycleId: guard.cycleId, teamMemberId: '', from: start, to: to ?? start + 7 * DAY } });
  }

  protected edit(slot: GuardSlot): void {
    this.setPanel({ kind: 'slot', draft: { id: slot.id, cycleId: slot.cycleId, teamMemberId: slot.teamMemberId, ...interval(slot) } });
  }

  protected patchDraft(patch: Partial<Draft>): void {
    const d = this.draft();
    if (d) this.panel.set({ kind: 'slot', draft: { ...d, ...patch } });
  }

  protected pickGuard(cycleId: string): void {
    const d = this.draft();
    if (d && !d.id) this.patchDraft({ cycleId, teamMemberId: '' });
  }

  protected toInput = toLocalInput;

  protected setFrom(value: string): void {
    const d = this.draft();
    const from = fromLocalInput(value);
    if (d && from) this.patchDraft({ from, to: from + (d.to - d.from) });
  }

  protected setTo(value: string): void {
    const to = fromLocalInput(value);
    if (to) this.patchDraft({ to });
  }

  protected readonly canSave = computed(() => {
    const d = this.draft();
    return !!d && !!d.teamMemberId && d.to > d.from;
  });

  protected async saveSlot(): Promise<void> {
    const d = this.draft();
    if (!d || !this.canSave()) return;
    await this.run(async () => {
      await this.api.saveSlot({ cycleId: d.cycleId, teamMemberId: d.teamMemberId, startsAt: new Date(d.from), endsAt: new Date(d.to) }, d.id);
      this.panel.set(null);
      await this.load();
    }, this.i18n.t(d.id ? 'guards.saved' : 'guards.created'));
  }

  protected async deleteSlot(): Promise<void> {
    const d = this.draft();
    if (!d?.id) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    await this.run(async () => {
      await this.api.deleteSlot(d.id!);
      this.panel.set(null);
      await this.load();
    }, this.i18n.t('guards.deleted'));
  }

  protected openOverride(): void {
    const d = this.draft();
    if (!d) return;
    const from = Math.max(d.from, this.now());
    this.overrideMemberId.set('');
    this.overrideFrom.set(toLocalInput(from));
    this.overrideTo.set(toLocalInput(Math.min(d.to, from + DAY)));
    this.overrideReason.set('');
    this.overrideOpen.set(true);
  }

  protected async saveOverride(): Promise<void> {
    const d = this.draft();
    const from = fromLocalInput(this.overrideFrom());
    const to = fromLocalInput(this.overrideTo());
    if (!d || !this.overrideMemberId() || !from || to <= from) return;
    await this.run(async () => {
      await this.api.addOverride(d.cycleId, d.teamMemberId, this.overrideMemberId(), new Date(from), new Date(to), this.overrideReason().trim());
      this.overrideOpen.set(false);
      await this.load();
    }, this.i18n.t('guards.overrideSaved'));
  }

  // ===== Panel: rotación =====

  protected readonly rotation = computed(() => {
    const p = this.panel();
    return p?.kind === 'rotation' ? p : null;
  });

  protected openRotation(cycleId?: string): void {
    const guard = cycleId ? this.guardOf(cycleId) : this.guards().find((g) => g.mustBeCovered) ?? this.guards()[0];
    if (!guard) return;
    this.setPanel({ kind: 'rotation', cycleId: guard.cycleId, order: guard.members.map((m) => m.teamMemberId), from: suggestedStart(guard, this.allSlots(), this.now()), daysEach: 7, count: 4 });
  }

  protected patchRotation(patch: Partial<Extract<Panel, { kind: 'rotation' }>>): void {
    const r = this.rotation();
    if (r) this.panel.set({ ...r, ...patch });
  }

  protected setRotationFrom(value: string): void {
    const from = fromLocalInput(value);
    if (from) this.patchRotation({ from });
  }

  protected rotationGuard(cycleId: string): void {
    const guard = this.guardOf(cycleId);
    if (guard) this.patchRotation({ cycleId, order: guard.members.map((m) => m.teamMemberId), from: suggestedStart(guard, this.allSlots(), this.now()) });
  }

  protected inRotation(id: string): boolean {
    return !!this.rotation()?.order.includes(id);
  }

  protected toggleInRotation(id: string): void {
    const r = this.rotation();
    if (!r) return;
    this.patchRotation({ order: r.order.includes(id) ? r.order.filter((x) => x !== id) : [...r.order, id] });
  }

  protected move(id: string, step: -1 | 1): void {
    const r = this.rotation();
    if (!r) return;
    const order = [...r.order];
    const i = order.indexOf(id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this.patchRotation({ order });
  }

  protected readonly rotationMembers = computed(() => {
    const r = this.rotation();
    const guard = r ? this.guardOf(r.cycleId) : undefined;
    if (!r || !guard) return [];
    const inOrder = r.order.map((id) => guard.members.find((m) => m.teamMemberId === id)).filter((m) => !!m);
    return [...inOrder, ...guard.members.filter((m) => !r.order.includes(m.teamMemberId))];
  });

  protected readonly rotationPreview = computed(() => {
    const r = this.rotation();
    const guard = r ? this.guardOf(r.cycleId) : undefined;
    if (!r || !guard || !r.order.length) return [];
    const absences = this.allAbsences();
    const existing = this.allSlots().filter((s) => s.cycleId === r.cycleId);
    return Array.from({ length: r.count }, (_, i) => {
      const from = r.from + i * r.daysEach * DAY;
      const to = from + r.daysEach * DAY;
      const member = guard.members.find((m) => m.teamMemberId === r.order[i % r.order.length])!;
      const away = absences.find((a) => a.userId === member.userId && absenceInterval(a).from < to && from < absenceInterval(a).to);
      const overlap = existing.find((s) => interval(s).from < to && from < interval(s).to);
      const note = away
        ? { text: `⚠ ${this.i18n.t(ABSENCE_KEY[away.condition])}`, tone: 'crit' }
        : overlap
          ? { text: this.fill('guards.rot.overlaps', { p: overlap.name }), tone: 'warn' }
          : { text: 'ok', tone: 'ok' };
      return { range: `${this.f(from)} → ${this.f(to)}`, name: member.name, note };
    });
  });

  protected async applyRotation(): Promise<void> {
    const r = this.rotation();
    if (!r || !r.order.length) return;
    const count = r.count;
    await this.run(async () => {
      await this.api.generateRotation(r.cycleId, r.order, new Date(r.from), r.daysEach, count);
      this.panel.set(null);
      if (count * r.daysEach > 14) this.spanDays.set(28);
      await this.load();
    }, this.fill('guards.rot.created', { n: String(count) }));
  }

  // ===== Panel: configuración de una guardia =====

  protected readonly config = computed(() => {
    const p = this.panel();
    return p?.kind === 'config' ? p : null;
  });

  protected readonly workShifts = computed(() => this.upcoming()?.workShifts ?? this.view()?.workShifts ?? []);

  protected openConfig(guard: Guard): void {
    this.setPanel({ kind: 'config', cycleId: guard.cycleId, mustBeCovered: guard.mustBeCovered, changeDay: guard.changeDay, workShiftId: guard.workShiftId ?? '' });
  }

  protected patchConfig(patch: Partial<Extract<Panel, { kind: 'config' }>>): void {
    const c = this.config();
    if (c) this.panel.set({ ...c, ...patch });
  }

  protected configTime(workShiftId: string): string {
    return this.workShifts().find((w) => w.id === workShiftId)?.startTime ?? '09:00';
  }

  protected async saveConfig(): Promise<void> {
    const c = this.config();
    if (!c) return;
    await this.run(async () => {
      await this.api.updateGuard(c.cycleId, { mustBeCovered: c.mustBeCovered, changeDay: c.changeDay, ...(c.workShiftId ? { workShiftId: c.workShiftId } : { clearWorkShift: true }) });
      this.panel.set(null);
      await this.load();
    }, this.i18n.t('guards.config.saved'));
  }

  // ===== Panel: CSV =====

  protected openImport(): void {
    this.importResult.set(null);
    this.setPanel({ kind: 'import' });
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    await this.run(async () => {
      this.importResult.set(await this.api.importCsv(text));
      await this.load();
    });
  }

  protected async downloadTemplate(): Promise<void> {
    await this.run(() => this.api.downloadTemplate());
  }

  // ===== Navegación y carga =====

  async ngOnInit(): Promise<void> {
    await this.run(() => this.load());
  }

  protected async shift(weeks: number): Promise<void> {
    this.start.set(this.start() + weeks * 7 * DAY);
    await this.run(() => this.loadView());
  }

  protected async today(): Promise<void> {
    this.start.set(weekStart(Date.now()));
    await this.run(() => this.loadView());
  }

  protected async zoom(days: 14 | 28): Promise<void> {
    this.spanDays.set(days);
    await this.run(() => this.loadView());
  }

  protected closePanel(): void {
    this.panel.set(null);
    this.confirmDelete.set(false);
    this.overrideOpen.set(false);
  }

  private setPanel(panel: Panel): void {
    this.confirmDelete.set(false);
    this.overrideOpen.set(false);
    this.panel.set(panel);
  }

  /** Margen de un mes a cada lado: para ver quién venía antes y avisar huecos. */
  private async loadView(): Promise<void> {
    this.view.set(await this.api.timeline(new Date(this.start() - 31 * DAY), new Date(this.end() + 31 * DAY)));
  }

  private async load(): Promise<void> {
    const now = Date.now();
    const [view, upcoming] = await Promise.all([
      this.api.timeline(new Date(this.start() - 31 * DAY), new Date(this.end() + 31 * DAY)),
      this.api.timeline(new Date(now - 31 * DAY), new Date(now + 35 * DAY)),
    ]);
    this.view.set(view);
    this.upcoming.set(upcoming);
  }

  private async run(action: () => Promise<unknown>, successText?: string): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      if (successText) this.notice.set(successText);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('shiftsAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
