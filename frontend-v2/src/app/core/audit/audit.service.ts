import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { downloadFile } from '../download';
import { ApiEnvelope } from '../auth/auth.models';

export type AuditLevel = 'info' | 'warn' | 'error';

export interface AuditRecord {
  id: string;
  timestamp: string;
  event: string;
  level: AuditLevel;
  actorUsername?: string;
  actorRole?: string;
  requestId?: string;
  requestIp?: string;
  requestMethod?: string;
  requestPath?: string;
  userAgent?: string;
  ipChanged: boolean;
  previousIp?: string;
  success: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Filtros de GET /api/audit-logs y /export (spec/04): los mismos en los dos. */
export interface AuditFilter {
  /** Dominios o eventos exactos ("auth" trae auth.login.fail…). Vacío = todos. */
  events?: readonly string[];
  level?: AuditLevel;
  result?: 'ok' | 'fail';
  from?: Date;
  to?: Date;
  q?: string;
}

export interface AuditPage {
  items: AuditRecord[];
  total: number;
}

function toParams(filter: AuditFilter): HttpParams {
  let params = new HttpParams();
  if (filter.events?.length) params = params.set('event', filter.events.join(','));
  if (filter.level) params = params.set('level', filter.level);
  if (filter.result) params = params.set('result', filter.result);
  if (filter.from) params = params.set('from', filter.from.toISOString());
  if (filter.to) params = params.set('to', filter.to.toISOString());
  if (filter.q?.trim()) params = params.set('q', filter.q.trim());
  return params;
}

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);

  async list(filter: AuditFilter, page: number, pageSize: number): Promise<AuditPage> {
    const params = toParams(filter).set('page', page).set('pageSize', pageSize);
    const response = await firstValueFrom(this.http.get<ApiEnvelope<AuditRecord[]>>('/api/audit-logs', { params }));
    const meta = response.meta as { total?: number } | undefined;
    return { items: response.data, total: meta?.total ?? response.data.length };
  }

  /** Descarga autenticada del CSV con exactamente lo filtrado (un <a href> directo respondía 401). */
  exportCsv(filter: AuditFilter): Promise<void> {
    return downloadFile(this.http, '/api/audit-logs/export', 'auditoria.csv', toParams(filter));
  }
}
