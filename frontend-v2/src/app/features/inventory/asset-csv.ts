import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CsvResult, InventoryMeta, InventoryService } from '../../core/inventory/inventory.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/inventory';

/**
 * Carga masiva por CSV (9.2): plantilla por tipo, revisión fila por fila y
 * carga. El archivo solo vive en la memoria de esta pantalla: se manda dos
 * veces (revisión y carga), el servidor no lo guarda, y al terminar se suelta.
 */
@Component({
  selector: 'app-asset-csv',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ac">
      <div class="ac__head">
        <h2 class="adm-card__title"><mat-icon>upload_file</mat-icon>{{ i18n.t('inv.csv.title') }}</h2>
        <span class="adm-push ac__btns">
          <button type="button" class="adm-btn" (click)="api.downloadTemplate(kind())"><mat-icon>download</mat-icon>{{ i18n.t('inv.csv.template') }}</button>
          <button type="button" class="adm-btn" (click)="api.downloadExport(kind())"><mat-icon>download</mat-icon>{{ i18n.t('inv.csv.export') }}</button>
          <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('inv.cancel')" (click)="closed.emit()"><mat-icon>close</mat-icon></button>
        </span>
      </div>
      <div class="ac__body">
        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('inv.csv.kind') }}</span>
          <span class="ac__btns">
            @for (k of kinds(); track k.code) {
              <button type="button" class="seg" [attr.aria-pressed]="kind() === k.code" (click)="setKind(k.code)"><mat-icon>{{ k.icon }}</mat-icon>{{ k.name }}</button>
            }
          </span>
          <span class="adm-hint">{{ i18n.t('inv.csv.kindHint') }}</span>
        </div>
        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('inv.csv.file') }}</span>
          <label class="adm-btn ac__file">
            <mat-icon>description</mat-icon>{{ fileName() || i18n.t('inv.csv.pickFile') }}
            <input type="file" name="csvFile" accept=".csv,text/csv" (change)="pick($event)" />
          </label>
          <span class="adm-hint">{{ i18n.t('inv.csv.formats') }}</span>
          <span class="adm-hint">{{ i18n.t('inv.csv.noFile') }}</span>
        </div>
        @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
        @if (result(); as r) {
          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('inv.csv.review') }}</span>
            <div class="ac__table">
              <div class="ac__row ac__row--head"><span>{{ i18n.t('inv.csv.col.line') }}</span><span>{{ i18n.t('inv.csv.col.code') }}</span><span>{{ i18n.t('inv.csv.col.what') }}</span><span>{{ i18n.t('inv.csv.col.detail') }}</span></div>
              @for (row of r.rows; track row.line) {
                <div class="ac__row">
                  <span class="mono">{{ row.line }}</span>
                  <span class="mono">{{ row.code }}</span>
                  <span><span class="pill" [class]="'tone-' + tone[row.action]">{{ i18n.t(actionKey(row.action)) }}</span></span>
                  <span [class.ac__err]="!!row.error">{{ row.error || row.detail }}</span>
                </div>
              }
            </div>
            <span class="adm-hint">{{ i18n.t('inv.csv.reviewHint') }}</span>
          </div>
          <div class="ac__actions">
            <span class="adm-small">{{ r.applied ? i18n.t('inv.csv.done') : counts(r) }}</span>
            @if (!r.applied) {
              <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || r.created + r.updated === 0" (click)="load()"><mat-icon>done_all</mat-icon>{{ i18n.t('inv.csv.go') }}</button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ac__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .ac__body { display: flex; flex-direction: column; gap: 14px; padding: 12px 16px 16px; }
    .ac__btns { display: flex; flex-wrap: wrap; gap: 6px; }
    .ac__file { position: relative; align-self: flex-start; cursor: pointer; }
    .ac__file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .ac__table { max-height: 360px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    .ac__row { display: grid; grid-template-columns: 48px minmax(0, 0.9fr) 110px minmax(0, 2fr); gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border-subtle); font-size: 12px; }
    .ac__row--head { position: sticky; top: 0; background: var(--bg-surface); color: var(--text-muted); font-size: 10.5px; font-weight: 700; text-transform: uppercase; }
    .ac__err { color: var(--status-critical); }
    .ac__actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
  `,
})
export class AssetCsvComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly api = inject(InventoryService);

  readonly meta = input.required<InventoryMeta>();
  readonly loaded = output<void>();
  readonly closed = output<void>();

  protected readonly kinds = computed(() => this.meta().kinds.filter((k) => k.active));
  protected readonly kind = signal('server');
  protected readonly fileName = signal('');
  protected readonly result = signal<CsvResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly tone: Record<string, string> = { create: 'ok', update: 'info', unchanged: 'neutral', error: 'bad' };
  /** El contenido del archivo: solo en memoria, mientras se revisa y se carga. */
  private content: string | null = null;

  protected actionKey(action: string): MessageKey {
    return `inv.csv.${action}` as MessageKey;
  }

  protected counts(r: CsvResult): string {
    return [`${r.created} ${this.i18n.t('inv.csv.create')}`, `${r.updated} ${this.i18n.t('inv.csv.update')}`, `${r.unchanged} ${this.i18n.t('inv.csv.unchanged')}`, `${r.errors} ${this.i18n.t('inv.csv.error')}`].join(' · ');
  }

  protected setKind(code: string): void {
    this.kind.set(code);
    if (this.content !== null) void this.review();
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.fileName.set(file.name);
    this.content = await file.text();
    await this.review();
  }

  private async review(): Promise<void> {
    if (this.content === null) return;
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      this.result.set(await this.api.importCsv(this.kind(), this.content, true));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async load(): Promise<void> {
    if (this.content === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.result.set(await this.api.importCsv(this.kind(), this.content, false));
      this.content = null; // listo: el archivo se suelta
      this.fileName.set('');
      this.loaded.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
