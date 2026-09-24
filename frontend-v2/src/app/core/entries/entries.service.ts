import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export type EntryType = 'operativa' | 'incidente' | 'ofensa';
export type EntryScope = 'soc' | 'noc' | 'general';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  operativa: 'Operativa',
  incidente: 'Incidente',
  ofensa: 'Ofensa',
};

export const ENTRY_SCOPE_LABELS: Record<EntryScope, string> = {
  soc: 'SOC',
  noc: 'NOC',
  general: 'General',
};

export interface Entry {
  id: string;
  authorUsername: string;
  entryType: EntryType;
  scope: EntryScope;
  content: string;
  tags: string[];
  serviceId?: string;
  assetId?: string;
  imageUrl?: string;
  imageHash?: string;
  imageSizeBytes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntryComment {
  id: string;
  entryId: string;
  authorUsername: string;
  comment: string;
  isSystemGenerated: boolean;
  createdAt: string;
}

export interface EntryDetail extends Entry {
  comments: EntryComment[];
}

export interface EntryFilters {
  scope?: EntryScope;
  type?: EntryType;
  tag?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

function filterParams(f: EntryFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.scope) params['scope'] = f.scope;
  if (f.type) params['type'] = f.type;
  if (f.tag) params['tag'] = f.tag;
  if (f.from) params['from'] = f.from;
  if (f.to) params['to'] = f.to;
  if (f.q) params['q'] = f.q;
  if (f.page) params['page'] = String(f.page);
  if (f.pageSize) params['pageSize'] = String(f.pageSize);
  return params;
}

export interface UploadImageResult {
  imageUrl: string;
  imageHash: string;
  sizeBytes: number;
}

/** Bitácora — registro operativo central (Fase 9). */
@Injectable({ providedIn: 'root' })
export class EntriesService {
  private readonly http = inject(HttpClient);

  async list(filters: EntryFilters = {}): Promise<{ items: Entry[]; total: number }> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ items: Entry[]; total: number }>>('/api/entries', { params: filterParams(filters) }))).data;
  }

  async get(id: string): Promise<EntryDetail> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<EntryDetail>>(`/api/entries/${id}`))).data;
  }

  async create(entry: { entryType: EntryType; scope?: EntryScope; content: string; tags?: string[]; serviceId?: string; assetId?: string; imageUrl?: string }): Promise<Entry> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Entry>>('/api/entries', entry))).data;
  }

  async patch(id: string, patch: Partial<{ scope: EntryScope; content: string; tags: string[]; serviceId: string; assetId: string }>): Promise<Entry> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Entry>>(`/api/entries/${id}`, patch))).data;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/entries/${id}`));
  }

  async bulkPatch(entryIds: string[], patch: { scope?: EntryScope; tags?: string[] }): Promise<{ updatedCount: number }> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<{ updatedCount: number }>>('/api/entries/bulk', { entryIds, ...patch }))).data;
  }

  async addComment(entryId: string, comment: string): Promise<EntryComment> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<EntryComment>>(`/api/entries/${entryId}/comments`, { comment }))).data;
  }

  /** Sin conversión a WebP ni limpieza EXIF (versión simple de esta fase, ver spec/00-mapa-mental.md). */
  async uploadImage(file: File): Promise<UploadImageResult> {
    const form = new FormData();
    form.append('image', file);
    return (await firstValueFrom(this.http.post<ApiEnvelope<UploadImageResult>>('/api/entries/upload-image', form))).data;
  }

  exportUrl(filters: EntryFilters = {}): string {
    const params = new URLSearchParams(filterParams(filters));
    const query = params.toString();
    return query ? `/api/entries/export?${query}` : '/api/entries/export';
  }
}
