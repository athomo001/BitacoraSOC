import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { EscalationService, ShiftReportDelivery } from '../../core/escalation/escalation.service';
import { MessageKey } from '../../core/i18n/messages';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
/**
 * Reportes de turno (Administración → Operación), re-vestido con los
 * componentes del artboard "Administración". Cada cierre de turno con
 * actividad genera un reporte que sale por el correo configurado; el
 * planificador procesa la cola cada minuto y este botón lo fuerza a mano.
 */
@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.reports') }}</h2>
        <p class="adm-muted">{{ i18n.t('reports.subtitle') }}</p>
      </div>
    </header>

    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>outgoing_mail</mat-icon>{{ i18n.t('reports.queue') }}</h3></div>
      <div class="adm-card__body">
        <ol class="rp__steps">
          <li>{{ i18n.t('reports.step1') }}</li>
          <li>{{ i18n.t('reports.step2') }}</li>
          <li>{{ i18n.t('reports.step3') }}</li>
        </ol>
        <p class="adm-hint">{{ i18n.t('reports.smtpHint') }}</p>
      </div>
      <footer class="adm-foot">
        <span class="adm-foot__status">
          @if (result(); as r) {
            @if (r.ok) {
              <span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ i18n.t('reports.done') }}</span>
              <span class="mono adm-small adm-secondary"> {{ r.at | date: 'HH:mm:ss' }}</span>
            } @else {
              <span class="adm-error" role="alert">{{ r.text }}</span>
            }
          } @else {
            <span class="adm-muted">{{ i18n.t('reports.auto') }}</span>
          }
        </span>
        <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy()" (click)="dispatch()">
          <mat-icon>send</mat-icon>{{ i18n.t(busy() ? 'reports.running' : 'reports.dispatch') }}
        </button>
      </footer>
    </section>

    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>history</mat-icon>{{ i18n.t('reports.recent') }}</h3></div>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('reports.col.closed') }}</th><th>{{ i18n.t('reports.col.shift') }}</th><th>{{ i18n.t('reports.col.by') }}</th><th>{{ i18n.t('reports.col.status') }}</th><th>{{ i18n.t('reports.col.detail') }}</th></tr></thead>
          <tbody>
            @for (d of deliveries(); track d.id) {
              <tr>
                <td class="mono adm-secondary">{{ d.shiftEndAt | date: 'dd/MM HH:mm' }}</td>
                <td>{{ d.shiftName ?? '—' }}</td>
                <td>{{ d.closedBy }}</td>
                <td><span class="pill" [class]="statusTone[d.status]">{{ i18n.t(statusKey(d.status)) }}</span></td>
                <td class="adm-small">
                  @if (d.status === 'failed' && d.error) {
                    <span class="text-bad">{{ d.error }}</span>
                  } @else if (d.status === 'success') {
                    <span class="adm-secondary">{{ d.recipients.join(', ') }}@if (d.sentAt) { · <span class="mono">{{ d.sentAt | date: 'HH:mm' }}</span> }</span>
                  } @else if (d.status === 'skipped') {
                    <span class="adm-secondary">{{ i18n.t('reports.skippedHint') }}</span>
                  } @else {
                    <span class="adm-secondary">{{ i18n.t('reports.pendingHint') }}</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!deliveries().length) { <p class="adm-empty">{{ i18n.t('reports.noDeliveries') }}</p> }
      </div>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .rp__steps { display: flex; flex-direction: column; gap: 6px; margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.5; }
  `,
})
export class AdminReportsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(EscalationService);

  protected readonly busy = signal(false);
  protected readonly result = signal<{ ok: boolean; text: string; at: Date } | null>(null);
  protected readonly deliveries = signal<ShiftReportDelivery[]>([]);
  protected readonly statusTone: Record<ShiftReportDelivery['status'], string> = { success: 'tone-ok', failed: 'tone-bad', skipped: 'tone-neutral', pending: 'tone-warn' };

  async ngOnInit(): Promise<void> {
    await this.loadDeliveries();
  }

  protected statusKey(status: ShiftReportDelivery['status']): MessageKey {
    return `reports.status.${status}` as MessageKey;
  }

  private async loadDeliveries(): Promise<void> {
    try {
      this.deliveries.set(await this.api.recentShiftReports());
    } catch {
      // La lista es informativa: si falla, el botón de procesar sigue sirviendo.
      this.deliveries.set([]);
    }
  }

  protected async dispatch(): Promise<void> {
    this.busy.set(true);
    this.result.set(null);
    try {
      await this.api.dispatchPendingShiftReports();
      this.result.set({ ok: true, text: '', at: new Date() });
      await this.loadDeliveries();
    } catch (error) {
      this.result.set({ ok: false, text: problemDetail(error, this.i18n.t('reports.error')), at: new Date() });
    } finally {
      this.busy.set(false);
    }
  }
}
