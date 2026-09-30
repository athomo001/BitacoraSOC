import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SystemFeature, SystemFeaturesService } from '../../core/system-features/system-features.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

/**
 * Textos por código (el backend los guarda solo en español) y cuáles existen
 * de verdad. Una funcionalidad de la base que todavía no está construida
 * (backlog post-corte) se muestra sin interruptor: prenderla no haría nada.
 */
const KNOWN: Record<string, { name: MessageKey; desc: MessageKey; available: boolean }> = {
  native_tickets: { name: 'features.native_tickets.name', desc: 'features.native_tickets.desc', available: true },
  allow_purge: { name: 'features.allow_purge.name', desc: 'features.allow_purge.desc', available: true },
  zabbix_inbound: { name: 'features.zabbix_inbound.name', desc: 'features.zabbix_inbound.desc', available: false },
  glpi_sync: { name: 'features.glpi_sync.name', desc: 'features.glpi_sync.desc', available: false },
};

/**
 * Funcionalidades opcionales (system_features), re-vestidas con los
 * componentes del artboard "Administración": un interruptor por fila que
 * aplica en caliente, sin reiniciar ni tocar variables de entorno.
 */
@Component({
  selector: 'app-admin-features',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.features') }}</h2>
        <p class="adm-muted">{{ i18n.t('features.subtitle') }}</p>
      </div>
    </header>

    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    <section class="adm-card">
      @for (f of features(); track f.code) {
        <div class="ft__row">
          @if (available(f)) {
            <label class="switch" [attr.title]="i18n.t(f.isEnabled ? 'features.turnOff' : 'features.turnOn')">
              <input class="switch__input" type="checkbox" role="switch" [checked]="f.isEnabled" [disabled]="busyCode() === f.code" (change)="toggle(f)"
                [attr.aria-label]="name(f)" />
              <span class="switch__track" aria-hidden="true"></span>
            </label>
          } @else {
            <span class="ft__spacer" aria-hidden="true"></span>
          }
          <span class="ft__text">
            <span class="adm-strong">{{ name(f) }}</span>
            <span class="mono adm-small adm-secondary">{{ f.code }}</span>
            @if (!available(f)) {
              <span class="pill tone-system">{{ i18n.t('features.postCutover') }}</span>
            } @else {
              <span class="pill" [class]="f.isEnabled ? 'tone-ok' : 'tone-neutral'">{{ i18n.t(f.isEnabled ? 'modules.on' : 'modules.off') }}</span>
            }
            <span class="adm-hint ft__desc">{{ desc(f) }}</span>
          </span>
        </div>
      } @empty {
        <p class="adm-empty">{{ i18n.t('features.empty') }}</p>
      }
      <p class="adm-card__note ft__note">{{ i18n.t('features.note') }}</p>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .ft__row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .ft__spacer { flex: none; width: 34px; }
    .ft__text { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
    .ft__desc { flex-basis: 100%; }
  `,
})
export class AdminFeaturesComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly service = inject(SystemFeaturesService);

  protected readonly features = signal<SystemFeature[]>([]);
  protected readonly busyCode = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.features.set(await this.service.list());
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('features.loadError')));
    }
  }

  protected available(f: SystemFeature): boolean {
    return KNOWN[f.code]?.available ?? true;
  }

  protected name(f: SystemFeature): string {
    const known = KNOWN[f.code];
    return known ? this.i18n.t(known.name) : f.name;
  }

  protected desc(f: SystemFeature): string {
    const known = KNOWN[f.code];
    return known ? this.i18n.t(known.desc) : (f.description ?? '');
  }

  protected async toggle(feature: SystemFeature): Promise<void> {
    this.error.set(null);
    this.busyCode.set(feature.code);
    try {
      const updated = await this.service.setEnabled(feature.code, !feature.isEnabled);
      this.features.update((list) => list.map((f) => (f.code === updated.code ? updated : f)));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('features.saveError')));
    } finally {
      this.busyCode.set(null);
    }
  }
}
