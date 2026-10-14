import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { downloadFile } from '../download';

/** Un campo de un tipo de equipo (Administración → Inventario). */
export interface KindField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'list' | 'date';
  options?: string[];
}

export interface AssetKind {
  code: string;
  name: string;
  icon: string;
  baseType: 'circuit' | 'link' | 'site' | 'device';
  fields: KindField[];
  sortOrder: number;
  active: boolean;
}

export interface InventoryMeta {
  kinds: AssetKind[];
  responsibleTypes: { code: string; name: string; active: boolean }[];
  areas: { id: string; code: string; name: string }[];
  myAreas: string[];
  viewAll: boolean;
  admin: boolean;
  pendingRequests: number;
  canCreate: boolean;
}

export interface InventoryRow {
  id: string;
  name: string;
  code: string;
  kind: string;
  areaId: string;
  areaName: string;
  serial?: string;
  model?: string;
  attributes: Record<string, string>;
  active: boolean;
  placeName?: string;
  firstIp: string;
  ipCount: number;
}

export type IpKind = 'network' | 'vip' | 'management' | 'other';
export interface AssetIp { kind: IpKind; address: string; note?: string; }

/** Un responsable: un área (código), una persona o una organización. */
export interface AssetResponsible {
  type: string;
  typeName?: string;
  area?: string;
  areaName?: string;
  userId?: string;
  userName?: string;
  organizationId?: string;
  organizationName?: string;
}

export interface AssetEvent {
  id: string;
  kind: 'created' | 'edited' | 'work' | 'ticket' | 'import' | 'deactivated' | 'reactivated';
  description: string;
  happenedAt: string;
  userName?: string;
  ticketId?: string;
  ticketNumber?: string;
}

export interface AssetRequest {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  action: 'deactivate' | 'delete';
  reason: string;
  requestedByName: string;
  areaName: string;
  createdAt: string;
}

export interface InventoryAsset {
  id: string;
  name: string;
  code: string;
  kind: string;
  area: string;
  areaName: string;
  territorialUnitId?: string;
  placeName?: string;
  clientId?: string;
  clientName?: string;
  model?: string;
  serial?: string;
  rack?: string;
  rackPosition?: string;
  attributes: Record<string, string>;
  extra: Record<string, string>;
  active: boolean;
  ips: AssetIp[];
  responsibles: AssetResponsible[];
  events: AssetEvent[];
  tickets: { id: string; ticketNumber: string; title: string; status: string; priority: string; createdAt: string }[];
  pendingRequest?: AssetRequest;
  canEdit: boolean;
  canDecide: boolean;
}

/** Lo que se manda al crear o editar. */
export interface InventoryInput {
  kind: string;
  name: string;
  code?: string;
  area: string;
  territorialUnitId?: string;
  clientId?: string;
  model?: string;
  serial?: string;
  rack?: string;
  rackPosition?: string;
  attributes: Record<string, string>;
  extra: Record<string, string>;
  ips: AssetIp[];
  responsibles: AssetResponsible[];
}

export interface CsvRow { line: number; code: string; name: string; action: 'create' | 'update' | 'unchanged' | 'error'; detail?: string; error?: string; }
export interface CsvResult { rows: CsvRow[]; created: number; updated: number; unchanged: number; errors: number; applied: boolean; }

/** Inventario (spec/16 §4.2, 9.2): equipos por área, su ficha e historial. */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);

  /** Solicitudes de baja que espera el usuario (admin o jefatura); el menú muestra el número. */
  readonly pending = signal(0);

  async refreshPending(): Promise<void> {
    try {
      this.pending.set((await this.requests()).length);
    } catch {
      this.pending.set(0);
    }
  }

  async meta(): Promise<InventoryMeta> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<InventoryMeta>>('/api/inventory/meta'))).data;
  }

  async list(filters: { scope?: 'mine' | 'all'; kind?: string; q?: string; inactive?: boolean } = {}): Promise<InventoryRow[]> {
    let params = new HttpParams();
    if (filters.scope) params = params.set('scope', filters.scope);
    if (filters.kind) params = params.set('kind', filters.kind);
    if (filters.q?.trim()) params = params.set('q', filters.q.trim());
    if (filters.inactive) params = params.set('inactive', 'true');
    return (await firstValueFrom(this.http.get<ApiEnvelope<InventoryRow[]>>('/api/inventory', { params }))).data;
  }

  async get(id: string): Promise<InventoryAsset> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<InventoryAsset>>(`/api/inventory/${id}`))).data;
  }

  async create(input: InventoryInput): Promise<InventoryAsset> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<InventoryAsset>>('/api/inventory', input))).data;
  }

  async update(id: string, input: InventoryInput): Promise<InventoryAsset> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<InventoryAsset>>(`/api/inventory/${id}`, input))).data;
  }

  async addWork(id: string, description: string, happenedAt?: string, ticketId?: string): Promise<InventoryAsset> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<InventoryAsset>>(`/api/inventory/${id}/events`, { description, happenedAt, ticketId }))).data;
  }

  async setActive(id: string, active: boolean, reason = ''): Promise<InventoryAsset> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<InventoryAsset>>(`/api/inventory/${id}/active`, { active, reason }))).data;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/inventory/${id}`));
  }

  async request(id: string, action: 'deactivate' | 'delete', reason: string): Promise<InventoryAsset> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<InventoryAsset>>(`/api/inventory/${id}/requests`, { action, reason }))).data;
  }

  async requests(): Promise<AssetRequest[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<AssetRequest[]>>('/api/inventory/requests'))).data;
  }

  async decide(requestId: string, approve: boolean, note = ''): Promise<void> {
    await firstValueFrom(this.http.post(`/api/inventory/requests/${requestId}/decide`, { approve, note }));
  }

  /** Revisión (dryRun) o carga final: el archivo viaja desde el navegador y no se guarda. */
  async importCsv(kind: string, csv: string, dryRun: boolean): Promise<CsvResult> {
    const params = new HttpParams().set('kind', kind).set('dryRun', String(dryRun));
    const headers = new HttpHeaders({ 'Content-Type': 'text/csv' });
    return (await firstValueFrom(this.http.post<ApiEnvelope<CsvResult>>('/api/inventory/import', csv, { params, headers }))).data;
  }

  downloadTemplate(kind: string): Promise<void> {
    return downloadFile(this.http, '/api/inventory/import/template', `inventario-${kind}.csv`, new HttpParams().set('kind', kind));
  }

  downloadExport(kind: string): Promise<void> {
    return downloadFile(this.http, '/api/inventory/export', `inventario-${kind}-exportado.csv`, new HttpParams().set('kind', kind));
  }

  async saveKind(kind: Partial<AssetKind> & { code: string }): Promise<AssetKind> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<AssetKind>>(`/api/inventory/kinds/${kind.code}`, kind))).data;
  }

  async saveResponsibleType(code: string, name: string, active = true): Promise<void> {
    await firstValueFrom(this.http.put(`/api/inventory/responsibility-types/${code}`, { name, active }));
  }
}
