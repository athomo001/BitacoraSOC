import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AgendaMeta, AgendaOccurrence, AgendaService, AgendaTask, CalendarWindow } from '../../core/agenda/agenda.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SseService } from '../../core/sse/sse.service';
import { problemDetail } from '../../core/http-error';
import { AgendaTaskFormComponent } from './task-form';
import { AgendaManagedComponent } from './agenda-managed';
import {
  AgendaBucket, addDays, bucketOf, dueText, fmtDay, isoDay, monthLabel, parseDay, recurrenceText, weekdayNames,
} from './agenda-format';

type Tab = 'mine' | 'calendar' | 'managed';
type Action = 'done' | 'skip' | 'handover' | null;

const BUCKETS: { id: AgendaBucket; key: MessageKey; tone: string }[] = [
  { id: 'late', key: 'ag.grp.late', tone: 'tone-bad' },
  { id: 'today', key: 'ag.grp.today', tone: 'tone-warn' },
  { id: 'soon', key: 'ag.grp.soon', tone: 'tone-system' },
  { id: 'later', key: 'ag.grp.later', tone: 'tone-neutral' },
  { id: 'done', key: 'ag.grp.done', tone: 'tone-ok' },
];
/** Color de cada área en el calendario (en el orden de las áreas). */
const AREA_TONES = ['tone-system', 'tone-info', 'tone-ok', 'tone-warn', 'tone-accent'];
const SKIP_REASONS: MessageKey[] = ['ag.skip.r1', 'ag.skip.r2', 'ag.skip.r3'];

interface CalCell { iso: string; day: number; off: boolean; out: boolean; today: boolean; holiday?: string; items: AgendaOccurrence[]; windows: CalendarWindow[]; }

/**
 * Agenda (spec/16 §4.3, 9.3, diseño aprobado por el dueño 2026-10-14):
 * Mis pendientes (lo mío, de mi nivel y de mi guardia, por vencimiento),
 * Calendario (mes y semana, con días no hábiles sombreados) y Gestión (lo que
 * asigné y cómo va). El servidor decide qué ve cada uno y qué puede hacer.
 */
