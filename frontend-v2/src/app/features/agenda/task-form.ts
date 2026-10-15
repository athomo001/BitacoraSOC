import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  AgendaAreaOptions, AgendaAssignee, AgendaMeta, AgendaService, AgendaTask, AgendaTaskInput, AssigneeKind, PreviewDate, Recurrence, RecurrenceKind,
} from '../../core/agenda/agenda.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { fmtDay, recurrenceText, weekdayNames } from './agenda-format';

const KINDS: RecurrenceKind[] = ['once', 'days', 'weekly', 'bizN', 'lastBiz', 'fixed'];
const WHO: { kind: AssigneeKind; icon: string; key: MessageKey }[] = [
  { kind: 'person', icon: 'person', key: 'ag.who.person' },
  { kind: 'level', icon: 'groups', key: 'ag.who.level' },
  { kind: 'guard', icon: 'shield', key: 'ag.who.guard' },
];
const WARN_OPTIONS = [3, 2, 1, 0];

/**
 * Nueva tarea / editar tarea de la Agenda (9.3, diseño aprobado
 * 2026-10-14): quién la hace (persona, nivel o guardia: los que no puedes
 * asignar salen apagados), cuándo (una vez, cada N días, semanal, día hábil
 * N, último día hábil o día fijo que se corre) con las próximas fechas
 * calculadas por el servidor, avisos, pasos e informe que la cierra.
 */
