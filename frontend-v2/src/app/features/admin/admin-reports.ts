import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { EscalationService } from '../../core/escalation/escalation.service';
import { problemDetail } from '../../core/http-error';

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel reports">
      <div class="reports__heading"><div><p class="reports__eyebrow">Operación asistida</p><h2 class="panel__title">Reportería de turnos</h2><p class="panel__hint">Los cierres con actividad se envían por el SMTP configurado a los usuarios activos. El scheduler también procesa esta cola automáticamente.</p></div><span class="reports__icon">✉</span></div>
      <div class="reports__actions"><button type="button" [disabled]="busy()" (click)="dispatch()">{{ busy() ? 'Procesando…' : 'Enviar reportes pendientes' }}</button></div>
      @if (message(); as status) { <p class="msg" [class.msg--ok]="status.ok" [class.msg--error]="!status.ok">{{ status.text }}</p> }
    </section>
  `,
  styles: `
    .reports { display: grid; gap: 16px; }
    .reports__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    .reports__eyebrow { margin: 0 0 4px; color: var(--accent-cyan); font-size: 11px; text-transform: uppercase; }
    .reports__icon { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--border-active); border-radius: 50%; color: var(--border-active); font-size: 20px; }
    .reports__actions button { min-height: var(--row-height); padding: 0 16px; border: 0; border-radius: var(--radius-sm); background: var(--border-active); color: var(--bg-app); font: inherit; font-weight: 600; cursor: pointer; }
    .reports__actions button:disabled { opacity: .6; cursor: default; }
  `,
})
export class AdminReportsComponent {
  private readonly api = inject(EscalationService);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ ok: boolean; text: string } | null>(null);

  protected async dispatch(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await this.api.dispatchPendingShiftReports();
      this.message.set({ ok: true, text: 'La cola de reportes fue procesada.' });
    } catch (error) {
      this.message.set({ ok: false, text: problemDetail(error, 'No se pudieron enviar los reportes.') });
    } finally {
      this.busy.set(false);
    }
  }
}