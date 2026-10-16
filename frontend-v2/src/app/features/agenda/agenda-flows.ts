import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AgendaFlow, AgendaFlowRunStep, AgendaFlowStep, AgendaMeta, AgendaService } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SseService } from '../../core/sse/sse.service';
import { problemDetail } from '../../core/http-error';
import { AgendaFlowFormComponent } from './flow-form';
import { fmtDay, recurrenceText } from './agenda-format';

type StepState = 'done' | 'skipped' | 'now' | 'late' | 'wait';

/**
 * Agenda → Flujos (spec/16 §6.1, 9.7, diseño aprobado por el dueño
 * 2026-10-15): los flujos entre áreas con la vuelta en curso. Cada paso es
 * una tarjeta unida por flechas (la idea del flujo de escalamiento del
 * legacy); la flecha punteada marca un paso en paralelo. Los pasos se hacen
 * desde Mis pendientes, como cualquier tarea.
 */
@Component({
  selector: 'app-agenda-flows',
  standalone: true,
  imports: [MatIconModule, AgendaFlowFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (form(); as f) {
      <app-agenda-flow-form [meta]="meta()" [flow]="f.flow" (saved)="onSaved()" (cancelled)="form.set(null)" />
    } @else {
      <div class="af__bar">
        <span class="adm-hint">{{ i18n.t('ag.fl.hint') }}</span>
        <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="form.set({ flow: null })"><mat-icon>add</mat-icon>{{ i18n.t('ag.fl.new') }}</button>
      </div>
      @for (f of flows(); track f.id) {
        <article class="af__flow" [class.af__flow--on]="selectedId() === f.id">
          <button type="button" class="af__head" [attr.aria-expanded]="selectedId() === f.id" (click)="toggle(f)">
            <span class="af__title"><b>{{ f.name }}</b>
              @if (f.clientName) { <span class="pill tone-info">{{ f.clientName }}</span> }
              <span class="af__sub">{{ recText(f) }}@if (f.run) { · {{ i18n.tf('ag.fl.progress', f.run.done + ' / ' + f.steps.length) }} }</span>
            </span>
            <span class="pill {{ stateTone(f.state) }}">{{ i18n.t(stateKey(f.state)) }}</span>
          </button>
          @if (selectedId() === f.id) {
            <div class="af__chain">
              @for (s of f.steps; track s.taskId; let i = $index) {
                @if (i > 0) {
                  <span class="af__arrow" [title]="i18n.t(s.after ? 'ag.fl.afterTitle' : 'ag.fl.parallel')"><mat-icon>{{ s.after ? 'east' : 'more_horiz' }}</mat-icon></span>
                }
                <button type="button" class="af__step af__step--{{ stepState(f, s) }}" [attr.aria-pressed]="stepIdx() === i" (click)="stepIdx.set(i)">
                  <span class="af__n"><span>{{ i18n.tf('ag.fl.stepN', i + 1) }}</span><span class="pill {{ stepTone(stepState(f, s)) }}">{{ i18n.t(stepKey(stepState(f, s))) }}</span></span>
                  <b>{{ s.name }}</b>
                  <span class="af__who"><mat-icon>hub</mat-icon>{{ s.areaName }} · {{ s.assigneeName }}</span>
                  <span class="adm-hint">{{ stepLine(f, s, i) }}</span>
                </button>
              }
            </div>
            @if (f.steps[stepIdx()]; as s) {
              <dl class="af__facts">
                <dt>{{ i18n.t('ag.f.holder') }}</dt><dd>{{ runOf(f, s)?.holderName || runOf(f, s)?.offeredLevel || s.assigneeName }} · {{ s.areaName }}</dd>
                @if (stepIdx() > 0) {
                  <dt>{{ i18n.t('ag.fl.startsWhen') }}</dt>
                  <dd>{{ s.after ? i18n.tf('ag.fl.afterDays', s.days + ' · ' + f.steps[stepIdx() - 1].name) : i18n.tf('ag.fl.parallelDays', s.days) }}</dd>
                }
                @if (f.run) { <dt>{{ i18n.t('ag.fl.run') }}</dt><dd>{{ day(f.run.startDate) }}</dd> }
                <dt>{{ i18n.t('ag.f.by') }}</dt><dd>{{ f.createdByName }}</dd>
                @if (s.steps.length) { <dt>{{ i18n.t('ag.stepsTitle') }}</dt><dd>{{ s.steps.join(' · ') }}</dd> }
              </dl>
              @if (stepState(f, s) === 'wait') {
                <p class="af__note"><mat-icon>hourglass_top</mat-icon>{{ i18n.tf('ag.fl.waitNote', f.steps[stepIdx() - 1].name) }}</p>
              }
            }
            @if (f.canEdit) {
              <div class="af__actions"><button type="button" class="adm-btn" (click)="form.set({ flow: f })"><mat-icon>edit</mat-icon>{{ i18n.t('ag.fl.edit') }}</button></div>
            }
          }
        </article>
      } @empty {
        @if (loaded()) { <p class="adm-empty">{{ i18n.t('ag.fl.empty') }}</p> }
      }
      @if (error(); as e) { <p class="adm-error af__pad" role="alert">{{ e }}</p> }
    }
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .af__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); }
    .af__pad { margin: 10px 14px; }
    .af__flow { border-bottom: 1px solid var(--border-subtle); }
    .af__flow--on { background: var(--bg-app); }
    .af__head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .af__title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; flex: 1; }
    .af__sub { width: 100%; color: var(--text-muted); font-size: 11.5px; }
    .af__chain { display: flex; align-items: stretch; padding: 4px 14px 12px; overflow-x: auto; }
    .af__step { display: flex; flex: 1 0 150px; flex-direction: column; gap: 4px; max-width: 230px; padding: 8px 10px; border: 2px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .af__step[aria-pressed='true'] { box-shadow: 0 0 0 3px var(--accent-soft); }
    .af__step--done, .af__step--skipped { border-color: var(--status-ok); }
    .af__step--now { border-color: var(--accent); }
    .af__step--late { border-color: var(--status-critical); }
    .af__step--wait { border-style: dashed; }
    .af__n { display: flex; justify-content: space-between; gap: 6px; color: var(--text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .af__who { display: flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 11px; }
    .af__arrow { display: grid; flex: 0 0 28px; place-items: center; color: var(--text-muted); }
    .af__facts { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 6px 12px; margin: 0; padding: 4px 14px 10px; font-size: 12.5px; }
    .af__facts dt { color: var(--text-muted); }
    .af__facts dd { margin: 0; min-width: 0; }
    .af__note { display: flex; align-items: center; gap: 6px; margin: 0 14px 10px; padding: 8px 10px; border-radius: var(--radius-md); background: var(--status-carrier-bg); font-size: 12px; }
    .af__actions { display: flex; justify-content: flex-end; padding: 0 14px 12px; }
    @media (max-width: 640px) { .af__facts { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AgendaFlowsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);
  private readonly sse = inject(SseService);
  private readonly destroyRef = inject(DestroyRef);

  readonly meta = input.required<AgendaMeta>();
  /** Cambia cuando la pantalla guardó algo: se recarga. */
  readonly refresh = input(0);

  protected readonly flows = signal<AgendaFlow[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly stepIdx = signal(0);
  protected readonly form = signal<{ flow: AgendaFlow | null } | null>(null);
  private readonly lang = computed(() => this.prefs.language());

  constructor() {
    effect(() => {
      this.refresh();
      untracked(() => void this.load());
    });
  }

  ngOnInit(): void {
    const stop = this.sse.connect((type) => {
      if (type === 'agenda.changed') void this.load();
    });
    this.destroyRef.onDestroy(stop);
  }

  private async load(): Promise<void> {
    try {
      const list = await this.api.flows();
      this.flows.set(list);
      if (!this.selectedId() && list.length) this.open(list[0]);
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected toggle(f: AgendaFlow): void {
    if (this.selectedId() === f.id) this.selectedId.set(null);
    else this.open(f);
  }

  /** Abre el flujo en el paso que va (el primero sin cerrar). */
  private open(f: AgendaFlow): void {
    this.selectedId.set(f.id);
    const i = f.steps.findIndex((s) => ['now', 'late'].includes(this.stepState(f, s)));
    this.stepIdx.set(i < 0 ? 0 : i);
  }

  protected onSaved(): void {
    this.form.set(null);
    void this.load();
  }

  protected runOf(f: AgendaFlow, s: AgendaFlowStep): AgendaFlowRunStep | undefined {
    return f.run?.steps.find((r) => r.taskId === s.taskId);
  }

  protected stepState(f: AgendaFlow, s: AgendaFlowStep): StepState {
    const r = this.runOf(f, s);
    if (!r) return 'wait';
    if (r.status === 'done') return 'done';
    if (r.status === 'skipped') return 'skipped';
    if (r.status === 'waiting') return 'wait';
    return r.late ? 'late' : 'now';
  }

  protected stepLine(f: AgendaFlow, s: AgendaFlowStep, i: number): string {
    const r = this.runOf(f, s);
    switch (this.stepState(f, s)) {
      case 'done':
      case 'skipped':
        return r?.closedAt ? this.i18n.tf('ag.fl.closedOn', fmtDay(r.closedAt.slice(0, 10), this.lang())) : '';
      case 'now':
      case 'late':
        return this.i18n.tf('ag.fl.dueOn', fmtDay(r!.dueDate, this.lang()));
      default:
        return i === 0 ? '' : s.after ? this.i18n.tf('ag.fl.afterDays', s.days + ' · ' + f.steps[i - 1].name) : this.i18n.tf('ag.fl.parallelDays', s.days);
    }
  }

  protected stepKey(s: StepState): MessageKey {
    return `ag.fl.step.${s}` as MessageKey;
  }

  protected stepTone(s: StepState): string {
    return { done: 'tone-ok', skipped: 'tone-neutral', now: 'tone-info', late: 'tone-bad', wait: 'tone-neutral' }[s];
  }

  protected stateKey(s: AgendaFlow['state']): MessageKey {
    return `ag.fl.state.${s}` as MessageKey;
  }

  protected stateTone(s: AgendaFlow['state']): string {
    return { ok: 'tone-ok', late: 'tone-bad', done: 'tone-ok', waiting: 'tone-neutral', paused: 'tone-neutral' }[s];
  }

  protected recText(f: AgendaFlow): string {
    return recurrenceText(f.recurrence, this.i18n, this.lang());
  }

  protected day(iso: string): string {
    return fmtDay(iso, this.lang(), true);
  }
}