@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [MatIconModule, AgendaTaskFormComponent, AgendaManagedComponent],
  templateUrl: './agenda.html',
  styleUrl: './agenda.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgendaComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);
  private readonly orgs = inject(OrganizationsService);
  private readonly sse = inject(SseService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly buckets = BUCKETS;
  protected readonly skipReasons = SKIP_REASONS;
  protected readonly tab = signal<Tab>('mine');
  protected readonly meta = signal<AgendaMeta | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);

  protected readonly mine = signal<AgendaOccurrence[]>([]);
  protected readonly selected = signal<AgendaOccurrence | null>(null);
  protected readonly form = signal<{ task: AgendaTask | null } | null>(null);
  protected readonly action = signal<Action>(null);
  protected readonly note = signal('');
  protected readonly link = signal('');
  protected readonly reason = signal('');
  protected readonly handoverTo = signal('');
  protected readonly actionError = signal<string | null>(null);

  protected readonly calMode = signal<'month' | 'week'>('month');
  /** Primer día del mes o lunes de la semana que se muestra. */
  protected readonly calCursor = signal<Date>(new Date());
  protected readonly calArea = signal('');
  protected readonly calClient = signal('');
  protected readonly calOnlyMine = signal(false);
  protected readonly calItems = signal<AgendaOccurrence[]>([]);
  protected readonly calWindows = signal<CalendarWindow[]>([]);
  protected readonly clients = signal<Organization[]>([]);

  /** Sube al guardar una tarea: Gestión se recarga. */
  protected readonly refreshTick = signal(0);

  protected readonly lang = computed(() => this.prefs.language());
  protected readonly grouped = computed(() => {
    const by = new Map<AgendaBucket, AgendaOccurrence[]>();
    for (const o of this.mine()) {
      const b = bucketOf(o);
      by.set(b, [...(by.get(b) ?? []), o]);
    }
    return BUCKETS.map((b) => ({ ...b, items: by.get(b.id) ?? [] })).filter((g) => g.items.length);
  });
  protected readonly lateCount = computed(() => this.mine().filter((o) => o.status === 'pending' && o.late).length);
  protected readonly todayCount = computed(() => this.mine().filter((o) => o.status === 'pending' && !o.late && o.bizDays <= 0).length);
  protected readonly calAreas = computed(() => (this.meta()?.areas ?? []).filter((a) => a.mine || this.meta()?.viewAll));
  protected readonly handoverPeople = computed(() => {
    const o = this.selected();
    const area = this.meta()?.areas.find((a) => a.id === o?.task.areaId);
    return (area?.people ?? []).filter((p) => p.id !== this.meta()?.me);
  });

  protected readonly dowHeader = computed(() => {
    const names = weekdayNames(this.lang());
    return [1, 2, 3, 4, 5, 6, 0].map((d) => names[d]);
  });
  protected readonly calTitle = computed(() => {
    const c = this.calCursor();
    if (this.calMode() === 'month') return monthLabel(c.getUTCFullYear(), c.getUTCMonth(), this.lang());
    return `${fmtDay(isoDay(c), this.lang())} – ${fmtDay(isoDay(addDays(c, 6)), this.lang(), true)}`;
  });
  protected readonly calRange = computed(() => {
    const c = this.calCursor();
    if (this.calMode() === 'week') return { from: c, days: 7 };
    const back = (c.getUTCDay() + 6) % 7; // lunes primero
    return { from: addDays(c, -back), days: 42 };
  });
  protected readonly cells = computed<CalCell[]>(() => {
    const m = this.meta();
    const { from, days } = this.calRange();
    const items = new Map<string, AgendaOccurrence[]>();
    for (const o of this.calItems()) items.set(o.dueDate, [...(items.get(o.dueDate) ?? []), o]);
    const month = this.calCursor().getUTCMonth();
    return Array.from({ length: days }, (_, i) => {
      const d = addDays(from, i);
      const iso = isoDay(d);
      const holiday = m?.holidays[iso];
      // Una ventana aparece en cada día que toca (en la hora local del navegador).
      const dayStart = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
      const windows = this.calWindows().filter((w) => new Date(w.startsAt).getTime() < dayStart + 86_400_000 && new Date(w.endsAt).getTime() > dayStart);
      return {
        iso, day: d.getUTCDate(), holiday, items: items.get(iso) ?? [], windows,
        off: !(m?.workDays ?? []).includes(d.getUTCDay()) || !!holiday,
        out: this.calMode() === 'month' && d.getUTCMonth() !== month,
        today: iso === m?.today,
      };
    });
  });

  async ngOnInit(): Promise<void> {
    try {
      const m = await this.api.meta();
      this.meta.set(m);
      const t = parseDay(m.today);
      this.calCursor.set(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.loadError')));
      this.loaded.set(true);
      return;
    }
    await this.reload();
    const stop = this.sse.connect((type) => {
      if (type === 'agenda.changed') void this.reload(true);
    });
    this.destroyRef.onDestroy(stop);
    void this.orgs.list({ clients: true, active: true }).then((c) => this.clients.set(c), () => this.clients.set([]));
  }

  /** Recarga la pestaña visible (y el detalle abierto). */
  protected async reload(quiet = false): Promise<void> {
    try {
      switch (this.tab()) {
        case 'mine': {
          const list = await this.api.mine();
          this.mine.set(list);
          const sel = this.selected();
          const fresh = sel ? list.find((o) => o.id === sel.id) : undefined;
          if (fresh) this.selected.set(fresh);
          else if (!this.form() && (!sel || !quiet)) this.selected.set(list.find((o) => o.status === 'pending') ?? null);
          break;
        }
        case 'calendar': {
          const { from, days } = this.calRange();
          const list = await this.api.calendar(isoDay(from), isoDay(addDays(from, days - 1)), {
            area: this.calArea(), client: this.calClient(), user: this.calOnlyMine() ? this.meta()?.me : '',
          });
          this.calItems.set(list);
          const end = addDays(from, days);
          this.calWindows.set(await this.api.windows(new Date(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()), new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())).catch(() => []));
          const sel = this.selected();
          if (sel) this.selected.set(list.find((o) => o.id === sel.id && !o.projected) ?? (quiet ? sel : null));
          break;
        }
      }
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.selected.set(null);
    this.form.set(null);
    this.resetAction();
    void this.reload();
  }

  // ===== Formato =====

  protected day(iso: string, withYear = false): string {
    return fmtDay(iso, this.lang(), withYear);
  }

  protected recText(o: { task: AgendaTask } | AgendaTask): string {
    const t = 'task' in o ? o.task : o;
    return recurrenceText(t.recurrence, this.i18n, this.lang());
  }

  protected due(o: AgendaOccurrence): string {
    return dueText(o, this.i18n, this.meta()?.dayEnd ?? '20:00');
  }

  protected holder(o: AgendaOccurrence): string {
    if (o.holderId) return o.holderId === this.meta()?.me ? this.i18n.t('ag.you') : o.holderName ?? '';
    return o.offeredLevel || o.task.assigneeName;
  }

  protected whoIcon(o: AgendaOccurrence): string {
    if (o.holderId) return 'person';
    return o.task.assigneeKind === 'guard' ? 'shield' : 'groups';
  }

  protected areaTone(areaId: string): string {
    const i = (this.meta()?.areas ?? []).findIndex((a) => a.id === areaId);
    return AREA_TONES[(i < 0 ? 0 : i) % AREA_TONES.length];
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  // ===== Selección y formulario =====

  protected select(o: AgendaOccurrence): void {
    if (o.projected) return;
    this.form.set(null);
    this.selected.set(o);
    this.resetAction();
  }

  protected openNew(): void {
    this.selected.set(null);
    this.form.set({ task: null });
  }

  protected async editTask(id: string): Promise<void> {
    try {
      this.form.set({ task: await this.api.task(id) });
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.loadError')));
    }
  }

  protected onSaved(): void {
    this.form.set(null);
    this.refreshTick.update((n) => n + 1);
    void this.reload();
  }

  protected closeForm(): void {
    this.form.set(null);
    if (this.tab() === 'mine') void this.reload();
  }

  // ===== Acciones sobre la ocurrencia =====

  private resetAction(): void {
    this.action.set(null);
    this.note.set('');
    this.link.set('');
    this.reason.set('');
    this.handoverTo.set('');
    this.actionError.set(null);
  }

  protected startAction(a: Action): void {
    this.resetAction();
    this.action.set(a);
  }

  private async run(fn: () => Promise<AgendaOccurrence>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const updated = await fn();
      this.selected.set(updated);
      this.action.set(null);
      await this.reload(true);
    } catch (e) {
      this.actionError.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected take(o: AgendaOccurrence): void { void this.run(() => this.api.take(o.id)); }
  protected release(o: AgendaOccurrence): void { void this.run(() => this.api.release(o.id)); }
  protected reopen(o: AgendaOccurrence): void { void this.run(() => this.api.reopen(o.id)); }
  protected done(o: AgendaOccurrence): void { void this.run(() => this.api.done(o.id, this.note(), this.link())); }
  protected skip(o: AgendaOccurrence): void {
    const r = this.reason().trim();
    if (r) void this.run(() => this.api.skip(o.id, r));
  }
  protected handover(o: AgendaOccurrence): void {
    const to = this.handoverTo();
    if (to) void this.run(() => this.api.handover(o.id, to));
  }

  protected toggleStep(o: AgendaOccurrence, i: number): void {
    const next = o.stepsDone.includes(i) ? o.stepsDone.filter((x) => x !== i) : [...o.stepsDone, i];
    void this.run(() => this.api.steps(o.id, next));
  }

  // ===== Calendario =====

  protected setCalMode(m: 'month' | 'week'): void {
    const c = this.calCursor();
    const today = parseDay(this.meta()!.today);
    if (m === 'week') {
      // la semana de hoy si se ve el mes de hoy; si no, la primera del mes
      const base = c.getUTCMonth() === today.getUTCMonth() && c.getUTCFullYear() === today.getUTCFullYear() ? today : c;
      this.calCursor.set(addDays(base, -((base.getUTCDay() + 6) % 7)));
    } else {
      this.calCursor.set(new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1)));
    }
    this.calMode.set(m);
    void this.reload();
  }

  protected moveCal(dir: -1 | 0 | 1): void {
    const c = this.calCursor();
    if (dir === 0) {
      const t = parseDay(this.meta()!.today);
      this.calCursor.set(this.calMode() === 'month' ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)) : addDays(t, -((t.getUTCDay() + 6) % 7)));
    } else if (this.calMode() === 'month') {
      this.calCursor.set(new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + dir, 1)));
    } else {
      this.calCursor.set(addDays(c, 7 * dir));
    }
    void this.reload();
  }

  protected setCalArea(id: string): void {
    this.calArea.set(id);
    void this.reload();
  }

  protected setCalClient(id: string): void {
    this.calClient.set(id);
    void this.reload();
  }

  protected toggleOnlyMine(): void {
    this.calOnlyMine.set(!this.calOnlyMine());
    void this.reload();
  }
}
