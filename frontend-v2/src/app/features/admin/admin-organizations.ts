import { ChangeDetectionStrategy, Component, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { LogSource, Organization, OrganizationKind, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { ModuleAccessService } from '../../core/auth/module-access.service';

import '../../core/i18n/packs/admin';
/** Tipos que solo tienen sentido con NOC (contratas de terreno y carriers). */
const NOC_TYPES: ReadonlySet<string> = new Set(['contractor', 'carrier']);
const TYPE_TONE: Record<string, string> = { client: 'tone-info', mandante: 'tone-ok', contractor: 'tone-warn', carrier: 'tone-system', internal: 'tone-neutral' };
/** Nombre de fábrica de los tipos de sistema: si el admin no lo cambió, se traduce. */
const DEFAULT_NAMES: Record<string, string> = { client: 'Cliente', mandante: 'Mandante', internal: 'Interna', contractor: 'Contratista', carrier: 'Carrier' };

/**
 * Organizaciones y tecnologías (Administración → Catálogos), re-vestido con
 * los componentes del artboard "Administración": filtro por tipo, alta en
 * línea, editar y eliminar en la fila, el mandante "a través de" (JUNJI vía
 * Mundo) y los tipos configurables (comentario del dueño #12). Desactivar
 * nunca borra; eliminar solo se puede sin nada asociado.
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
          @for (t of offeredTypes(); track t.code) {
            <button type="button" class="seg" [attr.aria-pressed]="typeFilter() === t.code" (click)="typeFilter.set(t.code)">{{ typeLabel(t.code) }}</button>
          }
        </span>
      </div>
      <form class="adm-row org__add" (ngSubmit)="create()">
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.name') }}</span><input class="adm-input" name="name" [ngModel]="name()" (ngModelChange)="name.set($event)" /></label>
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.code') }}</span><input class="adm-input mono" name="code" placeholder="MUNDO" [ngModel]="code()" (ngModelChange)="code.set($event)" /></label>
        <label class="adm-field adm-field--narrow">
          <span class="adm-label">{{ i18n.t('orgs.type') }}</span>
          <select class="adm-input" name="type" [ngModel]="type()" (ngModelChange)="type.set($event)">
            @for (t of offeredTypes(); track t.code) { <option [value]="t.code">{{ typeLabel(t.code) }}</option> }
          </select>
        </label>
        <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !name().trim() || !code().trim()"><mat-icon>add</mat-icon>{{ i18n.t('orgs.add') }}</button>
      </form>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('orgs.name') }}</th><th>{{ i18n.t('orgs.code') }}</th><th>{{ i18n.t('orgs.type') }}</th><th>{{ i18n.t('orgs.via') }}</th><th>{{ i18n.t('orgs.active') }}</th><th></th></tr></thead>
          <tbody>
            @for (org of visibleOrgs(); track org.id) {
              @if (editingId() === org.id) {
                <tr class="org__editing">
                  <td><input class="adm-input" name="editName" [attr.aria-label]="i18n.t('orgs.name')" [ngModel]="editName()" (ngModelChange)="editName.set($event)" /></td>
                  <td><input class="adm-input mono" name="editCode" [attr.aria-label]="i18n.t('orgs.code')" [ngModel]="editCode()" (ngModelChange)="editCode.set($event)" /></td>
                  <td>
                    <select class="adm-input" name="editType" [attr.aria-label]="i18n.t('orgs.type')" [ngModel]="editType()" (ngModelChange)="editType.set($event)">
                      @for (t of typesFor(org); track t.code) { <option [value]="t.code">{{ typeLabel(t.code) }}</option> }
                    </select>
                  </td>
                  <td>
                    <select class="adm-input" name="editVia" [attr.aria-label]="i18n.t('orgs.via')" [ngModel]="editVia()" (ngModelChange)="editVia.set($event)">
                      <option value="">{{ i18n.t('orgs.viaNone') }}</option>
                      @for (o of viaOptions(org); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
                    </select>
                  </td>
                  <td></td>
                  <td class="adm-num org__actions">
                    <button type="button" class="adm-btn" (click)="editingId.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
                    <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !editName().trim() || !editCode().trim()" (click)="saveEdit(org)"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
                  </td>
                </tr>
              } @else {
                <tr [class.org__inactive]="!org.active">
                  <td><strong>{{ org.name }}</strong></td>
                  <td class="mono adm-secondary">{{ org.code }}</td>
                  <td><span class="pill" [class]="typeTone(org.type)">{{ typeLabel(org.type) }}</span></td>
                  <td class="adm-secondary">{{ org.viaName ?? '—' }}</td>
                  <td>
                    <label class="switch">
                      <input class="switch__input" type="checkbox" role="switch" [checked]="org.active" [disabled]="busy()" (change)="toggleOrg(org)" [attr.aria-label]="org.name" />
                      <span class="switch__track" aria-hidden="true"></span>
                    </label>
                  </td>
                  <td class="adm-num org__actions">
                    @if (deletingId() === org.id) {
                      <span class="org__confirm">{{ i18n.t('orgs.deleteConfirm') }}
                        <button type="button" class="adm-btn" (click)="deletingId.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
                        <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove(org)">{{ i18n.t('adminChecklist.delete') }}</button>
                      </span>
                    } @else {
                      <button type="button" class="adm-icon-btn" [disabled]="busy()" [title]="i18n.t('orgs.edit')" [attr.aria-label]="i18n.t('orgs.edit') + ' ' + org.name" (click)="startEdit(org)"><mat-icon>edit</mat-icon></button>
                      <button type="button" class="adm-icon-btn adm-icon-btn--danger" [disabled]="busy()" [title]="i18n.t('adminChecklist.delete')" [attr.aria-label]="i18n.t('adminChecklist.delete') + ' ' + org.name" (click)="askDelete(org)"><mat-icon>delete</mat-icon></button>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
        @if (!visibleOrgs().length) { <p class="adm-empty">{{ i18n.t('orgs.empty') }}</p> }
      </div>
      <p class="adm-card__note org__note">{{ i18n.t('orgs.note') }}</p>
    </section>

    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>category</mat-icon>{{ i18n.t('orgs.types') }} <span class="mono adm-secondary">{{ offeredTypes().length }}</span></h3>
      </div>
      <p class="adm-card__note org__lead">{{ i18n.t('orgs.typesHint') }}</p>
      <form class="adm-row org__add" (ngSubmit)="createType()">
        <label class="adm-field"><span class="adm-label">{{ i18n.t('orgs.name') }}</span><input class="adm-input" name="typeName" [placeholder]="i18n.t('orgs.typeNamePlaceholder')" [ngModel]="typeName()" (ngModelChange)="typeName.set($event)" /></label>
        <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('orgs.code') }}</span><input class="adm-input mono" name="typeCode" placeholder="partner" [ngModel]="typeCode()" (ngModelChange)="typeCode.set($event)" /></label>
        <label class="adm-switch-row org__client">
          <span class="switch">
            <input class="switch__input" type="checkbox" role="switch" [checked]="typeIsClient()" (change)="typeIsClient.set(!typeIsClient())" />
            <span class="switch__track" aria-hidden="true"></span>
          </span>
          <span class="adm-strong">{{ i18n.t('orgs.isClient') }}</span>
        </label>
        <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !typeName().trim() || !validCode(typeCode())"><mat-icon>add</mat-icon>{{ i18n.t('orgs.addType') }}</button>
      </form>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('orgs.name') }}</th><th>{{ i18n.t('orgs.code') }}</th><th>{{ i18n.t('orgs.isClient') }}</th><th class="adm-num">{{ i18n.t('orgs.title') }}</th><th></th></tr></thead>
          <tbody>
            @for (t of offeredTypes(); track t.code) {
              <tr>
                <td>
                  @if (renamingCode() === t.code) {
                    <input class="adm-input" name="renameType" [attr.aria-label]="i18n.t('orgs.name')" [ngModel]="renameValue()" (ngModelChange)="renameValue.set($event)" (keydown.enter)="saveRename(t)" />
                  } @else {
                    <strong>{{ typeLabel(t.code) }}</strong>
                    @if (t.description) { <span class="adm-small adm-secondary adm-block">{{ t.description }}</span> }
                  }
                </td>
                <td class="mono adm-secondary">{{ t.code }}</td>
                <td>
                  <label class="switch">
                    <input class="switch__input" type="checkbox" role="switch" [checked]="t.isClient" [disabled]="busy() || t.code === 'client'" (change)="toggleTypeClient(t)" [attr.aria-label]="i18n.t('orgs.isClient') + ' ' + t.name" />
                    <span class="switch__track" aria-hidden="true"></span>
                  </label>
                </td>
                <td class="adm-num mono">{{ t.organizations }}</td>
                <td class="adm-num org__actions">
                  @if (renamingCode() === t.code) {
                    <button type="button" class="adm-btn" (click)="renamingCode.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
                    <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !renameValue().trim()" (click)="saveRename(t)"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
                  } @else if (deletingType() === t.code) {
                    <span class="org__confirm">
                      @if (t.organizations > 0) {
                        {{ i18n.tf('orgs.typeMoveTo', t.organizations) }}
                        <select class="adm-input org__move" name="moveTo" [attr.aria-label]="i18n.t('orgs.type')" [ngModel]="moveTo()" (ngModelChange)="moveTo.set($event)">
                          <option value="" disabled>{{ i18n.t('teams.pick') }}</option>
                          @for (o of offeredTypes(); track o.code) { @if (o.code !== t.code) { <option [value]="o.code">{{ typeLabel(o.code) }}</option> } }
                        </select>
                      } @else {
                        {{ i18n.t('orgs.typeDeleteConfirm') }}
                      }
                      <button type="button" class="adm-btn" (click)="deletingType.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
                      <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy() || (t.organizations > 0 && !moveTo())" (click)="deleteType(t)">{{ i18n.t('adminChecklist.delete') }}</button>
                    </span>
                  } @else {
                    <button type="button" class="adm-icon-btn" [disabled]="busy()" [title]="i18n.t('orgs.rename')" [attr.aria-label]="i18n.t('orgs.rename') + ' ' + t.name" (click)="startRename(t)"><mat-icon>edit</mat-icon></button>
                    @if (!t.system) {
                      <button type="button" class="adm-icon-btn adm-icon-btn--danger" [disabled]="busy()" [title]="i18n.t('adminChecklist.delete')" [attr.aria-label]="i18n.t('adminChecklist.delete') + ' ' + t.name" (click)="deletingType.set(t.code); moveTo.set('')"><mat-icon>delete</mat-icon></button>
                    }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
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
    .org__actions { white-space: nowrap; }
    .org__actions .adm-btn { margin-left: 6px; }
    .org__confirm { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; font-size: 12px; color: var(--danger); }
    .org__move { width: auto; min-width: 120px; }
    .org__client { align-self: center; flex: 0 0 auto; }
    .org__editing td { vertical-align: middle; }
  `,
})
export class AdminOrganizationsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(OrganizationsService);
  private readonly injector = inject(Injector);
  private readonly modules = inject(ModuleAccessService);

  protected readonly organizations = signal<Organization[]>([]);
  protected readonly kinds = signal<OrganizationKind[]>([]);
  protected readonly sources = signal<LogSource[]>([]);
  protected readonly typeFilter = signal('');
  protected readonly name = signal('');
  protected readonly code = signal('');
  protected readonly type = signal('client');
  protected readonly editingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editCode = signal('');
  protected readonly editType = signal('client');
  protected readonly editVia = signal('');
  protected readonly typeName = signal('');
  protected readonly typeCode = signal('');
  protected readonly typeIsClient = signal(true);
  protected readonly renamingCode = signal<string | null>(null);
  protected readonly renameValue = signal('');
  protected readonly deletingType = signal<string | null>(null);
  protected readonly moveTo = signal('');
  protected readonly srcName = signal('');
  protected readonly srcCode = signal('');
  protected readonly srcCategory = signal('network');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Sin NOC no se ofrecen "Contratista" ni "Carrier" (regla del dueño: módulo apagado no aparece). */
  protected readonly offeredTypes = computed(() => this.kinds().filter((t) => this.modules.noc() || !NOC_TYPES.has(t.code)));

  protected readonly visibleOrgs = computed(() => {
    const t = this.typeFilter();
    return t ? this.organizations().filter((o) => o.type === t) : this.organizations();
  });

  /** Categorías ya usadas, como sugerencias (sigue siendo texto libre, como en el backend). */
  protected readonly categories = computed(() => [...new Set(['network', 'endpoint', 'identity', 'cloud', ...this.sources().map((s) => s.category)])]);

  async ngOnInit(): Promise<void> {
    await this.modules.load();
    await this.reload();
  }

  /** Nombre del tipo: el que puso el admin; los de fábrica sin cambiar, traducidos. */
  protected typeLabel(code: string): string {
    const t = this.kinds().find((k) => k.code === code);
    if (!t) return code;
    return DEFAULT_NAMES[code] === t.name ? this.i18n.t(`orgs.type.${code}` as MessageKey) : t.name;
  }

  protected typeTone(code: string): string {
    return TYPE_TONE[code] ?? 'tone-system';
  }

  protected validCode(code: string): boolean {
    return /^[a-z0-9_]{2,40}$/.test(code);
  }

  /** Los tipos ofrecidos más el que ya tiene (una contrata sigue viéndose como tal). */
  protected typesFor(org: Organization): OrganizationKind[] {
    const list = this.offeredTypes();
    const own = this.kinds().find((k) => k.code === org.type);
    return list.some((k) => k.code === org.type) || !own ? list : [...list, own];
  }

  /** Mandantes posibles: cualquier otra organización activa. */
  protected viaOptions(org: Organization): Organization[] {
    return this.organizations().filter((o) => o.id !== org.id && o.active && o.type !== 'internal');
  }

  protected startEdit(org: Organization): void {
    this.deletingId.set(null);
    this.editingId.set(org.id);
    this.editName.set(org.name);
    this.editCode.set(org.code);
    this.editType.set(org.type);
    this.editVia.set(org.viaOrganizationId ?? '');
  }

  protected async saveEdit(org: Organization): Promise<void> {
    await this.run(
      () =>
        this.api.patch(org.id, {
          name: this.editName().trim(),
          code: this.editCode().trim(),
          type: this.editType(),
          viaOrganizationId: this.editVia() || null,
        }),
      () => this.editingId.set(null),
    );
  }

  /**
   * Eliminar (pedido del dueño 2026-10-05, canvas v22): si no tiene nada
   * asociado se confirma en la fila; si tiene algo se abre el popup para
   * resolverlo ahí mismo. CDK Dialog y el popup se cargan recién aquí.
   */
  protected async askDelete(org: Organization): Promise<void> {
    this.editingId.set(null);
    this.error.set(null);
    this.busy.set(true);
    let dependents;
    try {
      dependents = await this.api.dependents(org.id);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('orgs.saveError')));
      return;
    } finally {
      this.busy.set(false);
    }
    const d = dependents;
    if (!d.services.length && !d.teams.length && !d.assets.length && !d.tickets.length && !d.contacts) {
      this.deletingId.set(org.id);
      return;
    }
    const [{ Dialog }, { OrgDeleteDialogComponent }] = await Promise.all([import('@angular/cdk/dialog'), import('./org-delete-dialog')]);
    const ref = this.injector.get(Dialog).open<boolean>(OrgDeleteDialogComponent, {
      ariaLabel: this.i18n.tf('orgDelete.title', org.name),
      data: { org, dependents: d, targets: this.organizations().filter((o) => o.id !== org.id) },
      maxWidth: '100vw',
    });
    ref.closed.subscribe((deleted) => {
      if (deleted) void this.reload();
    });
  }

  protected async remove(org: Organization): Promise<void> {
    await this.run(() => this.api.remove(org.id), () => this.deletingId.set(null));
  }

  protected async create(): Promise<void> {
    await this.run(() => this.api.create({ name: this.name().trim(), code: this.code().trim(), type: this.type() }), () => {
      this.name.set('');
      this.code.set('');
    });
  }

  protected async createType(): Promise<void> {
    await this.run(
      () => this.api.createType({ code: this.typeCode().trim(), name: this.typeName().trim(), isClient: this.typeIsClient() }),
      () => {
        this.typeName.set('');
        this.typeCode.set('');
      },
    );
  }

  protected startRename(t: OrganizationKind): void {
    this.deletingType.set(null);
    this.renamingCode.set(t.code);
    this.renameValue.set(this.typeLabel(t.code));
  }

  protected async saveRename(t: OrganizationKind): Promise<void> {
    const name = this.renameValue().trim();
    if (!name) return;
    await this.run(() => this.api.patchType(t.code, { name }), () => this.renamingCode.set(null));
  }

  protected async toggleTypeClient(t: OrganizationKind): Promise<void> {
    await this.run(() => this.api.patchType(t.code, { isClient: !t.isClient }), () => undefined);
  }

  protected async deleteType(t: OrganizationKind): Promise<void> {
    await this.run(() => this.api.deleteType(t.code, t.organizations > 0 ? this.moveTo() : undefined), () => this.deletingType.set(null));
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
      const [orgs, kinds, sources] = await Promise.all([this.api.list(), this.api.listTypes(), this.api.listLogSources()]);
      this.organizations.set(orgs);
      this.kinds.set(kinds);
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
