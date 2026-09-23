import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DenseTableColumn, DenseTableComponent } from '../../shared/ui/dense-table/dense-table';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';
import { TerritorialLabelsFormComponent } from '../territory/territorial-labels-form';
import { TerritoryImportComponent } from '../territory/territory-import';

type TerritoryRow = TerritorialUnit & Record<string, unknown>;

const COLUMNS: DenseTableColumn[] = [
  { key: 'name', header: 'Nombre' },
  { key: 'kind', header: 'Nivel' },
  { key: 'code', header: 'Código', mono: true },
  { key: 'coords', header: 'Lat / Lng', mono: true },
  { key: 'active', header: 'Estado' },
];

/**
 * Administración de territorio (Fase 5, "importar/ver la lista"): etiquetas
 * por nivel, import y el árbol aplanado por path. La administración fina
 * (editar, mover) queda fuera del alcance de esta fase; activar/desactivar
 * sí, porque es la corrección más común de un import genérico (HU-TERR-3).
 */
@Component({
  selector: 'app-admin-territory',
  standalone: true,
  imports: [DenseTableComponent, TerritorialLabelsFormComponent, TerritoryImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!nocEnabled()) {
      <section class="panel">
        <h2 class="panel__title">Territorio</h2>
        <p class="panel__hint">El módulo NOC está desactivado. Activalo en la pestaña Módulos para administrar territorio.</p>
      </section>
    } @else {
      <section class="panel">
        <h2 class="panel__title">Nombre de cada nivel</h2>
        <p class="panel__hint">Cómo se llama cada nivel en tu país. Solo presentación: no migra datos.</p>
        <app-territorial-labels-form />
      </section>

      <section class="panel">
        <h2 class="panel__title">Importar división administrativa</h2>
        <p class="panel__hint">Reimportar es seguro: actualiza por código, no duplica ni reactiva lo que desactivaste.</p>
        <app-territory-import (imported)="reload()" />
      </section>

      <section class="panel">
        <h2 class="panel__title">
          Unidades territoriales <span class="mono territory__count">{{ total() }}</span>
        </h2>
        @if (error()) {
          <p class="msg msg--error">{{ error() }}</p>
        }
        @if (truncated()) {
          <p class="panel__hint">Mostrando las primeras {{ rows().length }} por orden jerárquico.</p>
        }
        <app-table class="territory__table" [columns]="columns" [rows]="rows()" trackByKey="id"
          emptyMessage="Todavía no hay territorio cargado — importá el seed o un JSON propio.">
          <ng-template #cell let-row let-column="column">
            @switch (column) {
              @case ('name') {
                <span [style.padding-left.px]="row.depth * 16">{{ row.name }}</span>
              }
              @case ('kind') {
                {{ territory.kindLabel(row.kind) }}
              }
              @case ('coords') {
                {{ row.latitude ?? '—' }} / {{ row.longitude ?? '—' }}
              }
              @case ('active') {
                <button type="button" class="territory__toggle" (click)="toggleActive(row)"
                  [title]="row.active ? 'Desactivar (no borra historial)' : 'Reactivar'">
                  <span class="state" [class.state--on]="row.active" [class.state--off]="!row.active">
                    {{ row.active ? 'ACTIVA' : 'INACTIVA' }}
                  </span>
                </button>
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
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .territory__count {
      margin-left: 6px;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .territory__table {
      display: block;
      height: 540px;
    }
    .territory__toggle {
      padding: 2px 6px;
      background: none;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .territory__toggle:hover {
      border-color: var(--border-subtle);
    }
  `,
})
export class AdminTerritoryComponent implements OnInit {
  protected readonly columns = COLUMNS;
  protected readonly rows = signal<TerritoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly truncated = computed(() => this.total() > this.rows().length);
  protected readonly nocEnabled = computed(() => this.setup.status()?.nocEnabled ?? false);

  protected readonly territory = inject(TerritoryService);
  private readonly setup = inject(SetupService);

  async ngOnInit(): Promise<void> {
    await this.setup.loadStatus();
    if (this.nocEnabled()) {
      await this.reload();
    }
  }

  protected async reload(): Promise<void> {
    this.error.set(null);
    try {
      const { units, meta } = await this.territory.list(1, 5000);
      this.rows.set(units as TerritoryRow[]);
      this.total.set(meta.total);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo cargar el territorio.'));
    }
  }

  protected async toggleActive(row: TerritoryRow): Promise<void> {
    try {
      const updated = await this.territory.setActive(row.id, !row.active);
      this.rows.update((list) => list.map((u) => (u.id === updated.id ? { ...u, active: updated.active } : u)));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo cambiar el estado.'));
    }
  }
}
