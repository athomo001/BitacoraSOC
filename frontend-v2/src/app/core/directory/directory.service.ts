import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { PageMeta } from '../territory/territory.models';

export type ChannelType = 'call' | 'whatsapp' | 'sms' | 'email' | 'other';

export interface ContactChannel {
  id: string;
  channelType: ChannelType;
  value: string;
  label?: string;
  preferred: boolean;
}

export interface DirectoryContact {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationType: string;
  name: string;
  position?: string;
  specialty?: string;
  scope: 'internal' | 'external';
  source: 'manual' | 'user_sync' | 'csv_import';
  isFavorite: boolean;
  email: string;
  phone: string;
  notes?: string;
  channels: ContactChannel[];
}

export interface ContactForm {
  organizationId: string;
  name: string;
  position: string;
  specialty: string;
  scope: 'internal' | 'external';
  isFavorite: boolean;
  email: string;
  phone: string;
}

export interface DirectoryFilters {
  q?: string;
  organizationId?: string;
  scope?: string;
  favorite?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ImportCsvResult {
  importedCount: number;
  updatedCount: number;
  errors: { line: number; reason: string }[];
}

/** /api/directory/* — Directorio Global (HU-DIR-1/2). */
@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private readonly http = inject(HttpClient);

  async list(filters: DirectoryFilters): Promise<{ contacts: DirectoryContact[]; meta: PageMeta }> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '' && value !== null) {
        params[key] = String(value);
      }
    }
    const res = await firstValueFrom(this.http.get<ApiEnvelope<DirectoryContact[]>>('/api/directory', { params }));
    return { contacts: res.data, meta: res.meta as PageMeta };
  }

  async search(q: string): Promise<DirectoryContact[]> {
    const res = await firstValueFrom(this.http.get<ApiEnvelope<DirectoryContact[]>>('/api/directory/search', { params: { q } }));
    return res.data;
  }

  async create(form: ContactForm): Promise<DirectoryContact> {
    const res = await firstValueFrom(this.http.post<ApiEnvelope<DirectoryContact>>('/api/directory', form));
    return res.data;
  }

  async update(id: string, form: Partial<ContactForm>): Promise<DirectoryContact> {
    const res = await firstValueFrom(this.http.put<ApiEnvelope<DirectoryContact>>(`/api/directory/${id}`, form));
    return res.data;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/directory/${id}`));
  }

  async importCsv(file: File, organizationId?: string): Promise<ImportCsvResult> {
    const body = new FormData();
    body.append('file', file);
    if (organizationId) {
      body.append('organizationId', organizationId);
    }
    const res = await firstValueFrom(this.http.post<ApiEnvelope<ImportCsvResult>>('/api/directory/import-csv', body));
    return res.data;
  }

  async mergeDuplicates(): Promise<{ consolidatedCount: number; mergedContacts: number }> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<{ consolidatedCount: number; mergedContacts: number }>>('/api/directory/merge-duplicates', {}),
    );
    return res.data;
  }
}
