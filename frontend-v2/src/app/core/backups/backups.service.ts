import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface BackupRun { id: string; kind: 'full' | 'delta'; status: string; records_count: number; file_size_bytes?: number; checksum_sha256?: string; started_at: string; finished_at?: string; }

@Injectable({ providedIn: 'root' })
export class BackupsService {
  private readonly http = inject(HttpClient);
  async history(): Promise<{ items: BackupRun[]; total: number }> { const data = (await firstValueFrom(this.http.get<ApiEnvelope<{ items?: BackupRun[]; total?: number }>>('/api/backups/history'))).data; return { items: data?.items ?? [], total: data?.total ?? 0 }; }
  async create(passphrase: string): Promise<unknown> { return (await firstValueFrom(this.http.post<ApiEnvelope<unknown>>('/api/backups/create', { passphrase }))).data; }
  async remove(id: string): Promise<void> { await firstValueFrom(this.http.delete(`/api/backups/${id}`)); }
  downloadUrl(id: string): string { return `/api/backups/${id}/download`; }
}