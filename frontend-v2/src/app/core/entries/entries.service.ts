import { GlpiCreateInput, GlpiCreatePreview } from '../glpi/glpi.service';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { downloadFile } from '../download';

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
  /** La creó una llave de la API de integraciones (spec/19). */
  apiKeyName?: string;
  /** En seguimiento hasta que alguien lo cierra (10j). */
  followUpOpen: boolean;
  /** Cuántos seguimientos tiene y cuándo fue el último. */
  followUpCount: number;
  lastFollowUpAt?: string;
}

export interface EntryComment {
  id: string;
  entryId: string;
  authorUsername: string;
  comment: string;
  isSystemGenerated: boolean;
  createdAt: string;
  /** «También en GLPI» (10d.2): en cola, enviado o no se envió. */
  glpiPush?: 'queued' | 'sent' | 'failed';
  glpiPushError?: string;
}

export interface EntryDetail extends Entry {
  comments: EntryComment[];
  /** Ticket interno enlazado. */
  ticket?: { id: string; number: string; title: string };
  /** Ticket de GLPI enlazado y, si GLPI está configurado, el enlace a su ficha. */
  glpiTicketId?: string;
  glpiTicketUrl?: string;
  /** «Escribir en GLPI» encendido (10d.2). */
  glpiWrite?: boolean;
  /** Quién cerró el seguimiento, cuándo y con qué nota. */
  followUpClosedAt?: string;
  followUpClosedBy?: string;
  followUpCloseNote?: string;
}

export interface EntryFilters {
  scope?: EntryScope;
  type?: EntryType;
  tag?: string;
  from?: string;
  to?: string;
  q?: string;
  /** Autor: un id o «me» (Mías). */
  author?: string;
  /** Cliente: por el servicio o el activo de la entrada (o la etiqueta cliente:X del legacy). */
  client?: string;
  /** «En seguimiento»: solo las abiertas, primero la de seguimiento más reciente. */
  followUp?: 'open';
  page?: number;
  pageSize?: number;
}

export interface EntryAuthor { id: string; name: string; username: string; }
export interface TagSuggestion { tag: string; uses: number; }
export interface TagStat { tag: string; uses: number; lastUsed: string; }

function filterParams(f: EntryFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.scope) params['scope'] = f.scope;
  if (f.type) params['type'] = f.type;
  if (f.tag) params['tag'] = f.tag;
  if (f.from) params['from'] = f.from;
  if (f.to) params['to'] = f.to;
  if (f.q) params['q'] = f.q;
  if (f.author) params['author'] = f.author;
  if (f.client) params['client'] = f.client;
  if (f.followUp) params['followUp'] = f.followUp;
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

  /** Quienes escribieron en la Bitácora (filtro por autor). */
  async authors(): Promise<EntryAuthor[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<EntryAuthor[]>>('/api/entries/authors'))).data;
  }

  /** Etiquetas que empiezan con lo escrito, las más usadas primero (hasta 10). */
  async suggestTags(q: string): Promise<TagSuggestion[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TagSuggestion[]>>('/api/entries/tags', { params: { q } }))).data;
  }

  /** Administración → Etiquetas (admin). */
  async tagStats(): Promise<TagStat[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TagStat[]>>('/api/admin/entry-tags'))).data;
  }

  async renameTag(from: string, to: string): Promise<number> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ entries: number }>>('/api/admin/entry-tags/rename', { from, to }))).data.entries;
  }

  async deleteTag(tag: string): Promise<number> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ entries: number }>>('/api/admin/entry-tags/delete', { tag }))).data.entries;
  }

  async get(id: string): Promise<EntryDetail> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<EntryDetail>>(`/api/entries/${id}`))).data;
  }

  /**
   * Crea la entrada. Con la ticketera activa puede vincularse a un ticket
   * existente (ticketNumber) o crear uno nuevo en la misma operación
   * (createTicket + ticketType + assignedTeamId + clientId, o el cliente del servicio).
   */
  async create(entry: {
    entryType: EntryType; scope?: EntryScope; content: string; tags?: string[]; serviceId?: string; assetId?: string; imageUrl?: string; ticketNumber?: string;
    createTicket?: boolean; ticketType?: 'incident' | 'service_request'; assignedTeamId?: string; clientId?: string;
  }): Promise<Entry | { entry: Entry; ticket: unknown }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Entry | { entry: Entry; ticket: unknown }>>('/api/entries', entry))).data;
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

  /** Enlaza la entrada a un ticket interno por su número (TKT-…). */
  async linkTicket(entryId: string, ticketNumber: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/entries/${entryId}/ticket-link`, { ticketNumber }));
  }

  async unlinkTicket(entryId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/entries/${entryId}/ticket-link`));
  }

  /** Número de ticket de GLPI; vacío lo quita. Devuelve el detalle actualizado. */
  async setGlpiTicket(entryId: string, glpiTicketId: string): Promise<EntryDetail> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<EntryDetail>>(`/api/entries/${entryId}/glpi-ticket`, { glpiTicketId }))).data;
  }

  async addComment(entryId: string, comment: string, syncToGlpi = false): Promise<EntryComment> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<EntryComment>>(`/api/entries/${entryId}/comments`, syncToGlpi ? { comment, syncToGlpi } : { comment }))).data;
  }

  /** Vista previa de «Crear en GLPI» desde la entrada (10d.2). */
  async glpiPreview(entryId: string): Promise<GlpiCreatePreview> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiCreatePreview>>(`/api/entries/${entryId}/glpi-create`))).data;
  }

  async createInGlpi(entryId: string, input: GlpiCreateInput): Promise<{ glpiTicketId: string; glpiTicketUrl?: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ glpiTicketId: string; glpiTicketUrl?: string }>>(`/api/entries/${entryId}/glpi-create`, input))).data;
  }

  /** Cerrar el seguimiento (nota opcional) o ponerla en seguimiento sin escribir uno. */
  async setFollowUp(entryId: string, open: boolean, note = ''): Promise<{ followUpOpen: boolean; followUpClosedAt?: string }> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<{ followUpOpen: boolean; followUpClosedAt?: string }>>(`/api/entries/${entryId}/follow-up`, { open, note }))).data;
  }

  /** Sin conversión a WebP ni limpieza EXIF (versión simple de esta fase, ver spec/00-mapa-mental.md). */
  async uploadImage(file: File): Promise<UploadImageResult> {
    const form = new FormData();
    form.append('image', file);
    return (await firstValueFrom(this.http.post<ApiEnvelope<UploadImageResult>>('/api/entries/upload-image', form))).data;
  }

  downloadCsv(filters: EntryFilters = {}): Promise<void> {
    return downloadFile(this.http, this.exportUrl(filters), 'bitacora.csv');
  }

  exportUrl(filters: EntryFilters = {}): string {
    const params = new URLSearchParams(filterParams(filters));
    const query = params.toString();
    return query ? `/api/entries/export?${query}` : '/api/entries/export';
  }
}
