import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface AuditRecord { timestamp: string; event: string; level: string; actorUsername?: string; success: boolean; reason?: string; metadata?: Record<string, unknown>; }

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);
  async list(): Promise<{ items: AuditRecord[]; total: number }> { const response = await firstValueFrom(this.http.get<ApiEnvelope<AuditRecord[]>>('/api/audit-logs')); return { items: response.data, total: response.data.length }; }
  exportUrl(): string { return '/api/audit-logs/export'; }
}