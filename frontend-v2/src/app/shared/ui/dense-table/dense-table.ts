import { ChangeDetectionStrategy, Component, TemplateRef, contentChild, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';

export interface DenseTableColumn {
  key: string;
  header: string;
  /** IPs/timestamps/IDs de circuito van monoespaciados — regla 1.2. */
  mono?: boolean;
}

/**
 * Tabla densa con scroll virtual real (CDK `cdk-virtual-scroll-viewport`,
 * spec/06-frontend-arquitectura-y-ui.md sección 7: "DenseTableComponent
 * (Renderizado virtual)") — 15-20 filas visibles sin scroll en 1080p (regla
 * 1.2), pero soporta miles de filas sin degradar el DOM. OCP: columnas
 * personalizadas se inyectan vía `ng-template` con `let-row`, sin tocar el
 * código fuente de la tabla base.
 */
@Component({
  selector: 'app-table',
  standalone: true,
  imports: [ScrollingModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-table">
      <div class="app-table__header" role="row">
        @for (col of columns(); track col.key) {
          <div class="app-table__cell app-table__cell--header" role="columnheader">
            {{ col.header }}
          </div>
        }
      </div>
      <cdk-virtual-scroll-viewport [itemSize]="rowHeight()" class="app-table__viewport">
        <div
          *cdkVirtualFor="let row of rows(); trackBy: trackByFn()"
          class="app-table__row"
          role="row"
        >
          @for (col of columns(); track col.key) {
            <div
              class="app-table__cell"
              [class.mono]="col.mono"
              role="cell"
            >
              @if (cellTemplate()) {
                <ng-container
                  [ngTemplateOutlet]="cellTemplate()!"
                  [ngTemplateOutletContext]="{ $implicit: row, column: col.key }"
                />
              } @else {
                {{ row[col.key] }}
              }
            </div>
          }
        </div>
      </cdk-virtual-scroll-viewport>
      @if (rows().length === 0) {
        <div class="app-table__empty">{{ emptyMessage() }}</div>
      }
    </div>
  `,
  styleUrl: './dense-table.css',
})
export class DenseTableComponent<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly columns = input.required<DenseTableColumn[]>();
  readonly rows = input<T[]>([]);
  readonly rowHeight = input(36); // var(--row-height), CDK necesita el número en TS
  readonly emptyMessage = input('Sin datos para mostrar.');
  readonly trackByKey = input<string | undefined>(undefined);

  readonly cellTemplate = contentChild<TemplateRef<unknown>>('cell');

  protected trackByFn() {
    const key = this.trackByKey();
    return key ? (_: number, row: T) => row[key] : (index: number) => index;
  }
}
