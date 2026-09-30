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

type TerritoryRow = TerritorialUnit & Record<string, unknown>;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Territorio (Administración → Catálogos, solo con NOC), re-vestido con los
 * componentes del artboard "Administración": nombres de cada nivel, import
 * y el árbol aplanado por path con búsqueda. Activar/desactivar es la
 * corrección más común de un import genérico (HU-TERR-3) y nunca borra.
 */
@Component({
  selector: 'app-admin-territory',
  standalone: true,
  imports: [MatIconModule, DenseTableComponent, TerritorialLabelsFormComponent, TerritoryImportComponent],
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

      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>account_tree</mat-icon>{{ i18n.t('territory.units') }} <span class="mono adm-secondary">{{ total() }}</span></h3>
          <label class="tr__search adm-push">
            <mat-icon>search</mat-icon>
            <input #q type="search" [value]="query()" (input)="query.set(q.value)" [placeholder]="i18n.t('territory.search')" [attr.aria-label]="i18n.t('territory.search')" />
          </label>
        </div>
        @if (error(); as e) { <p class="adm-error tr__error" role="alert">{{ e }}</p> }
        @if (truncated()) {
          <p class="adm-card__note">{{ i18n.tf('territory.truncated', rows().length) }}</p>
        }
        <app-table class="tr__table" [style.height.px]="tableHeight()" [columns]="columns()" [rows]="visibleRows()" trackByKey="id" [emptyMessage]="i18n.t(query() ? 'territory.noMatch' : 'territory.empty')">
          <ng-template #cell let-row let-column="column">
            @switch (column) {
              @case ('name') {
                <span [style.padding-left.px]="query() ? 0 : row.depth * 16" [class.tr__inactive]="!row.active">{{ row.name }}</span>
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
    .tr__error { padding: 10px 14px 0; }
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

  /** Con búsqueda se pierde la sangría del árbol: se ve la lista plana de lo que coincide. */
  protected readonly visibleRows = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return this.rows();
    return this.rows().filter((r) => normalize(r.name).includes(q) || normalize(r.code ?? '').includes(q));
  });

  async ngOnInit(): Promise<void> {
    await this.setup.loadStatus();
    if (this.nocEnabled()) {
      await this.reload();
    }
  }

  protected async reload(): Promise<void> {
    try {
      const { units, meta } = await this.territory.list(1, 5000);
      this.rows.set(units as TerritoryRow[]);
      this.total.set(meta.total);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('territory.loadError')));
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
