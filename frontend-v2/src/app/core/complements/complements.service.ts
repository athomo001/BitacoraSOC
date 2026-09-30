import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export type ComplementStatus = 'active' | 'maintenance' | 'disabled';
export type ComplementSource = 'zip_static' | 'manual';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Lo que el menú necesita de un complemento visible (GET /api/complements/active). */
export interface ActiveComplement {
  slug: string;
  name: string;
  icon: string;
  status: ComplementStatus;
  sourceType: ComplementSource;
  circuit: CircuitState;
}

/** Ficha completa (Administración → Complementos). */
export interface Complement {
  slug: string;
  name: string;
  description?: string;
  icon: string;
  sourceType: ComplementSource;
  status: ComplementStatus;
  entryPath: string;
  baseUrl?: string;
  internalBaseUrl?: string;
  healthPath?: string;
  scopes: string[];
  allowedCollections: string[];
  connectHosts: string[];
  visibleRoles: string[];
  visiblePermissionGroupIds: string[];
  hasToken: boolean;
  tokenIssuedAt?: string;
  artifactSha256?: string;
  artifactBytes?: number;
  artifactFiles?: number;
  publishedAt?: string;
  circuit: CircuitState;
  circuitDetail?: string;
  entriesCount?: number;
}

export interface ZipAnalysis {
  stack: string;
  publishable: boolean;
  reason?: string;
  entry: string;
  files: number;
  bytes: number;
  largestPath: string;
  largestBytes: number;
  features: string[];
  warnings: string[];
  suggestedSlug: string;
  suggestedName: string;
  connectHosts: string[];
  sha256: string;
}

export interface UploadResult {
  uploadId: string;
  analysis: ZipAnalysis;
  expiresAt: string;
}

export interface PublishDraft {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  connectHosts: string[];
  visibleRoles: string[];
  visiblePermissionGroupIds: string[];
}

export interface ManualDraft {
  slug: string;
  name: string;
  baseUrl: string;
  internalBaseUrl?: string;
  healthPath: string;
  entryPath?: string;
  scopes: string[];
  allowedCollections: string[];
  visibleRoles: string[];
  visiblePermissionGroupIds: string[];
}

export interface TestResult {
  circuit: CircuitState;
  ok: boolean;
  latencyMs?: number;
  files?: number;
  detail?: string;
}

/**
 * Complementos (spec/11-complementos.md). Guarda la lista de los que ve el
 * usuario para el menú: el ítem "Complementos" solo aparece si hay alguno.
 */
@Injectable({ providedIn: 'root' })
export class ComplementsService {
  private readonly http = inject(HttpClient);

  readonly available = signal<ActiveComplement[]>([]);

  async refresh(): Promise<ActiveComplement[]> {
    try {
      const list = (await firstValueFrom(this.http.get<ApiEnvelope<ActiveComplement[]>>('/api/complements/active'))).data;
      this.available.set(list);
      return list;
    } catch {
      this.available.set([]);
      return [];
    }
  }

  clear(): void {
    this.available.set([]);
  }

  /** Dirección del iframe (enlace de un solo uso) y su origen, para validar postMessage. */
  async embed(slug: string): Promise<{ url: string; origin: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ url: string; origin: string }>>(`/api/complements/${slug}/embed`, {}))).data;
  }

  /** CREATE_ENTRY del iframe: la entrada queda con la sesión del usuario. */
  async createEntry(slug: string, entry: { content: string; entryType?: string; tags?: string[] }): Promise<void> {
    await firstValueFrom(this.http.post(`/api/complements/${slug}/entries`, entry));
  }

  // ===== Administración =====

  async list(): Promise<Complement[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Complement[]>>('/api/complements'))).data;
  }

  async get(slug: string): Promise<Complement> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Complement>>(`/api/complements/${slug}`))).data;
  }

  async upload(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return (await firstValueFrom(this.http.post<ApiEnvelope<UploadResult>>('/api/complements/uploads', form))).data;
  }

  async previewUrl(uploadId: string): Promise<string> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ previewUrl: string }>>(`/api/complements/uploads/${uploadId}/preview`))).data.previewUrl;
  }

  async publish(uploadId: string, draft: PublishDraft): Promise<Complement> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Complement>>(`/api/complements/uploads/${uploadId}/publish`, draft))).data;
  }

  async register(draft: ManualDraft): Promise<{ complement: Complement; applicationToken: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ complement: Complement; applicationToken: string }>>('/api/complements', draft))).data;
  }

  async patch(slug: string, patch: Partial<Omit<Complement, 'slug'>>): Promise<Complement> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Complement>>(`/api/complements/${slug}`, patch))).data;
  }

  async regenerateToken(slug: string): Promise<string> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ applicationToken: string }>>(`/api/complements/${slug}/token`, {}))).data.applicationToken;
  }

  async test(slug: string): Promise<TestResult> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<TestResult>>(`/api/complements/${slug}/test`, {}))).data;
  }

  /** Grupos de permisos para "Quién lo ve". */
  async listGroups(): Promise<{ id: string; name: string; active: boolean }[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ id: string; name: string; active: boolean }[]>>('/api/permission-groups'))).data;
  }

  async remove(slug: string): Promise<{ unlinkedEntries: number; deletedFiles: number }> {
    return (await firstValueFrom(this.http.delete<ApiEnvelope<{ unlinkedEntries: number; deletedFiles: number }>>(`/api/complements/${slug}`, { body: { confirmation: slug } }))).data;
  }
}
