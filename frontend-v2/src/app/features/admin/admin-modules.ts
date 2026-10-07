import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SetupService } from '../../core/setup/setup.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
type ModuleId = 'soc' | 'noc' | 'tickets';
type Flags = Record<ModuleId, boolean>;

interface ModuleRow {
  id: ModuleId;
  nameKey: MessageKey;
  descKey: MessageKey;
}

const MODULES: readonly ModuleRow[] = [
  { id: 'soc', nameKey: 'modules.soc.name', descKey: 'modules.soc.desc' },
  { id: 'noc', nameKey: 'modules.noc.name', descKey: 'modules.noc.desc' },
  { id: 'tickets', nameKey: 'features.native_tickets.name', descKey: 'features.native_tickets.desc' },
];

/** La Ticketera vive en system_features; acá se muestra junto a SOC y NOC (pedido del dueño). */
const TICKETS_FEATURE = 'native_tickets';

/**
 * Activar/desactivar SOC, NOC y la Ticketera después del setup (HU-0b), en
 * un solo lugar. Apagar un módulo nunca borra datos: solo lo saca de menús y
 * bloquea su API hasta reactivarlo; el cambio llega en vivo a todas las
 * pestañas abiertas.
 */
@Component({
  selector: 'app-admin-modules',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.modules') }}</h2>
        <p class="adm-muted">{{ i18n.t('modules.subtitle') }}</p>
      </div>
    </header>

    <section class="adm-card">
      <div class="adm-card__body">
        @for (m of modules; track m.id) {
          <label class="adm-switch-row">
            <span class="switch">
              <input class="switch__input" type="checkbox" role="switch" [checked]="draft()[m.id]" (change)="toggle(m.id)" />
              <span class="switch__track" aria-hidden="true"></span>
            </span>
            <span class="mod__text">
              <span class="adm-strong">{{ i18n.t(m.nameKey) }}</span>
              <span class="pill" [class]="draft()[m.id] ? 'tone-ok' : 'tone-neutral'">{{ i18n.t(draft()[m.id] ? 'modules.on' : 'modules.off') }}</span>
              <span class="adm-hint adm-block">{{ i18n.t(m.descKey) }}</span>
            </span>
          </label>
        }
      </div>
      <p class="adm-card__note"><mat-icon class="mod__note-icon">info_outline</mat-icon>{{ i18n.t('modules.note') }}</p>
      <footer class="adm-foot">
        <span class="adm-foot__status">
          @if (notice(); as n) {
            <span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ n }}</span>
          } @else if (error(); as e) {
            <span class="adm-error" role="alert">{{ e }}</span>
          } @else if (noneOn()) {
            <span class="adm-error">{{ i18n.t('modules.atLeastOne') }}</span>
          } @else {
            <span class="adm-muted">{{ i18n.t(dirty() ? 'admin.unsaved' : 'admin.noChanges') }}</span>
          }
        </span>
        @if (dirty()) {
          <button type="button" class="adm-btn adm-push" (click)="discard()">{{ i18n.t('admin.discard') }}</button>
        }
        <button type="button" class="adm-btn adm-btn--primary" [class.adm-push]="!dirty()" [disabled]="!dirty() || busy() || noneOn()" (click)="save()">
          <mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}
        </button>
      </footer>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .mod__text { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .mod__text .adm-hint { flex-basis: 100%; }
    .adm-card__note { display: flex; align-items: flex-start; gap: 6px; border-top: 1px solid var(--border-subtle); }
    .mod__note-icon { flex: none; width: 14px; height: 14px; font-size: 14px; }
  `,
})
export class AdminModulesComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly setup = inject(SetupService);
  private readonly features = inject(SystemFeaturesService);

  protected readonly modules = MODULES;
  protected readonly saved = signal<Flags>({ soc: false, noc: false, tickets: false });
  protected readonly draft = signal<Flags>({ soc: false, noc: false, tickets: false });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Basta con uno encendido: SOC, NOC o la Ticketera sola. */
  protected readonly noneOn = computed(() => !this.draft().soc && !this.draft().noc && !this.draft().tickets);
  protected readonly dirty = computed(() => MODULES.some((m) => this.draft()[m.id] !== this.saved()[m.id]));

  async ngOnInit(): Promise<void> {
    try {
      const [status, features] = await Promise.all([this.setup.loadStatus(), this.features.list()]);
      const tickets = features.find((f) => f.code === TICKETS_FEATURE)?.isEnabled ?? false;
      this.apply({ soc: status.socEnabled, noc: status.nocEnabled, tickets });
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('modules.loadError')));
    }
  }

  protected toggle(id: ModuleId): void {
    this.draft.update((d) => ({ ...d, [id]: !d[id] }));
    this.notice.set(null);
    this.error.set(null);
  }

  protected discard(): void {
    this.draft.set({ ...this.saved() });
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (this.noneOn()) return;
    this.busy.set(true);
    this.error.set(null);
    const before = this.saved();
    try {
      // Actualiza el estado cacheado: los menús aparecen o se van al instante.
      // Lo que se enciende va primero, así nunca quedan los tres apagados a
      // mitad del guardado (el servidor lo rechazaría).
      let tickets = before.tickets;
      if (d.tickets && !before.tickets) {
        tickets = (await this.features.setEnabled(TICKETS_FEATURE, true)).isEnabled;
      }
      let flags = { socEnabled: before.soc, nocEnabled: before.noc };
      if (d.soc !== before.soc || d.noc !== before.noc) {
        flags = await this.setup.updateModules({ socEnabled: d.soc, nocEnabled: d.noc });
      }
      if (!d.tickets && before.tickets) {
        tickets = (await this.features.setEnabled(TICKETS_FEATURE, false)).isEnabled;
      }
      this.apply({ soc: flags.socEnabled, noc: flags.nocEnabled, tickets });
      this.notice.set(this.i18n.t('admin.saved'));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('modules.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  private apply(flags: Flags): void {
    this.saved.set(flags);
    this.draft.set({ ...flags });
  }
}
