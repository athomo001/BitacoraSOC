import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { ButtonComponent } from '../../shared/ui/button/button';
import { TerritoryService } from '../../core/territory/territory.service';
import { ImportResult } from '../../core/territory/territory.models';
import { problemDetail } from '../../core/http-error';

/**
 * Carga la división administrativa desde JSON anidado (HU-TERR-2): el seed
 * de Chile que trae el proyecto, o el archivo propio de otro país. Reimportar
 * es seguro (upsert por code) y un error en una rama no tumba el resto — el
 * resultado muestra ambos conteos y cada rama omitida.
 */
@Component({
  selector: 'app-territory-import',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions import-actions">
      <app-button variant="primary" icon="flag" [disabled]="busy()" (pressed)="importChileSeed()">
        Cargar seed de Chile incluido
      </app-button>
      <label class="file-button" [class.file-button--disabled]="busy()">
        <input type="file" accept=".json,application/json" [disabled]="busy()" (change)="importFile($event)" />
        Subir JSON de otro país…
      </label>
      <app-button variant="text" icon="download" [disabled]="busy()" (pressed)="downloadTemplate()">
        Descargar plantilla
      </app-button>
    </div>

    @if (busy()) {
      <p class="msg">Importando…</p>
    }
    @if (error()) {
      <p class="msg msg--error">{{ error() }}</p>
    }
    @if (result(); as r) {
      <p class="msg" [class.msg--ok]="r.errors.length === 0">
        <span class="mono">{{ r.importedCount }}</span> nuevas ·
        <span class="mono">{{ r.updatedCount }}</span> actualizadas ·
        <span class="mono">{{ r.errors.length }}</span> con error
      </p>
      @if (r.errors.length > 0) {
        <ul class="import-errors">
          @for (e of r.errors; track e.code) {
            <li><span class="mono">{{ e.code || '(sin code)' }}</span> — {{ e.reason }}</li>
          }
        </ul>
      }
    }
    <p class="panel__hint attribution">
      Seed de Chile derivado de countries-states-cities-database (dr5hn), licencia ODbL v1.0.
      Trae regiones y ciudades principales, no todas las comunas: lo que falte se agrega a mano.
    </p>
  `,
  styles: `
    .import-actions {
      margin-top: 0;
      align-items: center;
    }
    .file-button {
      display: inline-flex;
      align-items: center;
      min-height: var(--row-height);
      padding: 0 14px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 14px;
      cursor: pointer;
    }
    .file-button:hover {
      background: var(--bg-surface-hover);
    }
    .file-button--disabled {
      opacity: 0.6;
      pointer-events: none;
    }
    .file-button input {
      display: none;
    }
    .import-errors {
      max-height: 160px;
      margin: 4px 0 0;
      padding-left: 18px;
      overflow-y: auto;
      font-size: 12px;
      color: var(--status-warning);
    }
    .attribution {
      margin: 12px 0 0;
    }
  `,
})
export class TerritoryImportComponent {
  readonly imported = output<ImportResult>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<ImportResult | null>(null);

  private readonly territory = inject(TerritoryService);

  protected async importChileSeed(): Promise<void> {
    await this.run(() => this.territory.fetchChileSeed());
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a subir el mismo archivo corregido
    if (file) {
      await this.run(() => file.text());
    }
  }

  protected async downloadTemplate(): Promise<void> {
    this.error.set(null);
    try {
      const json = await this.territory.fetchTemplate();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'territorial_units_template.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo descargar la plantilla.'));
    }
  }

  private async run(readJson: () => Promise<string>): Promise<void> {
    this.error.set(null);
    this.result.set(null);
    this.busy.set(true);
    try {
      const result = await this.territory.importTree(await readJson());
      this.result.set(result);
      this.imported.emit(result);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo importar el archivo.'));
    } finally {
      this.busy.set(false);
    }
  }
}