@Component({
  selector: 'app-agenda-task-form',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="tf" (submit)="$event.preventDefault(); save()">
      <div class="adm-card__head">
        <h2 class="adm-card__title"><mat-icon>{{ task() ? 'edit' : 'add_task' }}</mat-icon>{{ task() ? task()!.name : i18n.t('ag.new') }}</h2>
        <button type="button" class="adm-icon-btn adm-push" [attr.aria-label]="i18n.t('ag.close')" (click)="cancelled.emit()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="tf__body">
        <div class="tf__grid tf__grid--2">
          <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.name') }}</span>
            <input class="adm-input" name="name" required maxlength="200" [value]="draft().name" (input)="patch({ name: val($event) })" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.client') }}</span>
            <select class="adm-input" name="client" (change)="patch({ clientId: val($event) || null })">
              <option value="" [selected]="!draft().clientId">{{ i18n.t('ag.form.noClient') }}</option>
              @for (c of clients(); track c.id) { <option [value]="c.id" [selected]="c.id === draft().clientId">{{ c.name }}</option> }
            </select></label>
        </div>
        <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.desc') }}</span>
          <textarea class="adm-input" name="description" rows="2" maxlength="5000" [value]="draft().description" (input)="patch({ description: val($event) })"></textarea></label>

        <div class="tf__grid tf__grid--2">
          <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.area') }}</span>
            <select class="adm-input" name="area" (change)="setArea(val($event))">
              @for (a of meta().areas; track a.id) { <option [value]="a.id" [selected]="a.id === draft().areaId">{{ a.name }}</option> }
            </select></label>
        </div>

        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('ag.form.who') }}</span>
          <div class="tf__chips">
            @for (w of who; track w.kind) {
              <button type="button" class="seg" [attr.aria-pressed]="draft().assigneeKind === w.kind" (click)="setKind(w.kind)"><mat-icon>{{ w.icon }}</mat-icon>{{ i18n.t(w.key) }}</button>
            }
          </div>
          <div class="tf__chips">
            @for (x of targets(); track x.id) {
              <button type="button" class="seg" [attr.aria-pressed]="draft().assigneeId === x.id" [disabled]="!x.allowed"
                [attr.title]="x.allowed ? null : i18n.t('ag.who.upHint')" (click)="patch({ assigneeId: x.id })">{{ x.id === meta().me ? x.name + ' (' + i18n.t('ag.you') + ')' : x.name }}</button>
            } @empty {
              <span class="adm-hint">{{ i18n.t('ag.who.none') }}</span>
            }
          </div>
          <span class="adm-hint">{{ whoHint() }}</span>
        </div>

        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('ag.form.when') }}</span>
          <div class="tf__chips">
            @for (k of kinds; track k) {
              <button type="button" class="seg" [attr.aria-pressed]="rec().kind === k" (click)="setRecKind(k)">{{ i18n.t(kindKey(k)) }}</button>
            }
          </div>
          <div class="tf__rec">
            @switch (rec().kind) {
              @case ('once') {
                <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.date') }}</span>
                  <input class="adm-input" type="date" name="date" [min]="meta().today" [value]="rec().date ?? ''" (change)="setRec({ date: val($event) })" /></label>
              }
              @case ('days') {
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.every') }}</span>
                  <input class="adm-input" type="number" name="every" min="1" max="366" [value]="rec().every ?? 7" (change)="setRec({ every: num($event, 1, 366) })" /></label>
                <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.start') }}</span>
                  <input class="adm-input" type="date" name="start" [value]="rec().start ?? ''" (change)="setRec({ start: val($event) })" /></label>
              }
              @case ('weekly') {
                <div class="tf__chips">
                  @for (d of weekOrder; track d) {
                    <button type="button" class="seg" [attr.aria-pressed]="(rec().weekdays ?? []).includes(d)" (click)="toggleWeekday(d)">{{ dayNames()[d] }}</button>
                  }
                </div>
              }
              @case ('bizN') {
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.n') }}</span>
                  <input class="adm-input" type="number" name="n" min="1" max="23" [value]="rec().n ?? 5" (change)="setRec({ n: num($event, 1, 23) })" /></label>
              }
              @case ('lastBiz') { <span class="adm-hint">{{ i18n.t('ag.lastBizHint') }}</span> }
              @case ('fixed') {
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.day') }}</span>
                  <input class="adm-input" type="number" name="day" min="1" max="31" [value]="rec().day ?? 25" (change)="setRec({ day: num($event, 1, 31) })" /></label>
                <div class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.ifOff') }}</span>
                  <div class="tf__chips">
                    <button type="button" class="seg" [attr.aria-pressed]="rec().shift === 'prev'" (click)="setRec({ shift: 'prev' })">{{ i18n.t('ag.shift.prev') }}</button>
                    <button type="button" class="seg" [attr.aria-pressed]="rec().shift === 'next'" (click)="setRec({ shift: 'next' })">{{ i18n.t('ag.shift.next') }}</button>
                  </div></div>
              }
            }
          </div>
          <div class="tf__preview" aria-live="polite">
            <b>{{ recText() }}</b>
            @for (p of preview(); track p.date) {
              <span class="tf__date"><mat-icon>event</mat-icon><b>{{ day(p.date, true) }}</b>
                @if (p.movedFrom) { <span class="tf__moved">{{ i18n.tf('ag.form.movedFrom', day(p.movedFrom)) }}{{ p.reason ? ' · ' + p.reason : '' }}</span> }</span>
            }
            <span class="adm-hint">{{ i18n.tf('ag.form.previewHint', meta().dayEnd) }}</span>
          </div>
        </div>

        @if (!task() && rec().kind === 'once') {
          <div class="tf__window">
            <label class="tf__check"><input type="checkbox" name="withWindow" [checked]="withWindow()" (change)="withWindow.set(!withWindow())" />
              <b>{{ i18n.t('ag.form.window') }}</b></label>
            @if (withWindow()) {
              <div class="tf__rec">
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.windowFrom') }}</span>
                  <input class="adm-input mono" type="time" name="winStart" [value]="winStart()" (change)="winStart.set(val($event))" /></label>
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.windowTo') }}</span>
                  <input class="adm-input mono" type="time" name="winEnd" [value]="winEnd()" (change)="winEnd.set(val($event))" /></label>
                <label class="tf__check"><input type="checkbox" name="winSuppress" [checked]="winSuppress()" (change)="winSuppress.set(!winSuppress())" />{{ i18n.t('ag.form.windowSuppress') }}</label>
              </div>
            }
            <span class="adm-hint">{{ i18n.t('ag.form.windowHint') }}</span>
          </div>
        }

        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('ag.form.warn') }}</span>
          <div class="tf__chips">
            @for (w of warnOptions; track w) {
              <button type="button" class="seg" [attr.aria-pressed]="draft().warnDays.includes(w)" (click)="toggleWarn(w)">{{ warnLabel(w) }}</button>
            }
            <button type="button" class="seg" aria-pressed="true" disabled>{{ i18n.t('ag.warn.late') }}</button>
          </div>
          <span class="adm-hint">{{ i18n.t('ag.warnHint') }}</span>
        </div>

        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('ag.form.steps') }}</span>
          @for (s of draft().steps; track $index) {
            <div class="tf__step">
              <span class="mono adm-secondary">{{ $index + 1 }}.</span>
              <input class="adm-input" [name]="'step' + $index" maxlength="300" [value]="s" (input)="setStep($index, val($event))" />
              <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('ag.form.removeStep')" (click)="removeStep($index)"><mat-icon>close</mat-icon></button>
            </div>
          }
          <span><button type="button" class="adm-btn" (click)="addStep()"><mat-icon>add</mat-icon>{{ i18n.t('ag.form.addStep') }}</button></span>
        </div>

        <div class="tf__grid tf__grid--2">
          @if (draft().clientId) {
            <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.report') }}</span>
              <select class="adm-input" name="report" (change)="patch({ reportKind: $any(val($event)) })">
                <option value="" [selected]="!draft().reportKind">{{ i18n.t('ag.form.noReport') }}</option>
                <option value="incident" [selected]="draft().reportKind === 'incident'">{{ i18n.t('ag.report.incident') }}</option>
                <option value="bulletin" [selected]="draft().reportKind === 'bulletin'">{{ i18n.t('ag.report.bulletin') }}</option>
              </select>
              <span class="adm-hint">{{ i18n.t('ag.form.reportHint') }}</span></label>
          }
          <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.doc') }}</span>
            <input class="adm-input mono" type="url" name="docUrl" maxlength="500" placeholder="https://" [value]="draft().docUrl" (input)="patch({ docUrl: val($event) })" /></label>
        </div>

        @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

        <div class="tf__foot">
          @if (task()?.canEdit) {
            @if (confirming()) {
              <span class="adm-small">{{ i18n.tf('ag.form.deactivateConfirm', task()!.name) }}</span>
              <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="deactivate()">{{ i18n.t('ag.form.yes') }}</button>
              <button type="button" class="adm-btn" (click)="confirming.set(false)">{{ i18n.t('ag.form.no') }}</button>
            } @else {
              <button type="button" class="adm-btn" (click)="confirming.set(true)"><mat-icon>block</mat-icon>{{ i18n.t('ag.form.deactivate') }}</button>
            }
          }
          <span class="adm-push"></span>
          <button type="button" class="adm-btn" (click)="cancelled.emit()">{{ i18n.t('ag.cancel') }}</button>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !canSave()"><mat-icon>check</mat-icon>{{ task() ? i18n.t('ag.save') : i18n.t('ag.form.create') }}</button>
        </div>
      </div>
    </form>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tf__body { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; }
    .tf__grid { display: grid; gap: 10px; }
    .tf__grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tf__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .tf__rec { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .tf__rec:empty { display: none; }
    .tf__preview { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); }
    .tf__date { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; }
    .tf__date mat-icon { color: var(--text-muted); }
    .tf__moved { color: var(--status-warning); font-size: 11.5px; }
    .tf__step { display: grid; grid-template-columns: 22px minmax(0, 1fr) 28px; align-items: center; gap: 6px; }
    .tf__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .tf__window { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); }
    .tf__check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
    @media (max-width: 720px) { .tf__grid--2 { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AgendaTaskFormComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);
  private readonly orgs = inject(OrganizationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly meta = input.required<AgendaMeta>();
  readonly task = input<AgendaTask | null>(null);
  readonly saved = output<AgendaTask>();
  readonly cancelled = output<void>();
  readonly removed = output<void>();

  protected readonly kinds = KINDS;
  protected readonly who = WHO;
  protected readonly warnOptions = WARN_OPTIONS;
  /** Lunes primero. */
  protected readonly weekOrder = [1, 2, 3, 4, 5, 6, 0];

  protected readonly draft = signal<AgendaTaskInput>({
    name: '', description: '', areaId: '', clientId: null, assigneeKind: 'person', assigneeId: '',
    recurrence: { kind: 'once' }, warnDays: [0], steps: [], docUrl: '', reportKind: '',
  });
  protected readonly clients = signal<Organization[]>([]);
  protected readonly preview = signal<PreviewDate[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly withWindow = signal(false);
  protected readonly winStart = signal('22:00');
  protected readonly winEnd = signal('02:00');
  protected readonly winSuppress = signal(false);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly rec = computed(() => this.draft().recurrence);
  protected readonly area = computed<AgendaAreaOptions | undefined>(() => this.meta().areas.find((a) => a.id === this.draft().areaId));
  protected readonly targets = computed<AgendaAssignee[]>(() => {
    const a = this.area();
    if (!a) return [];
    return { person: a.people, level: a.levels, guard: a.guards }[this.draft().assigneeKind];
  });
  protected readonly dayNames = computed(() => weekdayNames(this.prefs.language()));
  protected readonly recText = computed(() => recurrenceText(this.rec(), this.i18n, this.prefs.language()));
  protected readonly canSave = computed(() => {
    const d = this.draft();
    return d.name.trim() !== '' && d.areaId !== '' && d.assigneeId !== '' && this.targets().some((x) => x.id === d.assigneeId && (x.allowed || x.id === this.meta().me));
  });
  protected readonly whoHint = computed(() => {
    switch (this.draft().assigneeKind) {
      case 'level': return this.i18n.t('ag.who.levelHint');
      case 'guard': return this.i18n.t('ag.who.guardHint');
      default: return this.targets().some((x) => !x.allowed) ? this.i18n.t('ag.who.upHint') : '';
    }
  });

  async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => { if (this.previewTimer) clearTimeout(this.previewTimer); });
    const t = this.task();
    if (t) {
      this.draft.set({
        name: t.name, description: t.description, areaId: t.areaId, clientId: t.clientId ?? null, assigneeKind: t.assigneeKind,
        assigneeId: t.assigneeId ?? '', recurrence: { ...t.recurrence }, warnDays: [...t.warnDays], steps: [...t.steps],
        docUrl: t.docUrl ?? '', reportKind: t.reportKind ?? '',
      });
    } else {
      const m = this.meta();
      const area = m.areas.find((a) => a.mine) ?? m.areas[0];
      this.draft.update((d) => ({ ...d, areaId: area?.id ?? '', recurrence: { kind: 'once', date: m.today } }));
      this.pickDefaultAssignee();
    }
    this.schedulePreview();
    try {
      this.clients.set(await this.orgs.list({ clients: true, active: true }));
    } catch {
      this.clients.set([]);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected num(e: Event, min: number, max: number): number {
    const n = Math.round(Number(this.val(e)));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }

  protected day(iso: string, withYear = false): string {
    return fmtDay(iso, this.prefs.language(), withYear);
  }

  protected kindKey(k: RecurrenceKind): MessageKey {
    return `ag.kind.${k}` as MessageKey;
  }

  protected warnLabel(w: number): string {
    if (w === 0) return this.i18n.t('ag.warn.0');
    return w === 1 ? this.i18n.t('ag.warn.1') : this.i18n.tf('ag.warn.n', w);
  }

  protected patch(p: Partial<AgendaTaskInput>): void {
    this.draft.update((d) => ({ ...d, ...p }));
    this.error.set(null);
  }

  protected setArea(id: string): void {
    this.patch({ areaId: id });
    this.pickDefaultAssignee();
  }

  protected setKind(kind: AssigneeKind): void {
    this.patch({ assigneeKind: kind });
    this.pickDefaultAssignee();
  }

  /** Elige el primer responsable permitido (en persona, uno mismo). */
  private pickDefaultAssignee(): void {
    const d = this.draft();
    const list = this.targets();
    if (list.some((x) => x.id === d.assigneeId && x.allowed)) return;
    const me = d.assigneeKind === 'person' ? list.find((x) => x.id === this.meta().me) : undefined;
    const first = me ?? list.find((x) => x.allowed);
    this.draft.update((x) => ({ ...x, assigneeId: first?.id ?? '' }));
  }

  protected setRecKind(kind: RecurrenceKind): void {
    const today = this.meta().today;
    const defaults: Record<RecurrenceKind, Recurrence> = {
      once: { kind, date: today },
      days: { kind, every: 7, start: today },
      weekly: { kind, weekdays: [1] },
      bizN: { kind, n: 5 },
      lastBiz: { kind },
      fixed: { kind, day: 25, shift: 'prev' },
    };
    this.patch({ recurrence: defaults[kind] });
    this.schedulePreview();
  }

  protected setRec(p: Partial<Recurrence>): void {
    this.patch({ recurrence: { ...this.rec(), ...p } });
    this.schedulePreview();
  }

  protected toggleWeekday(d: number): void {
    const cur = this.rec().weekdays ?? [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    if (next.length) this.setRec({ weekdays: next });
  }

  protected toggleWarn(w: number): void {
    const cur = this.draft().warnDays;
    this.patch({ warnDays: cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort((a, b) => b - a) });
  }

  protected addStep(): void {
    this.patch({ steps: [...this.draft().steps, ''] });
  }

  protected setStep(i: number, text: string): void {
    this.patch({ steps: this.draft().steps.map((s, j) => (j === i ? text : s)) });
  }

  protected removeStep(i: number): void {
    this.patch({ steps: this.draft().steps.filter((_, j) => j !== i) });
  }

  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.loadPreview(), 250);
  }

  private async loadPreview(): Promise<void> {
    try {
      this.preview.set(await this.api.preview(this.rec()));
    } catch {
      this.preview.set([]);
    }
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);
    const d = this.draft();
    const input: AgendaTaskInput = { ...d, reportKind: d.clientId ? d.reportKind : '', steps: d.steps.map((s) => s.trim()).filter(Boolean) };
    if (!this.task() && d.recurrence.kind === 'once' && this.withWindow()) {
      input.window = { start: this.winStart(), end: this.winEnd(), suppress: this.winSuppress() };
    }
    try {
      const t = this.task();
      this.saved.emit(t ? await this.api.updateTask(t.id, input) : await this.api.createTask(input));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deactivate(): Promise<void> {
    const t = this.task();
    if (!t) return;
    this.busy.set(true);
    try {
      await this.api.deleteTask(t.id);
      this.removed.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }
}
