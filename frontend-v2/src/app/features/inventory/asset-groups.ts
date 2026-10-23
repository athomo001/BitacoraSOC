import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AssetGroup, AssetGroupInput, InventoryMeta, InventoryService } from '../../core/inventory/inventory.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';
import { LocationFieldsComponent, PlaceOption, PlaceValue, coordsLabel } from './location-fields';

import '../../core/i18n/packs/inventory';

/**
 * Inventario → Grupos (pedido del dueño 2026-10-23): un rack o una sala con
 * muchos equipos en el mismo lugar. El grupo guarda localidad, dirección,
 * coordenadas y rack; sus equipos los toman de él y, si el grupo cambia,
 * cambian todos. Borrarlo deja a los equipos con la ubicación que tenían.
 */
@Component({
  selector: 'app-asset-groups',
  standalone: true,
  imports: [MatIconModule, LocationFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-card__head">
      <h2 class="adm-card__title"><mat-icon>view_module</mat-icon>{{ i18n.t('inv.g.title') }}</h2>
      @if (meta().canCreate && !editing()) {
        <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="openNew()"><mat-icon>add</mat-icon>{{ i18n.t('inv.g.new') }}</button>
      }
      <button type="button" class="adm-icon-btn" [class.adm-push]="!meta().canCreate || editing()" [attr.aria-label]="i18n.t('inv.cancel')" (click)="closed.emit()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="ag__body">
      @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
      @if (notice(); as n) { <p class="adm-hint ag__notice" role="status"><mat-icon>check_circle</mat-icon>{{ n }}</p> }
      @if (editing(); as ed) {
        <form class="ag__form" (submit)="$event.preventDefault(); save()">
          <div class="ag__grid">
            <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.g.name') }}</span>
              <input class="adm-input" name="groupName" maxlength="120" required [placeholder]="i18n.t('inv.g.namePh')" [value]="draft().name" (input)="patch({ name: val($event) })" /></label>
            <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.area') }}</span>
              <select class="adm-input" name="groupArea" (change)="patch({ area: val($event) })">
                @for (a of ownableAreas(); track a.code) { <option [value]="a.code" [selected]="a.code === draft().area">{{ a.name }}</option> }
              </select></label>
            <app-location-fields [value]="draft()" [units]="units()" (valueChange)="patch($event)" (validChange)="coordsOk.set($event)" />
            <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.rack') }}</span>
              <input class="adm-input" name="groupRack" [value]="draft().rack ?? ''" (input)="patch({ rack: val($event) })" /></label>
            <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.client') }}</span>
              <select class="adm-input" name="groupClient" (change)="patch({ clientId: val($event) || undefined })">
                <option value="" [selected]="!draft().clientId">{{ i18n.t('inv.g.internal') }}</option>
                @for (o of clients(); track o.id) { <option [value]="o.id" [selected]="draft().clientId === o.id">{{ o.name }}</option> }
              </select></label>
          </div>
          @if (ed !== 'new') { <p class="adm-hint">{{ i18n.tf('inv.g.saveHint', ed.assetCount) }}</p> }
          @if (confirmDelete() && ed !== 'new') {
            <div class="ag__confirm" role="group">
              <span>{{ i18n.tf('inv.g.deleteConfirm', ed.name) }}</span>
              <button type="button" class="adm-btn" (click)="confirmDelete.set(false)">{{ i18n.t('inv.keep') }}</button>
              <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove(ed)"><mat-icon>delete_forever</mat-icon>{{ i18n.t('inv.g.delete') }}</button>
            </div>
          }
          <div class="ag__actions">
            @if (ed !== 'new' && !confirmDelete()) {
              <button type="button" class="adm-btn ag__left" (click)="confirmDelete.set(true)"><mat-icon>delete</mat-icon>{{ i18n.t('inv.g.delete') }}</button>
            }
            <button type="button" class="adm-btn" (click)="editing.set(null)">{{ i18n.t('inv.cancel') }}</button>
            <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !draft().name.trim() || !coordsOk()"><mat-icon>save</mat-icon>{{ i18n.t(ed === 'new' ? 'inv.g.create' : 'inv.save') }}</button>
          </div>
        </form>
      } @else {
        <p class="adm-hint">{{ i18n.t('inv.g.hint') }}</p>
      }
      @for (g of groups(); track g.id) {
        <div class="ag__row">
          <span class="ag__text">
            <b>{{ g.name }}</b>
            <span class="adm-small adm-secondary">{{ where(g) }}</span>
          </span>
          <span class="pill tone-neutral mono">{{ i18n.tf('inv.g.count', g.assetCount) }}</span>
          <button type="button" class="adm-btn" (click)="show.emit(g)"><mat-icon>filter_list</mat-icon>{{ i18n.t('inv.g.show') }}</button>
          @if (g.canEdit) {
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.tf('inv.g.edit', g.name)" (click)="openEdit(g)"><mat-icon>edit</mat-icon></button>
          }
        </div>
      } @empty {
        @if (loaded()) { <p class="adm-empty">{{ i18n.t('inv.g.empty') }}</p> }
      }
    </div>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ag__body { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
    .ag__body p { margin: 0; }
    .ag__notice { display: flex; gap: 6px; align-items: center; }
    .ag__form { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); }
    .ag__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
    .ag__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .ag__left { margin-right: auto; }
    .ag__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius-md); background: var(--status-critical-bg); }
    .ag__confirm span { flex: 1; min-width: 180px; }
    .ag__row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
    .ag__text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  `,
})
export class AssetGroupsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(InventoryService);
  private readonly territory = inject(TerritoryService);
  private readonly orgs = inject(OrganizationsService);

  readonly meta = input.required<InventoryMeta>();
  /** «Ver sus equipos»: la lista se filtra por el grupo. */
  readonly show = output<AssetGroup>();
  /** Cambió un grupo: la lista y la ficha abierta se recargan. */
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly groups = signal<AssetGroup[]>([]);
  protected readonly units = signal<PlaceOption[]>([]);
  protected readonly clients = signal<Organization[]>([]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** null = mirando la lista; 'new' = grupo nuevo; si no, el grupo que se edita. */
  protected readonly editing = signal<AssetGroup | 'new' | null>(null);
  protected readonly draft = signal<AssetGroupInput>({ name: '', area: '' });
  protected readonly coordsOk = signal(true);
  protected readonly confirmDelete = signal(false);

  /** Dueña: el admin elige cualquiera; los demás, una de sus áreas (o la que ya tiene). */
  protected readonly ownableAreas = computed(() => {
    const m = this.meta();
    const ed = this.editing();
    return m.admin ? m.areas : m.areas.filter((a) => m.myAreas.includes(a.code) || (ed !== 'new' && a.code === ed?.area));
  });

  async ngOnInit(): Promise<void> {
    const [units, clients] = await Promise.all([
      this.territory.list(1, 5000).then((r) => r.units).catch(() => []),
      this.orgs.list({ active: true, clients: true }).catch(() => []),
      this.load(),
    ]);
    this.clients.set(clients);
    const nameOf = new Map(units.map((u) => [u.id, u.name]));
    this.units.set(units.filter((u) => u.active && u.kind !== 'country').map((u) => ({ id: u.id, label: u.parentId ? `${u.name} · ${nameOf.get(u.parentId) ?? ''}` : u.name })));
  }

  private async load(): Promise<void> {
    try {
      this.groups.set(await this.api.groups());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** «DC Santiago · Av. Ejemplo 1234 · Rack R-04 · -33.44, -70.66». */
  protected where(g: AssetGroup): string {
    return [g.clientName, g.placeName, g.address, g.rack ? this.i18n.tf('inv.g.rack', g.rack) : '', coordsLabel(g.latitude, g.longitude)].filter(Boolean).join(' · ') || this.i18n.t('inv.g.noPlace');
  }

  protected patch(p: Partial<AssetGroupInput> | Partial<PlaceValue>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected openNew(): void {
    this.reset();
    this.draft.set({ name: '', area: this.ownableAreas()[0]?.code ?? '' });
    this.editing.set('new');
  }

  protected openEdit(g: AssetGroup): void {
    this.reset();
    this.draft.set({ name: g.name, area: g.area, territorialUnitId: g.territorialUnitId, address: g.address, latitude: g.latitude, longitude: g.longitude, rack: g.rack, clientId: g.clientId });
    this.editing.set(g);
  }

  private reset(): void {
    this.error.set(null);
    this.notice.set(null);
    this.confirmDelete.set(false);
    this.coordsOk.set(true);
  }

  protected async save(): Promise<void> {
    const ed = this.editing();
    if (!ed) return;
    await this.run(async () => {
      if (ed === 'new') {
        await this.api.createGroup(this.draft());
        this.notice.set(this.i18n.tf('inv.g.created', this.draft().name.trim()));
      } else {
        const moved = await this.api.updateGroup(ed.id, this.draft());
        this.notice.set(this.i18n.tf('inv.g.saved', moved));
      }
      this.editing.set(null);
      await this.load();
      this.changed.emit();
    });
  }

  protected async remove(g: AssetGroup): Promise<void> {
    await this.run(async () => {
      await this.api.deleteGroup(g.id);
      this.editing.set(null);
      await this.load();
      this.changed.emit();
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
