import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AgendaManaged, AgendaManagedRow, AgendaMeta, AgendaService, AgendaTask } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SseService } from '../../core/sse/sse.service';
import { problemDetail } from '../../core/http-error';
import { fmtDay, recurrenceText } from './agenda-format';

/**
 * Agenda → Gestión (spec/16 §4.3 "Vistas"): lo que asigné y cómo va, o todo
 * el área para la jefatura (el admin, todas). Indicadores de 90 días y el
 * historial de cada tarea recurrente. Tocar una fila abre la tarea para editarla.
 */
@Component({
  selector: 'app-agenda-managed',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am__bar">
      <button type="button" class="seg" [attr.aria-pressed]="managedScope() === 'mine'" (click)="setScope('mine')">{{ i18n.t('ag.m.mine') }}</button>
      @if (canManageArea()) {
        <button type="button" class="seg" [attr.aria-pressed]="managedScope() === 'area'" (click)="setScope('area')">{{ i18n.t(meta().admin ? 'ag.m.all' : 'ag.m.area') }}</button>
      }
    </div>
    @if (managed(); as m) {
      <div class="am__kpis">
        <div class="am__kpi"><span class="adm-label">{{ i18n.t('ag.k.onTime') }}</span><b class="am__kpi--ok">{{ pct(m.onTimePct) }}</b></div>
        <div class="am__kpi"><span class="adm-label">{{ i18n.t('ag.k.late') }}</span><b class="am__kpi--bad">{{ m.openLate }}</b></div>
        <div class="am__kpi"><span class="adm-label">{{ i18n.t('ag.k.risk') }}</span><b class="am__kpi--warn">{{ m.atRisk }}</b></div>
        <div class="am__kpi"><span class="adm-label">{{ i18n.t('ag.k.total') }}</span><b>{{ m.occurrences }}</b></div>
      </div>
      <div class="am__mrow am__mrow--head">
        <span>{{ i18n.t('ag.col.task') }}</span><span class="am__hs">{{ i18n.t('ag.col.who') }}</span><span class="am__hs">{{ i18n.t('ag.col.next') }}</span>
        <span class="am__hs">{{ i18n.t('ag.col.history') }}</span><span>{{ i18n.t('ag.col.state') }}</span>
      </div>
      @for (r of m.tasks; track r.task.id) {
        <button type="button" class="am__mrow" [disabled]="!r.task.canEdit" (click)="edit.emit(r.task.id)">
          <span class="am__cell"><b>{{ r.task.name }}</b>
            @if (r.task.clientName) { <span class="pill tone-info">{{ r.task.clientName }}</span> }
            <span class="am__sub">{{ recText(r.task) }}</span></span>
          <span class="am__cell am__hs">{{ r.task.assigneeName }}
            @if (r.next?.holderName && r.task.assigneeKind !== 'person') { <span class="am__sub">{{ i18n.tf('ag.hasIt', r.next!.holderName!) }}</span> }</span>
          <span class="am__hs">{{ r.next ? day(r.next.dueDate) : '—' }}</span>
          <span class="am__hs am__hist">
            @for (h of r.history; track $index) { <i class="am__h am__h--{{ h }}" [title]="i18n.t(histKey(h))"></i> }
          </span>
          <span><span class="pill {{ r.state === 'late' ? 'tone-bad' : r.state === 'risk' ? 'tone-warn' : r.state === 'paused' ? 'tone-neutral' : 'tone-ok' }}"
            [title]="r.state === 'paused' ? i18n.t('ag.pausedHint') : ''">{{ i18n.t(stateKey(r.state)) }}</span></span>
        </button>
      } @empty {
        <p class="adm-empty">{{ i18n.t('ag.m.empty') }}</p>
      }
      <div class="am__legend">
        <span><i class="am__h am__h--ok"></i>{{ i18n.t('ag.hist.ok') }}</span><span><i class="am__h am__h--late"></i>{{ i18n.t('ag.hist.late') }}</span>
        <span><i class="am__h am__h--skip"></i>{{ i18n.t('ag.hist.skip') }}</span><span><i class="am__h am__h--open"></i>{{ i18n.t('ag.hist.open') }}</span>
        <span class="adm-hint">{{ i18n.t('ag.m.riskHint') }}</span>
      </div>
    }
    @if (error(); as e) { <p class="adm-error am__pad" role="alert">{{ e }}</p> }
  `,
  styleUrl: './agenda-managed.css',
})
export class AgendaManagedComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);
  private readonly sse = inject(SseService);
  private readonly destroyRef = inject(DestroyRef);

  readonly meta = input.required<AgendaMeta>();
  /** Cambia cuando la pantalla guardó una tarea: se recarga. */
  readonly refresh = input(0);
  readonly edit = output<string>();

  protected readonly managedScope = signal<'mine' | 'area'>('mine');
  protected readonly managed = signal<AgendaManaged | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly canManageArea = computed(() => this.meta().admin || this.meta().leadAreas.length > 0);

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
      this.managed.set(await this.api.managed(this.managedScope()));
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.loadError')));
    }
  }

  protected setScope(s: 'mine' | 'area'): void {
    this.managedScope.set(s);
    void this.load();
  }

  protected day(iso: string): string {
    return fmtDay(iso, this.prefs.language());
  }

  protected recText(t: AgendaTask): string {
    return recurrenceText(t.recurrence, this.i18n, this.prefs.language());
  }

  protected stateKey(s: AgendaManagedRow['state']): MessageKey {
    return `ag.state.${s}` as MessageKey;
  }

  protected histKey(h: AgendaManagedRow['history'][number]): MessageKey {
    return `ag.hist.${h}` as MessageKey;
  }

  protected pct(v: number): string {
    return v < 0 ? '—' : `${v} %`;
  }
}
