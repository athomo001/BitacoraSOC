import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  AgendaAssignee, AgendaFlow, AgendaFlowStep, AgendaMeta, AgendaService, AssigneeKind, PreviewDate, Recurrence, RecurrenceKind,
} from '../../core/agenda/agenda.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { fmtDay, recurrenceText, weekdayNames } from './agenda-format';

const KINDS: RecurrenceKind[] = ['once', 'weekly', 'bizN', 'lastBiz', 'fixed'];
const WHO: { kind: AssigneeKind; icon: string; key: MessageKey }[] = [
  { kind: 'person', icon: 'person', key: 'ag.who.person' },
  { kind: 'level', icon: 'groups', key: 'ag.who.level' },
  { kind: 'guard', icon: 'shield', key: 'ag.who.guard' },
];
const MAX_STEPS = 20;

interface StepDraft extends AgendaFlowStep {
  /** Pasos internos, uno por línea. */
  checklist: string;
}

/**
 * Flujo nuevo / editar flujo (spec/16 §6.1, 9.7, diseño aprobado por el dueño
 * 2026-10-15): pasos en orden, cada uno de un área y responsable. Cada paso
 * elige si empieza al terminar el anterior (y en cuántos días hábiles vence
 * desde ahí) o en paralelo (días hábiles desde el inicio). Cuándo empieza el
 * flujo usa las recurrencias de la Agenda: una vez o cada cierto tiempo.
 */
