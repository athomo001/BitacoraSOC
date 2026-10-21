import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ManagementService, MgmtClient, MgmtMeta } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/management';

export interface AccountDialogData {
  client: MgmtClient;
  meta: MgmtMeta;
}

/** Datos de la cuenta (spec/16 §4.4.2–4.4.3): CSM a cargo, inicio del servicio, renovación y SLA propio. */
@Component({
  selector: 'app-mgmt-account-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal>
      <span app-modal-title>{{ i18n.tf('mg.acc.title', data.client.name) }}</span>
      <form class="acc" (submit)="$event.preventDefault(); save()">
        <label class="field"><span>{{ i18n.t('mg.acc.csm') }}</span>
          <select name="accCsm" (change)="csm.set(val($event))">
            <option value="" [selected]="!csm()">{{ i18n.t('mg.acc.noCsm') }}</option>
            @for (c of data.meta.csms; track c.id) { <option [value]="c.id" [selected]="csm() === c.id">{{ c.name }}</option> }
          </select>
        </label>
        <div class="field-grid">
          <label class="field"><span>{{ i18n.t('mg.acc.renewal') }}</span>
            <input name="accRenewal" class="mono" type="date" [value]="renewal()" (input)="renewal.set(val($event))" /></label>
          <label class="field"><span>{{ i18n.t('mg.acc.start') }}</span>
            <input name="accStart" class="mono" type="date" [value]="start()" (input)="start.set(val($event))" /></label>
        </div>
        <span class="acc__hint">{{ i18n.t('mg.acc.startHint') }}</span>
        <label class="field acc__sla"><span>{{ i18n.t('mg.acc.sla') }}</span>
          <input name="accSla" class="mono" type="number" min="50" max="100" [value]="sla()" (input)="sla.set(val($event))" /></label>
        <span class="acc__hint">{{ i18n.tf('mg.acc.slaHint', data.meta.slaTarget) }}</span>
        @if (error(); as e) { <p class="msg msg--error" role="alert">{{ e }}</p> }
      </form>
      <ng-container app-modal-actions>
        <app-button (pressed)="ref.close()">{{ i18n.t('mg.cancel') }}</app-button>
        <app-button variant="primary" [disabled]="busy()" (pressed)="save()">{{ i18n.t('mg.save') }}</app-button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .acc { display: flex; flex-direction: column; gap: 10px; width: min(480px, calc(100vw - 64px)); }
    .acc__hint { margin-top: -4px; color: var(--text-muted); font-size: 11.5px; }
    .acc__sla { max-width: 220px; }
  `,
})
export class AccountDialogComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<AccountDialogData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef<boolean>);
  private readonly api = inject(ManagementService);

  protected readonly csm = signal(this.data.client.csmId ?? '');
  protected readonly start = signal(this.data.client.serviceStart ?? '');
  protected readonly renewal = signal(this.data.client.renewal ?? '');
  protected readonly sla = signal(this.data.client.slaTarget != null ? String(this.data.client.slaTarget) : '');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const sla = this.sla().trim();
      await this.api.updateClient(this.data.client.id, {
        csmUserId: this.csm() || null, serviceStart: this.start(), renewal: this.renewal(), slaTarget: sla ? Number(sla) : null,
      });
      this.ref.close(true);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
