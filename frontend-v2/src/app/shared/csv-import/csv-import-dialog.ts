import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ImportKind, ImportResult, ImportsService } from '../../core/imports/imports.service';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/imports';

export interface CsvImportData {
  kind: ImportKind;
}

/**
 * Carga masiva por CSV (10g), el mismo flujo que la del Inventario: plantilla,
 * revisión fila por fila y carga. El archivo solo vive en la memoria de este
 * diálogo: se manda dos veces (revisión y carga), el servidor no lo guarda.
 * Cierra con `true` si se cargó algo, para que la pantalla recargue.
 */
@Component({
  selector: 'app-csv-import-dialog',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './csv-import-dialog.html',
  styleUrl: './csv-import-dialog.css',
})
export class CsvImportDialogComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly api = inject(ImportsService);
  protected readonly data = inject<CsvImportData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly modules = inject(ModuleAccessService);

  protected readonly fileName = signal('');
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly tone: Record<string, string> = { create: 'ok', update: 'info', unchanged: 'neutral', error: 'bad' };
  protected readonly secrets = computed(() => (this.result()?.rows ?? []).filter((r) => r.secret));
  /** Solo los destinos y columnas de los módulos encendidos. */
  protected readonly hints = computed<string[]>(() => {
    const soc = this.modules.soc();
    switch (this.data.kind) {
      case 'organizations':
        return [this.i18n.t('csvImport.formats.organizations'), ...(soc ? [this.i18n.t('csvImport.formats.services')] : [])];
      case 'windows': {
        const targets = ['cliente:MUNDO', 'area:SOC', 'equipo:Redes', ...(soc ? ['servicio:FW-MUNDO'] : []), ...(this.modules.noc() ? ['activo:srv-01', 'zona:RM'] : [])];
        return [this.i18n.tf('csvImport.formats.windows', targets.join(', '))];
      }
      case 'entries':
        return [this.i18n.t('csvImport.formats.entries'), ...(soc ? [this.i18n.t('csvImport.formats.entriesService')] : [])];
      default:
        return [this.i18n.t('csvImport.formats.users')];
    }
  });
  private loaded = false;
  /** El contenido del archivo: solo en memoria, mientras se revisa y se carga. */
  private content: string | null = null;

  async ngOnInit(): Promise<void> {
    await this.modules.load();
  }

  protected title(): string {
    return this.i18n.t(`csvImport.title.${this.data.kind}` as MessageKey);
  }

  protected reviewHint(): string {
    return this.i18n.t(`csvImport.reviewHint.${this.data.kind}` as MessageKey);
  }

  protected actionKey(action: string): MessageKey {
    return `csvImport.${action}` as MessageKey;
  }

  protected counts(r: ImportResult): string {
    return [`${r.created} ${this.i18n.t('csvImport.create')}`, `${r.updated} ${this.i18n.t('csvImport.update')}`, `${r.unchanged} ${this.i18n.t('csvImport.unchanged')}`, `${r.errors} ${this.i18n.t('csvImport.error')}`].join(' · ');
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.fileName.set(file.name);
    this.content = await file.text();
    await this.send(true);
  }

  protected async load(): Promise<void> {
    await this.send(false);
  }

  private async send(dryRun: boolean): Promise<void> {
    if (this.content === null) return;
    this.busy.set(true);
    this.error.set(null);
    if (dryRun) this.result.set(null);
    try {
      const result = await this.api.run(this.data.kind, this.content, dryRun);
      this.result.set(result);
      if (!dryRun) {
        this.content = null; // listo: el archivo se suelta
        this.fileName.set('');
        this.loaded = result.created + result.updated > 0;
      }
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('csvImport.loadError')));
    } finally {
      this.busy.set(false);
    }
  }

  /** Las contraseñas temporales en un CSV que arma el navegador (no pasan otra vez por el servidor). */
  protected downloadSecrets(): void {
    const lines = ['usuario;contraseña_temporal', ...this.secrets().map((r) => `${r.code};${r.secret}`)];
    const href = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = 'contraseñas-temporales.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  protected close(): void {
    this.ref.close(this.loaded);
  }
}