@Component({
  selector: 'app-agenda-flow-form',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="ff" (submit)="$event.preventDefault(); save()">
      <div class="adm-card__head">
        <h2 class="adm-card__title"><mat-icon>account_tree</mat-icon>{{ flow() ? flow()!.name : i18n.t('ag.fl.new') }}</h2>
        <button type="button" class="adm-icon-btn adm-push" [attr.aria-label]="i18n.t('ag.close')" (click)="cancelled.emit()"><mat-icon>close</mat-icon></button>
      </div>
      <div class="ff__body">
        <div class="ff__grid">
          <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.name') }}</span>
            <input class="adm-input" name="flowName" required maxlength="200" [value]="name()" (input)="name.set(val($event))" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.client') }}</span>
            <select class="adm-input" name="flowClient" (change)="clientId.set(val($event) || null)">
              <option value="" [selected]="!clientId()">{{ i18n.t('ag.form.noClient') }}</option>
              @for (c of clients(); track c.id) { <option [value]="c.id" [selected]="c.id === clientId()">{{ c.name }}</option> }
            </select></label>
        </div>

        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('ag.fl.when') }}</span>
          <div class="ff__chips">
            @for (k of kinds; track k) {
              <button type="button" class="seg" [attr.aria-pressed]="rec().kind === k" (click)="setRecKind(k)">{{ i18n.t(kindKey(k)) }}</button>
            }
          </div>
          <div class="ff__rec">
            @switch (rec().kind) {
              @case ('once') {
                <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.date') }}</span>
                  <input class="adm-input" type="date" name="flowDate" [value]="rec().date ?? ''" (change)="setRec({ date: val($event) })" /></label>
              }
              @case ('weekly') {
                <div class="ff__chips">
                  @for (d of weekOrder; track d) {
                    <button type="button" class="seg" [attr.aria-pressed]="(rec().weekdays ?? []).includes(d)" (click)="toggleWeekday(d)">{{ dayNames()[d] }}</button>
                  }
                </div>
              }
              @case ('bizN') {
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.n') }}</span>
                  <input class="adm-input" type="number" name="flowN" min="1" max="23" [value]="rec().n ?? 1" (change)="setRec({ n: num($event, 1, 23) })" /></label>
              }
              @case ('fixed') {
                <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.form.day') }}</span>
                  <input class="adm-input" type="number" name="flowDay" min="1" max="31" [value]="rec().day ?? 1" (change)="setRec({ day: num($event, 1, 31) })" /></label>
              }
            }
          </div>
          <span class="ff__preview"><b>{{ recText() }}</b>
            @for (p of preview().slice(0, 3); track p.date) { <span class="pill tone-neutral">{{ day(p.date) }}</span> }</span>
        </div>

        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('ag.fl.steps') }}</span>
          @for (s of steps(); track $index; let i = $index) {
            <fieldset class="ff__step">
              <legend class="ff__legend">
                <span class="pill tone-neutral mono">{{ i + 1 }}</span>
                <span class="ff__tools">
                  <button type="button" class="adm-icon-btn" [disabled]="i === 0" [attr.aria-label]="i18n.t('ag.fl.moveUp')" (click)="move(i, -1)"><mat-icon>arrow_upward</mat-icon></button>
                  <button type="button" class="adm-icon-btn" [disabled]="i === steps().length - 1" [attr.aria-label]="i18n.t('ag.fl.moveDown')" (click)="move(i, 1)"><mat-icon>arrow_downward</mat-icon></button>
                  <button type="button" class="adm-icon-btn" [disabled]="steps().length <= 2" [attr.aria-label]="i18n.t('ag.fl.removeStep')" (click)="remove(i)"><mat-icon>close</mat-icon></button>
                </span>
              </legend>
              <div class="ff__grid">
                <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.name') }}</span>
                  <input class="adm-input" [name]="'stepName' + i" maxlength="200" [value]="s.name" (input)="patch(i, { name: val($event) })" /></label>
                <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.form.area') }}</span>
                  <select class="adm-input" [name]="'stepArea' + i" (change)="setArea(i, val($event))">
                    @for (a of meta().areas; track a.id) { <option [value]="a.id" [selected]="a.id === s.areaId">{{ a.name }}</option> }
                  </select></label>
              </div>
              <div class="ff__chips">
                @for (w of who; track w.kind) {
                  <button type="button" class="seg" [attr.aria-pressed]="s.assigneeKind === w.kind" (click)="setKind(i, w.kind)"><mat-icon>{{ w.icon }}</mat-icon>{{ i18n.t(w.key) }}</button>
                }
              </div>
              <div class="ff__chips">
                @for (x of targets(s); track x.id) {
                  <button type="button" class="seg" [attr.aria-pressed]="s.assigneeId === x.id" [disabled]="!x.allowed && x.id !== meta().me"
                    [attr.title]="x.allowed ? null : i18n.t('ag.who.upHint')" (click)="patch(i, { assigneeId: x.id })">{{ x.name }}</button>
                } @empty {
                  <span class="adm-hint">{{ i18n.t('ag.who.none') }}</span>
                }
              </div>
              @if (i === 0) {
                <span class="adm-hint">{{ i18n.t('ag.fl.firstStep') }}</span>
              } @else {
                <div class="ff__rec">
                  <div class="adm-field">
                    <span class="adm-label">{{ i18n.t('ag.fl.startsWhen') }}</span>
                    <span class="ff__chips">
                      <button type="button" class="seg" [attr.aria-pressed]="s.after" (click)="patch(i, { after: true })"><mat-icon>east</mat-icon>{{ i18n.tf('ag.fl.after', i) }}</button>
                      <button type="button" class="seg" [attr.aria-pressed]="!s.after" (click)="patch(i, { after: false })"><mat-icon>more_horiz</mat-icon>{{ i18n.t('ag.fl.parallel') }}</button>
                    </span>
                  </div>
                  <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ag.fl.days') }}</span>
                    <input class="adm-input" type="number" min="0" max="60" [name]="'stepDays' + i" [value]="s.days" (change)="patch(i, { days: num($event, 0, 60) })" /></label>
                  <span class="adm-hint ff__dayshint">{{ i18n.t(s.after ? 'ag.fl.daysAfter' : 'ag.fl.daysFromStart') }}</span>
                </div>
              }
              <label class="adm-field"><span class="adm-label">{{ i18n.t('ag.fl.checklist') }}</span>
                <textarea class="adm-input" [name]="'stepChecklist' + i" rows="2" [value]="s.checklist" (input)="patch(i, { checklist: val($event) })"></textarea></label>
            </fieldset>
            @if (i < steps().length - 1) {
              <span class="ff__arrow" aria-hidden="true"><mat-icon>{{ steps()[i + 1].after ? 'south' : 'more_vert' }}</mat-icon></span>
            }
          }
          @if (steps().length < maxSteps) {
            <span><button type="button" class="adm-btn" (click)="add()"><mat-icon>add</mat-icon>{{ i18n.t('ag.fl.addStep') }}</button></span>
          }
        </div>

        @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

        <div class="ff__foot">
          @if (flow()?.canEdit) {
            @if (confirming()) {
              <span class="adm-small">{{ i18n.tf('ag.fl.deleteConfirm', flow()!.name) }}</span>
              <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="deleteFlow()">{{ i18n.t('ag.form.yes') }}</button>
              <button type="button" class="adm-btn" (click)="confirming.set(false)">{{ i18n.t('ag.form.no') }}</button>
            } @else {
              <button type="button" class="adm-btn" (click)="confirming.set(true)"><mat-icon>block</mat-icon>{{ i18n.t('ag.fl.delete') }}</button>
            }
          }
          <span class="adm-push"></span>
          <button type="button" class="adm-btn" (click)="cancelled.emit()">{{ i18n.t('ag.cancel') }}</button>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !canSave()"><mat-icon>check</mat-icon>{{ flow() ? i18n.t('ag.save') : i18n.t('ag.form.create') }}</button>
        </div>
      </div>
    </form>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ff__body { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; }
    .ff__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .ff__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .ff__rec { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .ff__rec:empty { display: none; }
    .ff__preview { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; }
    .ff__step { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 8px 12px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); min-width: 0; }
    .ff__legend { display: flex; align-items: center; gap: 8px; width: 100%; padding: 0; }
    .ff__tools { display: inline-flex; gap: 2px; margin-left: auto; }
    .ff__dayshint { align-self: center; }
    .ff__arrow { display: flex; justify-content: center; color: var(--text-muted); }
    .ff__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    @media (max-width: 720px) { .ff__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AgendaFlowFormComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);
  private readonly orgs = inject(OrganizationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly meta = input.required<AgendaMeta>();
  readonly flow = input<AgendaFlow | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  protected readonly kinds = KINDS;
  protected readonly who = WHO;
  protected readonly maxSteps = MAX_STEPS;
  protected readonly weekOrder = [1, 2, 3, 4, 5, 6, 0];

  protected readonly name = signal('');
  protected readonly clientId = signal<string | null>(null);
  protected readonly rec = signal<Recurrence>({ kind: 'once' });
  protected readonly steps = signal<StepDraft[]>([]);
  protected readonly clients = signal<Organization[]>([]);
  protected readonly preview = signal<PreviewDate[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly dayNames = computed(() => weekdayNames(this.prefs.language()));
  protected readonly recText = computed(() => recurrenceText(this.rec(), this.i18n, this.prefs.language()));
  protected readonly canSave = computed(() => {
    const list = this.steps();
    return this.name().trim() !== '' && list.length >= 2 && list.every((s) => s.name.trim() !== '' && s.areaId !== '' && s.assigneeId !== '');
  });

  async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => { if (this.previewTimer) clearTimeout(this.previewTimer); });
    const f = this.flow();
    if (f) {
      this.name.set(f.name);
      this.clientId.set(f.clientId ?? null);
      this.rec.set({ ...f.recurrence });
      this.steps.set(f.steps.map((s) => ({ ...s, checklist: s.steps.join('\n') })));
    } else {
      this.rec.set({ kind: 'once', date: this.meta().today });
      this.steps.set([this.blank(), { ...this.blank(), after: true, days: 1 }]);
    }
    this.schedulePreview();
    try {
      this.clients.set(await this.orgs.list({ clients: true, active: true }));
    } catch {
      this.clients.set([]);
    }
  }

  private blank(): StepDraft {
    const m = this.meta();
    const area = m.areas.find((a) => a.mine) ?? m.areas[0];
    const s: StepDraft = { name: '', description: '', areaId: area?.id ?? '', assigneeKind: 'person', assigneeId: '', after: false, days: 0, steps: [], warnDays: [0], checklist: '' };
    return { ...s, assigneeId: this.firstAllowed(s) };
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected num(e: Event, min: number, max: number): number {
    const n = Math.round(Number(this.val(e)));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }

  protected day(iso: string): string {
    return fmtDay(iso, this.prefs.language(), true);
  }

  protected kindKey(k: RecurrenceKind): MessageKey {
    return `ag.kind.${k}` as MessageKey;
  }

  protected targets(s: StepDraft): AgendaAssignee[] {
    const a = this.meta().areas.find((x) => x.id === s.areaId);
    if (!a) return [];
    return { person: a.people, level: a.levels, guard: a.guards }[s.assigneeKind];
  }

  private firstAllowed(s: StepDraft): string {
    const list = this.targets(s);
    if (list.some((x) => x.id === s.assigneeId && (x.allowed || x.id === this.meta().me))) return s.assigneeId;
    const me = s.assigneeKind === 'person' ? list.find((x) => x.id === this.meta().me) : undefined;
    return (me ?? list.find((x) => x.allowed))?.id ?? '';
  }

  protected patch(i: number, p: Partial<StepDraft>): void {
    this.steps.update((list) => list.map((s, j) => (j === i ? { ...s, ...p } : s)));
    this.error.set(null);
  }

  protected setArea(i: number, areaId: string): void {
    const s = { ...this.steps()[i], areaId };
    this.patch(i, { areaId, assigneeId: this.firstAllowed(s) });
  }

  protected setKind(i: number, kind: AssigneeKind): void {
    const s = { ...this.steps()[i], assigneeKind: kind };
    this.patch(i, { assigneeKind: kind, assigneeId: this.firstAllowed(s) });
  }

  protected add(): void {
    this.steps.update((list) => [...list, { ...this.blank(), after: true, days: 1 }]);
  }

  protected remove(i: number): void {
    this.steps.update((list) => list.filter((_, j) => j !== i));
  }

  protected move(i: number, dir: -1 | 1): void {
    this.steps.update((list) => {
      const next = [...list];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  }

  protected setRecKind(kind: RecurrenceKind): void {
    const today = this.meta().today;
    const defaults: Record<RecurrenceKind, Recurrence> = {
      once: { kind, date: today }, days: { kind, every: 7, start: today }, weekly: { kind, weekdays: [1] },
      bizN: { kind, n: 1 }, lastBiz: { kind }, fixed: { kind, day: 1, shift: 'next' },
    };
    this.rec.set(defaults[kind]);
    this.schedulePreview();
  }

  protected setRec(p: Partial<Recurrence>): void {
    this.rec.update((r) => ({ ...r, ...p }));
    this.schedulePreview();
  }

  protected toggleWeekday(d: number): void {
    const cur = this.rec().weekdays ?? [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    if (next.length) this.setRec({ weekdays: next });
  }

  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.api.preview(this.rec()).then((p) => this.preview.set(p), () => this.preview.set([])), 250);
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);
    const input = {
      name: this.name().trim(), clientId: this.clientId(), recurrence: this.rec(),
      steps: this.steps().map((s, i) => ({
        name: s.name.trim(), description: s.description, areaId: s.areaId, assigneeKind: s.assigneeKind, assigneeId: s.assigneeId,
        after: i > 0 && s.after, days: i > 0 ? s.days : 0, warnDays: s.warnDays, docUrl: s.docUrl ?? '',
        steps: s.checklist.split('\n').map((x) => x.trim()).filter(Boolean),
      })),
    };
    try {
      const f = this.flow();
      if (f) await this.api.updateFlow(f.id, input);
      else await this.api.createFlow(input);
      this.saved.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteFlow(): Promise<void> {
    const f = this.flow();
    if (!f) return;
    this.busy.set(true);
    try {
      await this.api.deleteFlow(f.id);
      this.saved.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }
}
