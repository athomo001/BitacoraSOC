import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { downloadFile } from '../download';

export type TriggerSource = 'manual' | 'auto' | 'upload' | 'pre_restore';
export type DestinationType = 'local' | 'smb' | 'nfs';
export type RestoreMode = 'merge' | 'replace';
export type DeltaWindow = '6h' | '12h' | '24h' | '3d' | '7d';
export type CsvExport = 'entries' | 'checklists' | 'tickets' | 'all';

export interface BackupRun {
  id: string;
  kind: 'full' | 'delta';
  triggerSource: TriggerSource;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  recordsCount: number;
  fileSizeBytes: number | null;
  checksumSha256: string | null;
  errorMessage: string | null;
  /** Se hizo con frase: hay que escribirla para abrirlo. Sin frase lo abre esta instalación sola. */
  needsPassphrase: boolean;
}

export interface BackupConfig {
  enabled: boolean;
  intervalDays: number;
  runAt: string;
  timezone: string;
  retentionDays: number;
  destinationType: DestinationType;
  destinationPath: string | null;
  passphraseSet: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'failed';
  lastMessage: string | null;
}

export interface BackupConfigUpdate {
  enabled: boolean;
  intervalDays: number;
  runAt: string;
  timezone: string;
  retentionDays: number;
  destinationType: DestinationType;
  destinationPath: string;
  /** Vacía = conservar la guardada. */
  passphrase: string;
}

export interface RestoreResult {
  mode: RestoreMode;
  inserted: number;
  alreadyThere: number;
  tables: number;
  safetyBackupId?: string;
}

export interface ValidationResult { valid: boolean; checksumMatches: boolean; decryptable: boolean; tables?: number; }

@Injectable({ providedIn: 'root' })
export class BackupsService {
  private readonly http = inject(HttpClient);

  async history(): Promise<BackupRun[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ items: BackupRun[] }>>('/api/backups/history'))).data.items;
  }

  async config(): Promise<BackupConfig> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<BackupConfig>>('/api/backups/config'))).data;
  }

  async saveConfig(update: BackupConfigUpdate): Promise<BackupConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<BackupConfig>>('/api/backups/config', update))).data;
  }

  /** "Ejecutar prueba ahora": corre la copia automática y devuelve cómo terminó. */
  async runNow(): Promise<BackupConfig> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<BackupConfig>>('/api/backups/config/run', {}))).data;
  }

  async create(passphrase: string): Promise<BackupRun> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<BackupRun>>('/api/backups/create', { passphrase }))).data;
  }

  async upload(file: File, passphrase: string): Promise<BackupRun> {
    const form = new FormData();
    form.append('file', file);
    form.append('passphrase', passphrase);
    return (await firstValueFrom(this.http.post<ApiEnvelope<BackupRun>>('/api/backups/upload', form))).data;
  }

  async restore(id: string, passphrase: string, mode: RestoreMode, confirmation: string): Promise<RestoreResult> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<RestoreResult>>(`/api/backups/${id}/restore`, { passphrase, mode, confirmation }))).data;
  }

  async validate(id: string, passphrase: string): Promise<ValidationResult> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ValidationResult>>(`/api/backups/${id}/validate`, { passphrase }))).data;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/backups/${id}`));
  }

  /** Descarga autenticada (un <a href> directo respondía 401). */
  download(id: string): Promise<void> {
    return downloadFile(this.http, `/api/backups/${id}/download`, `backup-${id}.enc`);
  }

  exportCsv(kind: CsvExport): Promise<void> {
    return downloadFile(this.http, `/api/backups/export?kind=${kind}`, kind === 'all' ? 'bitacora.zip' : `${kind}.csv`);
  }

  /** Genera el delta y lo descarga enseguida (sirve para llevarlo a otro servidor). */
  async exportDelta(window: DeltaWindow, passphrase: string): Promise<void> {
    const run = (await firstValueFrom(this.http.post<ApiEnvelope<{ backupRunId: string }>>('/api/backups/export-delta', { timeWindowPreset: window, passphrase }))).data;
    await this.download(run.backupRunId);
  }

  async importDelta(file: File, passphrase: string): Promise<{ importedRecords: number }> {
    const form = new FormData();
    form.append('file', file);
    form.append('passphrase', passphrase);
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ importedRecords: number }>>('/api/backups/import-delta', form))).data;
  }

  async purge(confirmation: string): Promise<{ purgedTables: number; adminRecreated: boolean }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ purgedTables: number; adminRecreated: boolean }>>('/api/backups/purge', { confirmation }))).data;
  }
}
