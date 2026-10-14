import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DenseTableColumn, DenseTableComponent } from '../../shared/ui/dense-table/dense-table';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';
import { TerritorialLabelsFormComponent } from '../territory/territorial-labels-form';
import { TerritoryImportComponent } from '../territory/territory-import';
import { AdminTerritoryMapComponent } from './admin-territory-map';

import '../../core/i18n/packs/admin';
type TerritoryRow = TerritorialUnit & Record<string, unknown>;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** ¿`row` está debajo de `path`? (ltree: "CL.CL-BI" contiene "CL.CL-BI.CL-BI-CONCE"). */
function isUnder(row: TerritorialUnit, path: string): boolean {
  return row.path.startsWith(path + '.');
}

/**
 * Territorio (Administración → Catálogos, solo con NOC), re-vestido con los
 * componentes del artboard "Administración": nombres de cada nivel, import
 * y el árbol aplanado por path con búsqueda. Activar/desactivar es la
 * corrección más común de un import genérico (HU-TERR-3) y nunca borra.
 *
 * Árbol (pendiente #23 del dueño): marcar una región marca todo lo que tiene
 * abajo; cada nodo se abre y cierra, y arranca con las regiones cerradas.
 */
@Component({
  selector: 'app-admin-territory',
  standalone: true,
  imports: [MatIconModule, DenseTableComponent, TerritorialLabelsFormComponent, TerritoryImportComponent, AdminTerritoryMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Sin NOC esta sección ni aparece en el menú (admin-shell); si se llega igual, no muestra nada. -->
    @if (nocEnabled()) {
      <header class="adm-head">
        <div>
          <h2 class="adm-title">{{ i18n.t('admin.nav.territory') }}</h2>
          <p class="adm-muted">{{ i18n.t('territory.subtitle') }}</p>
        </div>
      </header>

      <div class="tr__grid">
        <section class="adm-card">
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>label</mat-icon>{{ i18n.t('territory.labels') }}</h3></div>
          <div class="adm-card__body">
            <p class="adm-hint">{{ i18n.t('territory.labelsHint') }}</p>
            <app-territorial-labels-form />
          </div>
        </section>

        <section class="adm-card">
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>upload</mat-icon>{{ i18n.t('territory.import') }}</h3></div>
          <div class="adm-card__body">
            <p class="adm-hint">{{ i18n.t('territory.importHint') }}</p>
            <app-territory-import (imported)="reload()" />
          </div>
        </section>
      </div>

      <!-- Mapa (#24): fondo y localidades sin ubicación. -->
      <app-admin-territory-map [units]="rows()" (placed)="onPlaced($event)" />

      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>account_tree</mat-icon>{{ i18n.t('territory.units') }} <span class="mono adm-secondary">{{ total() }}</span></h3>
          <label class="tr__search adm-push">
            <mat-icon>search</mat-icon>
            <input #q type="search" [value]="query()" (input)="query.set(q.value)" [placeholder]="i18n.t('territory.search')" [attr.aria-label]="i18n.t('territory.search')" />
          </label>
        </div>
        <div class="tr__bulk">
          @if (!query()) {
            <button type="button" class="adm-btn" (click)="expandAll()"><mat-icon>unfold_more</mat-icon>{{ i18n.t('territory.expandAll') }}</button>
            <button type="button" class="adm-btn" (click)="collapseAll()"><mat-icon>unfold_less</mat-icon>{{ i18n.t('territory.collapseAll') }}</button>
          }
          <label class="tr__check">
            <input
              type="checkbox"
              name="selectVisible"
              [checked]="allVisibleSelected()"
              [indeterminate]="someVisibleSelected()"
              [disabled]="visibleRows().length === 0"
              (change)="toggleVisible()"
            />
            {{ i18n.tf(query() ? 'territory.selectMatches' : 'territory.selectAll', visibleRows().length) }}
          </label>
          @if (selected().size > 0) {
            <span class="mono adm-secondary">{{ i18n.tf('territory.selectedCount', selected().size) }}</span>
            <button type="button" class="adm-btn" [disabled]="busy()" (click)="bulk(true)"><mat-icon>toggle_on</mat-icon>{{ i18n.t('territory.bulkOn') }}</button>
            <button type="button" class="adm-btn" [disabled]="busy()" (click)="bulk(false)"><mat-icon>toggle_off</mat-icon>{{ i18n.t('territory.bulkOff') }}</button>
            <button type="button" class="adm-btn" [disabled]="busy()" (click)="selected.set(empty())">{{ i18n.t('territory.clearSelection') }}</button>
          }
          @if (notice(); as n) { <span class="pill tone-ok adm-push"><mat-icon>task_alt</mat-icon>{{ n }}</span> }
        </div>
        @if (error(); as e) { <p class="adm-error tr__error" role="alert">{{ e }}</p> }
        @if (truncated()) {
          <p class="adm-card__note">{{ i18n.tf('territory.truncated', rows().length) }}</p>
        }
        <app-table class="tr__table" [style.height.px]="tableHeight()" [columns]="columns()" [rows]="visibleRows()" trackByKey="id" [emptyMessage]="i18n.t(query() ? 'territory.noMatch' : 'territory.empty')">
          <ng-template #cell let-row let-column="column">
            @switch (column) {
              @case ('name') {
                <span class="tr__node" [style.padding-left.px]="query() ? 0 : row.depth * 16">
                  @if (!query() && hasChildren(row)) {
                    <button type="button" class="tr__twist" [attr.aria-expanded]="!collapsed().has(row.id)"
                      [attr.aria-label]="i18n.t(collapsed().has(row.id) ? 'territory.expand' : 'territory.collapse') + ' ' + row.name"
                      (click)="toggleCollapsed(row.id)"><mat-icon>{{ collapsed().has(row.id) ? 'chevron_right' : 'expand_more' }}</mat-icon></button>
                  } @else if (!query()) {
                    <span class="tr__twist" aria-hidden="true"></span>
                  }
                  <label class="tr__name">
                    <input type="checkbox" [checked]="checkState().get(row.id) === 'all'" [indeterminate]="checkState().get(row.id) === 'some'" (change)="toggleOne(row.id)" [attr.aria-label]="row.name" />
                    <span [class.tr__inactive]="!row.active">{{ row.name }}</span>
                    @if (hasChildren(row)) { <span class="adm-small adm-secondary mono">{{ row.childCount }}</span> }
                    @if (inactiveBelow().get(row.id); as n) { <span class="tr__off">{{ i18n.tf('territory.inactiveBelow', n) }}</span> }
                  </label>
                </span>
              }
              @case ('kind') {
                {{ territory.kindLabel(row.kind) }}
              }
              @case ('coords') {
                {{ row.latitude ?? '—' }} / {{ row.longitude ?? '—' }}
              }
              @case ('active') {
                <label class="switch" [attr.title]="i18n.t(row.active ? 'territory.deactivate' : 'territory.reactivate')">
                  <input class="switch__input" type="checkbox" role="switch" [checked]="row.active" (change)="toggleActive(row)" [attr.aria-label]="row.name" />
                  <span class="switch__track" aria-hidden="true"></span>
                </label>
              }
              @default {
                {{ row[column] }}
              }
            }
          </ng-template>
        </app-table>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tr__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .tr__search { display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-muted); }
    .tr__search:focus-within { border-color: var(--accent); }
    .tr__search input { min-width: 180px; min-height: 28px; border: none; outline: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
    .tr__table { display: block; }
    .tr__inactive { color: var(--text-muted); text-decoration: line-through; }
    .tr__off { flex: none; padding: 0 6px; border-radius: var(--radius-sm); background: var(--status-warning-bg); color: var(--status-warning); font-size: 11px; }
    .tr__error { padding: 10px 14px 0; }
    .tr__bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 40px; padding: 6px 14px; border-bottom: 1px solid var(--border-subtle); font-size: 12px; }
    .tr__node { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
    .tr__twist { display: inline-grid; place-items: center; flex: none; width: 22px; height: 22px; padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; }
    button.tr__twist:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
    .tr__check, .tr__name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
    .tr__name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tr__check input, .tr__name input { accent-color: var(--accent); }
    @media (width <= 1100px) { .tr__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AdminTerritoryComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly territory = inject(TerritoryService);
  private readonly setup = inject(SetupService);

  protected readonly rows = signal<TerritoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly query = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Selección para activar o desactivar varias de una vez (pedido del dueño 2026-10-07). */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly allVisibleSelected = computed(() => {
    const rows = this.visibleRows();
    const sel = this.selected();
    return rows.length > 0 && rows.every((r) => sel.has(r.id));
  });
  protected readonly someVisibleSelected = computed(() => !this.allVisibleSelected() && this.visibleRows().some((r) => this.selected().has(r.id)));
  protected readonly truncated = computed(() => this.total() > this.rows().length);
  protected readonly nocEnabled = computed(() => this.setup.status()?.nocEnabled ?? false);

  protected readonly columns = computed<DenseTableColumn[]>(() => [
    { key: 'name', header: this.i18n.t('territory.col.name') },
    { key: 'kind', header: this.i18n.t('territory.col.kind') },
    { key: 'code', header: this.i18n.t('territory.col.code'), mono: true },
    { key: 'coords', header: this.i18n.t('territory.col.coords'), mono: true },
    { key: 'active', header: this.i18n.t('territory.col.active') },
  ]);

  /** Alto justo para las filas (36 px c/u + encabezado), hasta 540 px; más allá, scroll virtual. */
  protected readonly tableHeight = computed(() => Math.min(540, 40 + Math.max(this.visibleRows().length, 2) * 36));

  /** Nodos cerrados: lo que tienen debajo no se ve (sin búsqueda). */
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  /**
   * Con búsqueda se pierde la sangría del árbol: se ve la lista plana de lo
   * que coincide. Sin búsqueda, el árbol sin lo que cuelga de un nodo cerrado
   * (las filas vienen ordenadas por path: los hijos siguen al padre).
   */
  protected readonly visibleRows = computed(() => {
    const q = normalize(this.query().trim());
    if (q) return this.rows().filter((r) => normalize(r.name).includes(q) || normalize(r.code ?? '').includes(q));
    const closed = this.collapsed();
    const out: TerritoryRow[] = [];
    let hiddenUnder: string | null = null;
    for (const r of this.rows()) {
      if (hiddenUnder !== null && isUnder(r, hiddenUnder)) continue;
      hiddenUnder = closed.has(r.id) ? r.path : null;
      out.push(r);
    }
    return out;
  });

  /**
   * Estado de cada casilla: 'all' si el nodo y todo lo de abajo está marcado,
   * 'some' si solo una parte. Se calcula de una pasada de hojas a raíz.
   */
  protected readonly checkState = computed(() => {
    const sel = this.selected();
    const total = new Map<string, number>();
    const marked = new Map<string, number>();
    const rows = this.rows();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const t = (total.get(r.id) ?? 0) + 1;
      const m = (marked.get(r.id) ?? 0) + (sel.has(r.id) ? 1 : 0);
      total.set(r.id, t);
      marked.set(r.id, m);
      if (r.parentId) {
        total.set(r.parentId, (total.get(r.parentId) ?? 0) + t);
        marked.set(r.parentId, (marked.get(r.parentId) ?? 0) + m);
      }
    }
    const state = new Map<string, 'all' | 'some' | 'none'>();
    for (const r of rows) {
      const m = marked.get(r.id) ?? 0;
      state.set(r.id, m === 0 ? 'none' : m === total.get(r.id) ? 'all' : 'some');
    }
    return state;
  });

  /**
   * Cuántas inactivas tiene cada nodo debajo (todos los niveles): con el nodo
   * cerrado es lo único que dice que activar o desactivar hizo algo.
   */
  protected readonly inactiveBelow = computed(() => {
    const below = new Map<string, number>();
    const rows = this.rows();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r.parentId) continue;
      const n = (below.get(r.id) ?? 0) + (r.active ? 0 : 1);
      if (n) below.set(r.parentId, (below.get(r.parentId) ?? 0) + n);
    }
    return below;
  });

  protected hasChildren(row: TerritorialUnit): boolean {
    return (row.childCount ?? 0) > 0;
  }

  protected toggleCollapsed(id: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected expandAll(): void {
    this.collapsed.set(new Set());
  }

  /** Deja abierta solo la raíz (el país): se ven las regiones, cerradas. */
  protected collapseAll(): void {
    const rows = this.rows();
    const top = Math.min(...rows.map((r) => r.depth));
    this.collapsed.set(new Set(rows.filter((r) => r.depth > top && this.hasChildren(r)).map((r) => r.id)));
  }

  /** El nodo y todo lo que tiene debajo. */
  private withDescendants(id: string): string[] {
    const node = this.rows().find((r) => r.id === id);
    if (!node) return [id];
    return [id, ...this.rows().filter((r) => isUnder(r, node.path)).map((r) => r.id)];
  }

  async ngOnInit(): Promise<void> {
    await this.setup.loadStatus();
    if (this.nocEnabled()) {
      await this.reload();
    }
  }

  /** Una localidad ubicada en el mapa: se actualiza su fila sin recargar el árbol. */
  protected onPlaced(unit: TerritorialUnit): void {
    this.rows.update((rows) => rows.map((r) => (r.id === unit.id ? { ...r, latitude: unit.latitude, longitude: unit.longitude } : r)));
  }

  protected async reload(): Promise<void> {
    try {
      const { units, meta } = await this.territory.list(1, 5000);
      const first = this.rows().length === 0;
      this.rows.set(units as TerritoryRow[]);
      this.total.set(meta.total);
      if (first) this.collapseAll();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('territory.loadError')));
    }
  }

  protected empty(): ReadonlySet<string> {
    return new Set();
  }

  /** Marcar un nodo marca todo lo de abajo; desmarcarlo (o uno a medias) lo desmarca entero. */
  protected toggleOne(id: string): void {
    this.notice.set(null);
    const on = this.checkState().get(id) !== 'all';
    const ids = this.withDescendants(id);
    this.selected.update((sel) => {
      const next = new Set(sel);
      for (const x of ids) {
        if (on) next.add(x);
        else next.delete(x);
      }
      return next;
    });
  }

  /** Marca o desmarca todas las que se ven (con búsqueda, solo las que coinciden). */
  protected toggleVisible(): void {
    this.notice.set(null);
    const ids = this.visibleRows().flatMap((r) => this.withDescendants(r.id));
    const all = this.allVisibleSelected();
    this.selected.update((sel) => {
      const next = new Set(sel);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  protected async bulk(active: boolean): Promise<void> {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const changed = await this.territory.setActiveMany(ids, active);
      const set = new Set(ids);
      this.rows.update((list) => list.map((u) => (set.has(u.id) ? { ...u, active } : u)));
      this.selected.set(new Set());
      this.notice.set(this.i18n.tf(active ? 'territory.bulkOnDone' : 'territory.bulkOffDone', changed));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('territory.toggleError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleActive(row: TerritoryRow): Promise<void> {
    try {
      const updated = await this.territory.setActive(row.id, !row.active);
      this.rows.update((list) => list.map((u) => (u.id === updated.id ? { ...u, active: updated.active } : u)));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('territory.toggleError')));
    }
  }
}
