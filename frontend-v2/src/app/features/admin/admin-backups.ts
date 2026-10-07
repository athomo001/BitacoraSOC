import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { AuthService } from '../../core/auth/auth.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import {
  BackupConfig, BackupRun, BackupsService, CsvExport, DeltaWindow, DestinationType, RestoreMode,
} from '../../core/backups/backups.service';
import { formatCount, formatSize, runKind } from '../../core/backups/backup-view';

import '../../core/i18n/packs/admin';
type RowPanel = { id: string; action: 'restore' | 'validate' | 'delete' };
type Feedback = { ok: boolean; text: string };

const DELTA_WINDOWS: readonly { value: DeltaWindow; label: string }[] = [
  { value: '6h', label: '6 h' }, { value: '12h', label: '12 h' }, { value: '24h', label: '24 h' }, { value: '3d', label: '3 d' }, { value: '7d', label: '7 d' },
];

/**
 * Administración → Respaldos (Fase 13), artboard aprobado: la estructura del
 * legacy (automáticos + historial a la izquierda; acciones de datos + zona de
 * peligro a la derecha) con las mejoras del rewrite: cifrado, zstd-19, foto
 * consistente, validar integridad, delta operativo, respaldo de seguridad
 * antes de "Reemplazar todo" y la purga detrás de "Permitir purga".
 */
@Component({
  selector: 'app-admin-backups',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-backups.html',
  styleUrl: './admin-backups.css',
})
export class AdminBackupsComponent implements OnInit {
  /** Lleva a Administración → Funcionalidades (para "Permitir purga"). */
  readonly goToFeatures = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(BackupsService);
  private readonly auth = inject(AuthService);
  private readonly features = inject(SystemFeaturesService);

  protected readonly runs = signal<BackupRun[]>([]);
  protected readonly config = signal<BackupConfig | null>(null);
  protected readonly busy = signal(false);
  protected readonly feedback = signal<Feedback | null>(null);
  protected readonly configFeedback = signal<Feedback | null>(null);
  protected readonly restoreMode = signal<RestoreMode>('merge');
  protected readonly panel = signal<RowPanel | null>(null);
  protected readonly validated = signal<Record<string, boolean>>({});
  protected readonly deltaWindow = signal<DeltaWindow>('24h');
  protected readonly deltaWindows = DELTA_WINDOWS;
  protected readonly purgeAllowed = computed(() => this.features.isEnabled('allow_purge'));
  protected readonly purged = signal(false);

  // Formulario de automáticos (se copia de la config al cargar).
  protected autoEnabled = false;
  protected intervalDays = 1;
  protected runAt = '03:00';
  protected retentionDays = 30;
  protected destinationType: DestinationType = 'local';
  protected destinationPath = '';
  protected autoPassphrase = '';

  protected passphrase = '';
  /** Arrastrando un archivo sobre la zona de subida. */
  protected readonly dragging = signal(false);

  /** La frase es opcional; si se escribe, mínimo 8 caracteres. */
  protected passphraseOk(): boolean {
    return this.passphrase === '' || this.passphrase.length >= 8;
  }
  protected rowPassphrase = '';
  protected rowConfirmation = '';
  protected purgePhrase = '';

