import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AlertContext, ClientAlertRule, ReportsService } from '../../core/reports/reports.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { problemDetail } from '../../core/http-error';

export interface ClientAlertDialogData {
  clientName: string;
  context: AlertContext;
  alerts: ClientAlertRule[];
}

/**
 * "Aviso de <cliente> antes de enviar" (canvas v20, client-alert-dialog del
 * legacy): los avisos vigentes del cliente en Markdown y, si alguno lo pide,
 * "Leí el aviso y revisé los destinatarios". Confirmar registra el acuse
 * (queda en auditoría) y cierra con true.
 */
@Component({
  selector: 'app-client-alert-dialog',
  standalone: true,
  imports: [MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ca" role="document">
      <header class="ca__head">
        <mat-icon>campaign</mat-icon>
        <h2 class="ca__title">{{ i18n.tf('rpt.alert.title', data.clientName) }}</h2>
      </header>
      <div class="ca__body">
        @for (a of data.alerts; track a.id) {
          <section class="ca__alert">
            <app-markdown [content]="a.message" />
            <span class="ca__meta">{{ i18n.tf('rpt.alert.rule', a.name || '—') }}</span>
          </section>
        }
        @if (error(); as message) {
          <p class="ca__error" role="alert">{{ message }}</p>
        }
        @if (needsAck()) {
          <label class="ca__ack">
            <input type="checkbox" [checked]="ack()" (change)="ack.set(!ack())" />
            {{ i18n.t('rpt.alert.ack') }}
          </label>
        }
      </div>
      <footer class="ca__foot">
        <button type="button" class="adm-btn" (click)="ref.close(false)">{{ i18n.t('rpt.alert.back') }}</button>
        <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || (needsAck() && !ack())" (click)="confirm()">
          <mat-icon>{{ data.context === 'report' ? 'send' : 'content_copy' }}</mat-icon>{{ i18n.t(data.context === 'report' ? 'rpt.send' : 'rpt.copy') }}
        </button>
      </footer>
    </div>
  `,
  styles: `
    .ca { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--status-warning); border-radius: 10px; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45); }
    .ca__head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--status-warning-bg); color: var(--status-warning); }
    .ca__title { margin: 0; font-size: 14px; font-weight: 600; }
    .ca__body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; font-size: 12.5px; line-height: 1.55; }
    .ca__alert { display: flex; flex-direction: column; gap: 4px; }
    .ca__meta { font-size: 11px; color: var(--text-muted); }
    .ca__ack { display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
    .ca__error { margin: 0; color: var(--status-critical); }
    .ca__foot { display: flex; justify-content: flex-end; gap: 6px; padding: 10px 16px; border-top: 1px solid var(--border-subtle); }
  `,
})
export class ClientAlertDialogComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<ClientAlertDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly reports = inject(ReportsService);

  protected readonly ack = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly needsAck = computed(() => this.data.alerts.some((a) => a.requiresAck && !a.acked));

  protected async confirm(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      for (const a of this.data.alerts) {
        if (a.requiresAck && !a.acked) {
          await this.reports.ackAlert(a.id, this.data.context);
        }
      }
      this.ref.close(true);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('rpt.alert.ackFailed')));
    } finally {
      this.busy.set(false);
    }
  }
}
