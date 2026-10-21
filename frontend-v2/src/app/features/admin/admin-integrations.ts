import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { IntegrationsMeta, IntegrationsService } from '../../core/integrations/integrations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';
import { IntegrationsForwardComponent } from './integrations-forward';
import { IntegrationsKeysComponent } from './integrations-keys';

import '../../core/i18n/packs/integrations';

type Tab = 'fw' | 'keys';

/**
 * Administración → Integraciones (10b, spec/19, diseño aprobado 2026-10-21):
 * reenvío de eventos a un SIEM y llaves de la API de integraciones.
 */
@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  imports: [MatIconModule, IntegrationsForwardComponent, IntegrationsKeysComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="ig__head">
      <h3 class="adm-title"><mat-icon>cable</mat-icon>{{ i18n.t('ig.title') }}</h3>
      <p class="adm-muted">{{ i18n.t('ig.subtitle') }}</p>
    </header>
    <div class="adm-tabs" role="tablist">
      <button type="button" role="tab" class="adm-tab" [attr.aria-selected]="tab() === 'fw'" (click)="tab.set('fw')"><mat-icon>send</mat-icon>{{ i18n.t('ig.tab.fw') }}</button>
      <button type="button" role="tab" class="adm-tab" [attr.aria-selected]="tab() === 'keys'" (click)="tab.set('keys')"><mat-icon>key</mat-icon>{{ i18n.t('ig.tab.keys') }}</button>
    </div>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
    @if (meta(); as m) {
      @if (!m.crypto) { <p class="adm-error">{{ i18n.t('ig.noCrypto') }}</p> }
      @if (tab() === 'fw') { <app-integrations-forward /> } @else { <app-integrations-keys [meta]="m" /> }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; margin-top: 8px; }
    .ig__head { display: flex; flex-direction: column; gap: 2px; }
    .ig__head .adm-title { display: flex; align-items: center; gap: 8px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
  `,
})
export class AdminIntegrationsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(IntegrationsService);

  protected readonly tab = signal<Tab>('fw');
  protected readonly meta = signal<IntegrationsMeta | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.meta.set(await this.api.meta());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.loadError')));
    }
  }
}