  protected readonly formatSize = formatSize;
  protected readonly formatCount = formatCount;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadRuns(), this.loadConfig(), this.features.list().catch(() => undefined)]);
  }

  private async loadRuns(): Promise<void> {
    try {
      this.runs.set(await this.api.history());
    } catch (error) {
      this.feedback.set({ ok: false, text: problemDetail(error, this.i18n.t('backups.error.load')) });
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      this.applyConfig(await this.api.config());
    } catch (error) {
      this.configFeedback.set({ ok: false, text: problemDetail(error, this.i18n.t('backups.error.load')) });
    }
  }

  private applyConfig(cfg: BackupConfig): void {
    this.config.set(cfg);
    this.autoEnabled = cfg.enabled;
    this.intervalDays = cfg.intervalDays;
    this.runAt = cfg.runAt;
    this.retentionDays = cfg.retentionDays;
    this.destinationType = cfg.destinationType;
    this.destinationPath = cfg.destinationPath ?? '';
    this.autoPassphrase = '';
  }

  protected kind(run: BackupRun) {
    return runKind(run);
  }

  protected statusKey(cfg: BackupConfig): MessageKey {
    return `backups.auto.status.${cfg.lastStatus}` as MessageKey;
  }

  protected statusTone(cfg: BackupConfig): string {
    return { idle: 'neutral', running: 'info', success: 'ok', failed: 'bad' }[cfg.lastStatus];
  }

  protected integrity(run: BackupRun): { key: MessageKey; tone: string; icon: string } {
    const checked = this.validated()[run.id];
    if (checked === true) return { key: 'backups.integrity.ok', tone: 'ok', icon: 'verified' };
    if (checked === false) return { key: 'backups.integrity.bad', tone: 'bad', icon: 'error' };
    return { key: 'backups.integrity.unchecked', tone: 'neutral', icon: 'help_outline' };
  }

  protected openPanel(run: BackupRun, action: RowPanel['action']): void {
    const current = this.panel();
    this.panel.set(current?.id === run.id && current.action === action ? null : { id: run.id, action });
    this.rowPassphrase = this.passphrase;
    this.rowConfirmation = '';
    this.feedback.set(null);
  }

  // ===== Automáticos =====

  protected async saveConfig(): Promise<void> {
    await this.runConfig(async () => {
      this.applyConfig(await this.api.saveConfig({
        enabled: this.autoEnabled, intervalDays: Number(this.intervalDays), runAt: this.runAt, timezone: this.config()?.timezone ?? 'America/Santiago',
        retentionDays: Number(this.retentionDays), destinationType: this.destinationType, destinationPath: this.destinationPath, passphrase: this.autoPassphrase,
      }));
      this.configFeedback.set({ ok: true, text: this.i18n.t('backups.auto.saved') });
    });
  }

  protected async runNow(): Promise<void> {
    await this.runConfig(async () => {
      const cfg = await this.api.runNow();
      this.applyConfig(cfg);
      this.configFeedback.set({ ok: cfg.lastStatus === 'success', text: cfg.lastMessage ?? this.i18n.t(this.statusKey(cfg)) });
      await this.loadRuns();
    });
  }

  private async runConfig(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.configFeedback.set(null);
    try {
      await action();
    } catch (error) {
      this.configFeedback.set({ ok: false, text: problemDetail(error, this.i18n.t('backups.error.action')) });
    } finally {
      this.busy.set(false);
    }
  }

  // ===== Historial =====

  protected async validate(run: BackupRun): Promise<void> {
    await this.act(async () => {
      const result = await this.api.validate(run.id, this.rowPassphrase);
      this.validated.update((v) => ({ ...v, [run.id]: result.valid }));
      this.panel.set(null);
    });
  }

  protected async restore(run: BackupRun): Promise<void> {
    const mode = this.restoreMode();
    await this.act(async () => {
      const result = await this.api.restore(run.id, this.rowPassphrase, mode, this.rowConfirmation);
      this.panel.set(null);
      await this.loadRuns();
      return mode === 'replace' ? this.i18n.t('backups.restore.replaced') : this.i18n.tf('backups.restore.merged', formatCount(result.inserted));
    });
  }

  protected async remove(run: BackupRun): Promise<void> {
    await this.act(async () => {
      await this.api.remove(run.id);
      this.panel.set(null);
      this.runs.update((list) => list.filter((r) => r.id !== run.id));
    });
  }

  protected async download(run: BackupRun): Promise<void> {
    await this.act(() => this.api.download(run.id));
  }

  // ===== Acciones de datos =====

  protected async createNow(): Promise<void> {
    await this.act(async () => {
      const run = await this.api.create(this.passphrase);
      await this.loadRuns();
      return this.i18n.tf('backups.manual.created', formatCount(run.recordsCount));
    });
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.uploadFile(file);
  }

  /** Soltar un archivo sobre la zona de subida. */
  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && !this.busy() && this.passphraseOk()) await this.uploadFile(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  private async uploadFile(file: File): Promise<void> {
    await this.act(async () => {
      await this.api.upload(file, this.passphrase);
      await this.loadRuns();
      return this.i18n.t('backups.upload.done');
    });
  }

  protected async exportDelta(): Promise<void> {
    await this.act(async () => {
      await this.api.exportDelta(this.deltaWindow(), this.passphrase);
      await this.loadRuns();
    });
  }

  protected async importDelta(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.act(async () => {
      const result = await this.api.importDelta(file, this.passphrase);
      return this.i18n.tf('backups.delta.imported', formatCount(result.importedRecords));
    });
  }

  protected async exportCsv(kind: CsvExport): Promise<void> {
    await this.act(() => this.api.exportCsv(kind));
  }

  // ===== Purga =====

  protected async purge(): Promise<void> {
    if (this.purgePhrase !== 'PURGAR TODO') return;
    await this.act(async () => {
      await this.api.purge(this.purgePhrase);
      this.purged.set(true);
      // Los datos (incluido este usuario) ya no existen: se cierra la sesión.
      setTimeout(() => void this.auth.logout(), 3000);
      return this.i18n.t('backups.danger.done');
    });
  }

  /** Ejecuta una acción del panel mostrando el resultado arriba del historial. */
  private async act(action: () => Promise<string | void>): Promise<void> {
    this.busy.set(true);
    this.feedback.set(null);
    try {
      const message = await action();
      if (message) this.feedback.set({ ok: true, text: message });
    } catch (error) {
      this.feedback.set({ ok: false, text: problemDetail(error, this.i18n.t('backups.error.action')) });
    } finally {
      this.busy.set(false);
    }
  }
}
