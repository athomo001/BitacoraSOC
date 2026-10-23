import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MonthlyPerson, MonthlyView, TeamService } from '../../core/team/team.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/team';

/** Cuántos meses hacia atrás se puede mirar. */
const MONTHS_BACK = 12;

/**
 * Mi equipo → Resumen mensual (spec/16 §6.1, 9.7, diseño aprobado por el
 * dueño 2026-10-15). Se revisa en la app y no llega solo por correo: la
 * jefatura lo envía a quien quiera o lo descarga en PDF. Los indicadores son
 * fijos, por persona y total del área, con la diferencia contra el mes
 * anterior. Un mes cerrado es una foto que ya no cambia.
 */
@Component({
  selector: 'app-team-monthly',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head mo__head">
        <h2 class="adm-card__title"><mat-icon>insights</mat-icon>{{ i18n.tf('team.mo.title', areaName()) }}</h2>
        <span class="mo__nav adm-push no-print">
          <button type="button" class="adm-icon-btn" [disabled]="offset() >= monthsBack" [attr.aria-label]="i18n.t('team.mo.prev')" (click)="move(1)"><mat-icon>chevron_left</mat-icon></button>
          <b class="mo__month">{{ monthLabel() }}</b>
          <button type="button" class="adm-icon-btn" [disabled]="offset() === 0" [attr.aria-label]="i18n.t('team.mo.next')" (click)="move(-1)"><mat-icon>chevron_right</mat-icon></button>
        </span>
        <b class="mo__month mo__print-only">{{ monthLabel() }}</b>
      </div>
      @if (data(); as d) {
        @if (!d.frozen) { <p class="mo__banner"><mat-icon>schedule</mat-icon>{{ i18n.t('team.mo.open') }}</p> }
        <div class="mo__kpis">
          <div class="mo__kpi"><span class="adm-label">{{ i18n.t('team.mo.onTime') }}</span><b>{{ pct(d.onTimePct) }}</b>
            <span class="adm-small" [class]="deltaClass(d.onTimePct, d.previous.onTimePct)">{{ delta(d.onTimePct, d.previous.onTimePct) }}</span></div>
          @if (d.tickets) {
            <div class="mo__kpi"><span class="adm-label">{{ i18n.t('team.mo.sla') }}</span><b>{{ pct(d.slaPct) }}</b>
              <span class="adm-small" [class]="deltaClass(d.slaPct, d.previous.slaPct)">{{ delta(d.slaPct, d.previous.slaPct) }}</span></div>
          }
          @if (d.bitacora) {
            <div class="mo__kpi"><span class="adm-label">{{ i18n.t('team.mo.quality') }}</span><b>{{ score(d.summary.total.quality) }}</b>
              <span class="adm-small" [class]="deltaClass(d.summary.total.quality ?? -1, d.previous.quality ?? -1)">{{ delta(d.summary.total.quality ?? -1, d.previous.quality ?? -1) }}</span></div>
          }
          <div class="mo__kpi"><span class="adm-label">{{ i18n.t('team.mo.openLate') }}</span><b [class.text-bad]="d.summary.total.openLate > 0">{{ d.summary.total.openLate }}</b>
            <span class="adm-small adm-muted">{{ i18n.t(d.frozen ? 'team.mo.atClose' : 'team.mo.untilToday') }}</span></div>
          <div class="mo__kpi"><span class="adm-label">{{ i18n.t('team.mo.skipped') }}</span><b>{{ d.summary.total.skipped }}</b>
            <span class="adm-small adm-muted">{{ i18n.t('team.mo.withReason') }}</span></div>
        </div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr>
              <th>{{ i18n.t('team.col.person') }}</th><th>{{ i18n.t('team.mo.level') }}</th>
              @if (d.bitacora) { <th class="adm-num">{{ i18n.t('team.mo.entries') }}</th><th class="adm-num">{{ i18n.t('team.mo.qualityCol') }}</th> }
              <th class="adm-num">{{ i18n.t('team.mo.tasks') }}</th><th class="adm-num">{{ i18n.t('team.mo.onTimeCol') }}</th>
              <th class="adm-num">{{ i18n.t('team.mo.openLate') }}</th><th class="adm-num">{{ i18n.t('team.mo.skipped') }}</th>
              @if (d.tickets) { <th class="adm-num">{{ i18n.t('team.mo.tickets') }}</th><th class="adm-num">{{ i18n.t('team.mo.slaCol') }}</th> }
              <th class="adm-num">{{ i18n.t('team.mo.goals') }}</th><th class="adm-num">{{ i18n.t('team.mo.absent') }}</th>
            </tr></thead>
            <tbody>
              @for (p of d.summary.people; track p.id) {
                <tr>
                  <td><strong>{{ p.name }}</strong></td>
                  <td>@if (p.level) { <span class="pill tone-neutral">{{ p.level }}</span> }</td>
                  @if (d.bitacora) {
                    <td class="adm-num mono">{{ p.entries ?? 0 }}</td>
                    <td class="adm-num"><span class="pill {{ qualityTone(p.quality) }}">{{ score(p.quality) }}</span></td>
                  }
                  <td class="adm-num mono">{{ p.tasks }}</td>
                  <td class="adm-num"><span class="pill {{ tone(onTime(p)) }}">{{ pct(onTime(p)) }}</span></td>
                  <td class="adm-num mono" [class.text-bad]="p.openLate > 0">{{ p.openLate }}</td>
                  <td class="adm-num mono">{{ p.skipped }}</td>
                  @if (d.tickets) {
                    <td class="adm-num mono">{{ p.tickets }}</td>
                    <td class="adm-num"><span class="pill {{ tone(sla(p)) }}">{{ pct(sla(p)) }}</span></td>
                  }
                  <td class="adm-num mono">{{ p.goalsDone ?? 0 }}</td>
                  <td class="adm-num mono">{{ p.absentDays }}</td>
                </tr>
              }
            </tbody>
            <tfoot><tr>
              <td colspan="2"><strong>{{ i18n.tf('team.mo.total', d.summary.areaName) }}</strong></td>
              @if (d.bitacora) { <td class="adm-num mono">{{ d.summary.total.entries ?? 0 }}</td><td class="adm-num mono">{{ score(d.summary.total.quality) }}</td> }
              <td class="adm-num mono">{{ d.summary.total.tasks }}</td><td class="adm-num mono">{{ pct(d.onTimePct) }}</td>
              <td class="adm-num mono">{{ d.summary.total.openLate }}</td><td class="adm-num mono">{{ d.summary.total.skipped }}</td>
              @if (d.tickets) { <td class="adm-num mono">{{ d.summary.total.tickets }}</td><td class="adm-num mono">{{ pct(d.slaPct) }}</td> }
              <td class="adm-num mono">{{ d.summary.total.goalsDone ?? 0 }}</td>
              <td class="adm-num mono">{{ d.summary.total.absentDays }}</td>
            </tr></tfoot>
          </table>
        </div>
        <div class="mo__foot">
          <span class="adm-small adm-muted">{{ footLine() }}</span>
          <span class="adm-push"></span>
          <button type="button" class="adm-btn no-print" (click)="print()"><mat-icon>picture_as_pdf</mat-icon>{{ i18n.t('team.mo.pdf') }}</button>
          <button type="button" class="adm-btn adm-btn--primary no-print" (click)="sending.set(!sending())"><mat-icon>send</mat-icon>{{ i18n.t('team.mo.send') }}</button>
        </div>
        @if (sending()) {
          <form class="mo__send no-print" (submit)="$event.preventDefault(); send()">
            <label class="adm-field"><span class="adm-label">{{ i18n.t('team.mo.to') }}</span>
              <input class="adm-input mono" name="monthlyTo" [placeholder]="i18n.t('team.mo.toPlaceholder')" [value]="to()" (input)="to.set(val($event))" /></label>
            <span class="adm-small adm-muted">{{ i18n.t('team.mo.toHint') }}</span>
            <span class="mo__actions">
              <button type="button" class="adm-btn" (click)="sending.set(false)">{{ i18n.t('team.cancel') }}</button>
              <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !recipients().length"><mat-icon>send</mat-icon>{{ i18n.t('team.mo.sendNow') }}</button>
            </span>
          </form>
        }
        @if (sent(); as n) { <p class="mo__ok no-print" role="status"><mat-icon>mark_email_read</mat-icon>{{ i18n.tf('team.mo.sent', n) }}</p> }
      }
      @if (error(); as e) { <p class="adm-error mo__pad" role="alert">{{ e }}</p> }
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .mo__head { flex-wrap: wrap; }
    .mo__nav { display: inline-flex; align-items: center; gap: 4px; }
    .mo__month { min-width: 130px; text-align: center; text-transform: capitalize; }
    .mo__print-only { display: none; }
    .mo__banner { display: flex; align-items: center; gap: 6px; margin: 12px 14px 0; padding: 8px 12px; border-radius: var(--radius-md); background: var(--status-warning-bg); font-size: 12px; }
    .mo__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; padding: 12px 14px; }
    .mo__kpi { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    .mo__kpi b { font-size: 22px; font-variant-numeric: tabular-nums; }
    .mo__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; }
    .mo__send { display: flex; flex-direction: column; gap: 8px; padding: 0 14px 12px; }
    .mo__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .mo__ok { display: flex; align-items: center; gap: 6px; margin: 0 14px 12px; color: var(--status-ok); }
    .mo__pad { margin: 10px 14px; }
    .text-bad { color: var(--status-critical); }
    .up { color: var(--status-ok); }
    .down { color: var(--status-critical); }
    tfoot td { border-top: 2px solid var(--border-subtle); font-weight: 700; }
    @media (width <= 700px) { .mo__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media print { .mo__print-only { display: inline; } }
  `,
})
export class TeamMonthlyComponent {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(TeamService);

  readonly area = input.required<string>();
  readonly areaName = input('');

  protected readonly monthsBack = MONTHS_BACK;
  /** 0 = este mes; 1 = el anterior… */
  protected readonly offset = signal(1);
  protected readonly data = signal<MonthlyView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly sending = signal(false);
  protected readonly to = signal('');
  protected readonly sent = signal(0);

  protected readonly month = computed(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - this.offset(), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  protected readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Intl.DateTimeFormat(this.prefs.language() === 'en' ? 'en-US' : 'es-CL', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  });
  protected readonly recipients = computed(() => this.to().split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes('@')));
  protected readonly footLine = computed(() => {
    const d = this.data();
    if (!d) return '';
    const days = this.i18n.tf('team.mo.bizDays', d.summary.bizDays);
    const when = new Intl.DateTimeFormat(this.prefs.language() === 'en' ? 'en-US' : 'es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d.summary.computedAt));
    return `${this.i18n.tf(d.frozen ? 'team.mo.frozenAt' : 'team.mo.computedAt', when)} · ${days}`;
  });

  constructor() {
    effect(() => {
      this.area();
      this.month();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.sent.set(0);
    try {
      this.data.set(await this.api.monthly(this.area(), this.month()));
      this.error.set(null);
    } catch (e) {
      this.data.set(null);
      this.error.set(problemDetail(e, this.i18n.t('team.error')));
    }
  }

  protected move(dir: 1 | -1): void {
    this.offset.update((o) => Math.min(MONTHS_BACK, Math.max(0, o + dir)));
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected onTime(p: MonthlyPerson): number {
    const den = p.onTime + p.doneLate + p.openLate;
    return den ? Math.floor((p.onTime * 100) / den) : -1;
  }

  protected sla(p: MonthlyPerson): number {
    return p.tickets ? Math.floor((p.ticketsSla * 100) / p.tickets) : -1;
  }

  protected pct(v: number): string {
    return v < 0 ? '—' : `${v} %`;
  }

  /** Puntaje de calidad (10f): -1 o sin dato = sin evaluar. */
  protected score(v: number | undefined): string {
    return v === undefined || v < 0 ? '—' : String(v);
  }

  /** Mismos cortes que los estados de Calidad: bajo 50 y bajo 75. */
  protected qualityTone(v: number | undefined): string {
    if (v === undefined || v < 0) return 'tone-neutral';
    return v >= 75 ? 'tone-ok' : v >= 50 ? 'tone-warn' : 'tone-bad';
  }

  protected tone(v: number): string {
    if (v < 0) return 'tone-neutral';
    return v >= 90 ? 'tone-ok' : v >= 75 ? 'tone-warn' : 'tone-bad';
  }

  protected delta(cur: number, prev: number): string {
    if (cur < 0 || prev < 0) return '';
    const d = cur - prev;
    return `${d >= 0 ? '▲' : '▼'} ${this.i18n.tf('team.mo.vsPrev', Math.abs(d))}`;
  }

  protected deltaClass(cur: number, prev: number): string {
    return cur < 0 || prev < 0 ? '' : cur >= prev ? 'up' : 'down';
  }

  protected print(): void {
    window.print();
  }

  protected async send(): Promise<void> {
    const list = this.recipients();
    if (!list.length || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.sendMonthly(this.area(), this.month(), list);
      this.sent.set(list.length);
      this.sending.set(false);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('team.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
