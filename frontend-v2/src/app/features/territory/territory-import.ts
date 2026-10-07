import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { ImportResult } from '../../core/territory/territory.models';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/territory';
/**
 * Carga la división administrativa desde JSON anidado (HU-TERR-2): el seed
 * de Chile que trae el proyecto, o el archivo propio de otro país. Reimportar
 * es seguro (upsert por code) y un error en una rama no tumba el resto — el
 * resultado muestra ambos conteos y cada rama omitida.
 */
@Component({
  selector: 'app-territory-import',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ti__actions">
      <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy()" (click)="importChileSeed()"><mat-icon>flag</mat-icon>{{ i18n.t('territory.importChile') }}</button>
      <label class="adm-btn ti__file" [class.ti__file--disabled]="busy()">
        <input type="file" accept=".json,application/json" [disabled]="busy()" (change)="importFile($event)" />
        <mat-icon>upload_file</mat-icon>{{ i18n.t('territory.importFile') }}
      </label>
      <button type="button" class="adm-btn" [disabled]="busy()" (click)="downloadTemplate()"><mat-icon>download</mat-icon>{{ i18n.t('territory.template') }}</button>
    </div>

    @if (busy()) {
      <p class="adm-muted" role="status">{{ i18n.t('territory.importing') }}</p>
    }
    @if (error(); as e) {
      <p class="adm-error" role="alert">{{ e }}</p>
    }
    @if (result(); as r) {
      <p class="ti__result">
        <span class="pill" [class]="r.errors.length ? 'tone-warn' : 'tone-ok'"><mat-icon>{{ r.errors.length ? 'warning_amber' : 'task_alt' }}</mat-icon>{{ i18n.t('territory.imported') }}</span>
        <span><span class="mono">{{ r.importedCount }}</span> {{ i18n.t('territory.new') }} · <span class="mono">{{ r.updatedCount }}</span> {{ i18n.t('territory.updated') }} · <span class="mono">{{ r.errors.length }}</span> {{ i18n.t('territory.withError') }}</span>
      </p>
      @if (r.errors.length > 0) {
        <ul class="ti__errors">
          @for (e of r.errors; track e.code) {
            <li><span class="mono">{{ e.code || i18n.t('territory.noCode') }}</span> — {{ e.reason }}</li>
          }
        </ul>
      }
    }
    <p class="adm-hint">{{ i18n.t('territory.attribution') }}</p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ti__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .ti__file input { display: none; }
    .ti__file--disabled { opacity: 0.5; pointer-events: none; }
    .ti__result { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: 12px; }
    .ti__errors { max-height: 160px; margin: 0; padding-left: 18px; overflow-y: auto; color: var(--status-warning); font-size: 11.5px; }
  `,
})
export class TerritoryImportComponent {
  readonly imported = output<ImportResult>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<ImportResult | null>(null);

  protected readonly i18n = inject(I18nService);
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
      this.error.set(problemDetail(error, this.i18n.t('territory.templateError')));
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
      this.error.set(problemDetail(error, this.i18n.t('territory.importError')));
    } finally {
      this.busy.set(false);
    }
  }
}
