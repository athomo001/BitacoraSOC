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
  /** 10i: lo que declara complement.json, lo aprobado y si es «de la casa». */
  manifest?: ComplementManifest;
  items: ComplementItem[];
  approved: string[];
  isHouse: boolean;
  features?: ComplementFeatures;
}

// ===== Complementos que agregan funciones (10i, spec/11 §12) =====

export type PageModule = 'reports' | 'shifts' | 'tickets' | 'escalation' | 'admin';
export type SlotTarget = 'entry' | 'ticket' | 'client' | 'asset';

export interface ManifestSlot {
  id?: string;
  module?: PageModule;
  target?: SlotTarget;
  title?: string;
  path?: string;
}

export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'number' | 'boolean' | 'select';
  help?: string;
  required?: boolean;
  options?: string[];
  default?: unknown;
}

export interface ManifestSchedule {
  name: string;
  title?: string;
  every?: string;
  at?: string;
  days?: string[];
}

export interface ComplementManifest {
  version?: string;
  pages?: ManifestSlot[];
  panels?: ManifestSlot[];
  actions?: ManifestSlot[];
  topbar?: ManifestSlot;
  settings?: SettingField[];
  events?: string[];
  schedules?: ManifestSchedule[];
  data?: string[];
}

export type ItemKind = 'page' | 'panel' | 'action' | 'topbar' | 'settings' | 'event' | 'schedule' | 'data';

/** Una cosa que el complemento agrega y el admin aprueba. */
export interface ComplementItem {
  key: string;
  kind: ItemKind;
  house: boolean;
}

export interface ComplementFeatures {
  integrationKey?: { prefix: string; scopes: string[]; lastUsedAt: string | null };
  events?: { url: string; lastSentAt: string | null; lastError: string | null };
  schedules: { name: string; nextRunAt: string; lastRunAt: string | null; lastStatus: string | null }[];
}

/** Una ranura aprobada que esta persona ve (GET /api/complements/slots). */
export interface ComplementSlot {
  slug: string;
  name: string;
  icon: string;
  key: string;
  module?: PageModule;
  target?: SlotTarget;
  title: string;
}

export interface ComplementSlots {
  pages: ComplementSlot[];
  panels: ComplementSlot[];
  actions: ComplementSlot[];
  topbar: ComplementSlot | null;
}

export interface ComplementSettings {
  fields: SettingField[];
  values: Record<string, unknown>;
  secrets: Record<string, { set: boolean; last4?: string; savedAt?: string }>;
}

export interface EmbedResult {
  url: string;
  origin: string;
  settings?: Record<string, unknown>;
  object?: { type: SlotTarget; id: string };
}

const NO_SLOTS: ComplementSlots = { pages: [], panels: [], actions: [], topbar: null };

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
  manifest?: ComplementManifest;
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
  /** Ranuras aprobadas para esta persona (páginas, pestañas, acciones, barra). */
  readonly slots = signal<ComplementSlots>(NO_SLOTS);

  /** Relee los complementos que ve el usuario y sus ranuras aprobadas (10i). */
  async refresh(): Promise<ActiveComplement[]> {
    const get = <T>(url: string, none: T) => firstValueFrom(this.http.get<ApiEnvelope<T>>(url)).then((r) => r.data, () => none);
    const [list, slots] = await Promise.all([get<ActiveComplement[]>('/api/complements/active', []), get('/api/complements/slots', NO_SLOTS)]);
    this.available.set(list);
    this.slots.set(slots);
    return list;
  }

  clear(): void {
    this.available.set([]);
    this.slots.set(NO_SLOTS);
  }

  /**
   * Dirección del iframe (enlace de un solo uso) y su origen, para validar
   * postMessage. Con slot abre esa ranura con la ficha abierta (10i).
   */
  async embed(slug: string, slot?: { slot: string; objectType?: SlotTarget; objectId?: string }): Promise<EmbedResult> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<EmbedResult>>(`/api/complements/${slug}/embed`, slot ?? {}))).data;
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

  async register(draft: ManualDraft): Promise<{ complement: Complement; applicationToken: string; manifestError?: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ complement: Complement; applicationToken: string; manifestError?: string }>>('/api/complements', draft))).data;
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
