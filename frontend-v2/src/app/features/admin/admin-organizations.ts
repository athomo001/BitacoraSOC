import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { LogSource, Organization, OrganizationType, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

const TYPES: readonly OrganizationType[] = ['client', 'contractor', 'carrier', 'internal'];
const TYPE_TONE: Record<OrganizationType, string> = { client: 'tone-info', contractor: 'tone-warn', carrier: 'tone-system', internal: 'tone-neutral' };

/**
 * Organizaciones y tecnologías (Administración → Catálogos), re-vestido con
 * los componentes del artboard "Administración": filtro por tipo, alta en
 * línea y activar/desactivar con interruptor (desactivar nunca borra: las
 * entradas y equipos que la usan la conservan).
 */
@Component({
  selector: 'app-admin-organizations',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.organizations') }}</h2>
        <p class="adm-muted">{{ i18n.t('orgs.subtitle') }}</p>
      </div>
    </header>

    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>business</mat-icon>{{ i18n.t('orgs.title') }} <span class="mono adm-secondary">{{ organizations().length }}</span></h3>
        <span class="org__segs adm-push" role="group" [attr.aria-label]="i18n.t('orgs.type')">
          <button type="button" class="seg" [attr.aria-pressed]="typeFilter() === ''" (click)="typeFilter.set('')">{{ i18n.t('audit.cat.all') }}</button>
          @for (t of types; track t) {
            <button type="button" class="seg" [attr.aria-pressed]="typeFilter() === t" (click)="typeFilter.set(t)">{{ i18n.t(typeKey(t)) }}</button>
          }
        </span>
      </div>
      <form class="adm-row org__add" (ngSubmit)="create()">
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.name') }}</span><input class="adm-input" name="name" [ngModel]="name()" (ngModelChange)="name.set($event)" /></label>
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.code') }}</span><input class="adm-input mono" name="code" placeholder="CONTRATA-NORTE" [ngModel]="code()" (ngModelChange)="code.set($event)" /></label>
        <label class="adm-field adm-field--narrow">
          <span class="adm-label">{{ i18n.t('orgs.type') }}</span>
          <select class="adm-input" name="type" [ngModel]="type()" (ngModelChange)="type.set($event)">
            @for (t of types; track t) { <option [value]="t">{{ i18n.t(typeKey(t)) }}</option> }
          </select>
        </label>
        <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !name().trim() || !code().trim()"><mat-icon>add</mat-icon>{{ i18n.t('orgs.add') }}</button>
      </form>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('orgs.name') }}</th><th>{{ i18n.t('orgs.code') }}</th><th>{{ i18n.t('orgs.type') }}</th><th>{{ i18n.t('orgs.active') }}</th></tr></thead>
          <tbody>
            @for (org of visibleOrgs(); track org.id) {
              <tr [class.org__inactive]="!org.active">
                <td><strong>{{ org.name }}</strong></td>
                <td class="mono adm-secondary">{{ org.code }}</td>
                <td><span class="pill" [class]="typeTone[org.type]">{{ i18n.t(typeKey(org.type)) }}</span></td>
                <td>
                  <label class="switch">
                    <input class="switch__input" type="checkbox" role="switch" [checked]="org.active" [disabled]="busy()" (change)="toggleOrg(org)" [attr.aria-label]="org.name" />
                    <span class="switch__track" aria-hidden="true"></span>
                  </label>
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!visibleOrgs().length) { <p class="adm-empty">{{ i18n.t('orgs.empty') }}</p> }
      </div>
      <p class="adm-card__note org__note">{{ i18n.t('orgs.note') }}</p>
    </section>

    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>memory</mat-icon>{{ i18n.t('orgs.sources') }} <span class="mono adm-secondary">{{ sources().length }}</span></h3>
      </div>
      <p class="adm-card__note org__lead">{{ i18n.t('orgs.sourcesHint') }}</p>
      <form class="adm-row org__add" (ngSubmit)="createSource()">
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.name') }}</span><input class="adm-input" name="srcName" placeholder="Firewall Perimetral Fortinet" [ngModel]="srcName()" (ngModelChange)="srcName.set($event)" /></label>
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.code') }}</span><input class="adm-input mono" name="srcCode" placeholder="fortinet_firewall" [ngModel]="srcCode()" (ngModelChange)="srcCode.set($event)" /></label>
        <label class="adm-field adm-field--narrow">
          <span class="adm-label">{{ i18n.t('orgs.category') }}</span>
          <input class="adm-input" name="srcCategory" list="org-categories" [ngModel]="srcCategory()" (ngModelChange)="srcCategory.set($event)" />
          <datalist id="org-categories">@for (c of categories(); track c) { <option [value]="c"></option> }</datalist>
        </label>
        <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !srcName().trim() || !srcCode().trim()"><mat-icon>add</mat-icon>{{ i18n.t('orgs.addSource') }}</button>
      </form>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('orgs.name') }}</th><th>{{ i18n.t('orgs.code') }}</th><th>{{ i18n.t('orgs.category') }}</th><th>{{ i18n.t('orgs.active') }}</th></tr></thead>
          <tbody>
            @for (src of sources(); track src.id) {
              <tr [class.org__inactive]="!src.active">
                <td><strong>{{ src.displayName }}</strong></td>
                <td class="mono adm-secondary">{{ src.code }}</td>
                <td><span class="pill tone-neutral">{{ src.category }}</span></td>
                <td>
                  <label class="switch">
                    <input class="switch__input" type="checkbox" role="switch" [checked]="src.active" [disabled]="busy()" (change)="toggleSource(src)" [attr.aria-label]="src.displayName" />
                    <span class="switch__track" aria-hidden="true"></span>
                  </label>
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!sources().length) { <p class="adm-empty">{{ i18n.t('orgs.sourcesEmpty') }}</p> }
      </div>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .org__segs { display: flex; flex-wrap: wrap; gap: 4px; }
    .org__add { padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
    .org__inactive td { color: var(--text-muted); }
    .org__note { border-top: 1px solid var(--border-subtle); }
    .org__lead { padding-bottom: 0; }
  `,
})
export class AdminOrganizationsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(OrganizationsService);

  protected readonly types = TYPES;
  protected readonly typeTone = TYPE_TONE;

  protected readonly organizations = signal<Organization[]>([]);
  protected readonly sources = signal<LogSource[]>([]);
  protected readonly typeFilter = signal<OrganizationType | ''>('');
  protected readonly name = signal('');
  protected readonly code = signal('');
  protected readonly type = signal<OrganizationType>('contractor');
  protected readonly srcName = signal('');
  protected readonly srcCode = signal('');
  protected readonly srcCategory = signal('network');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly visibleOrgs = computed(() => {
    const t = this.typeFilter();
    return t ? this.organizations().filter((o) => o.type === t) : this.organizations();
  });

  /** Categorías ya usadas, como sugerencias (sigue siendo texto libre, como en el backend). */
  protected readonly categories = computed(() => [...new Set(['network', 'endpoint', 'identity', 'cloud', ...this.sources().map((s) => s.category)])]);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  protected typeKey(t: OrganizationType): MessageKey {
    return `orgs.type.${t}` as MessageKey;
  }

  protected async create(): Promise<void> {
    await this.run(() => this.api.create({ name: this.name().trim(), code: this.code().trim(), type: this.type() }), () => {
      this.name.set('');
      this.code.set('');
    });
  }

  protected async createSource(): Promise<void> {
    await this.run(
      () => this.api.createLogSource({ displayName: this.srcName().trim(), code: this.srcCode().trim(), category: this.srcCategory().trim() }),
      () => {
        this.srcName.set('');
        this.srcCode.set('');
      },
    );
  }

  protected async toggleOrg(org: Organization): Promise<void> {
    await this.run(() => this.api.patch(org.id, { active: !org.active }), () => undefined);
  }

  protected async toggleSource(src: LogSource): Promise<void> {
    await this.run(() => this.api.patchLogSource(src.id, { active: !src.active }), () => undefined);
  }

  private async reload(): Promise<void> {
    try {
      const [orgs, sources] = await Promise.all([this.api.list(), this.api.listLogSources()]);
      this.organizations.set(orgs);
      this.sources.set(sources);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('orgs.loadError')));
    }
  }

  private async run(action: () => Promise<unknown>, onSuccess: () => void): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      onSuccess();
      await this.reload();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('orgs.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
