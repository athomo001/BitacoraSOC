import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface AuditRecord { timestamp: string; event: string; level: string; actorUsername?: string; success: boolean; reason?: string; metadata?: Record<string, unknown>; }

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);
  async list(): Promise<{ items: AuditRecord[]; total: number }> { const response = await firstValueFrom(this.http.get<ApiEnvelope<AuditRecord[] | { items?: AuditRecord[]; total?: number }>>('/api/audit-logs')); const raw = response.data; const items = Array.isArray(raw) ? raw : raw?.items ?? []; const nestedTotal = Array.isArray(raw) ? undefined : raw?.total; const meta = response.meta as { total?: number } | undefined; return { items, total: meta?.total ?? nestedTotal ?? items.length }; }
  exportUrl(): string { return '/api/audit-logs/export'; }
}