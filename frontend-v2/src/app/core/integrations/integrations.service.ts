import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Reenvío de eventos a un SIEM y llaves de la API de integraciones (spec/19, 10b). */

export type ForwardTransport = 'udp' | 'tcp' | 'tls' | 'http';
export type ForwardFormat = 'json' | 'rfc5424';
export type ForwardLevel = 'info' | 'warn' | 'error';
export type ForwardState = 'off' | 'idle' | 'ok' | 'failing';

export interface ForwardDestination {
  id: string;
  name: string;
  enabled: boolean;
  transport: ForwardTransport;
  host: string | null;
  port: number | null;
  url: string | null;
  format: ForwardFormat;
  batch: boolean;
  sendAudit: boolean;
  auditLevel: ForwardLevel;
  sendEntries: boolean;
  sendEscalation: boolean;
  sendTickets: boolean;
  hasCaCert: boolean;
  hasClientCert: boolean;
  /** Nombres de las cabeceras guardadas; los valores nunca vuelven. */
  headers: string[];
  state: ForwardState;
  failingSince: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  sentToday: number;
  lostWeek: number;
  pending: number;
}

/** Una cabecera: value null = se mantiene la guardada. */
export interface ForwardHeaderInput {
  name: string;
  value: string | null;
}

/** Certificados y llave: undefined/null = se mantiene, '' = se quita. */
export interface ForwardDestinationInput {
  name: string;
  enabled: boolean;
  transport: ForwardTransport;
  host: string;
  port: number;
  url: string;
  format: ForwardFormat;
  batch: boolean;
  sendAudit: boolean;
  auditLevel: ForwardLevel;
  sendEntries: boolean;
  sendEscalation: boolean;
  sendTickets: boolean;
  caCert?: string | null;
  clientCert?: string | null;
  clientKey?: string | null;
  headers: ForwardHeaderInput[];
}

export interface ForwardTestResult {
  ok: boolean;
  transport: ForwardTransport;
  error?: string;
}

export type ApiKeyState = 'active' | 'expired' | 'revoked';

export interface ApiKey {
  id: string;
  name: string;
  description: string;
  prefix: string;
  scopes: string[];
  /** Vacío o null = todos los clientes. */
  clientIds: string[] | null;
  areaId: string | null;
  areaName?: string;
  state: ApiKeyState;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdByName: string;
  revokedAt: string | null;
  revokedByName?: string;
  revokeReason: string | null;
  callsWeek: number;
}

export interface ApiKeyInput {
  name: string;
  description: string;
  scopes: string[];
  clientIds: string[];
  areaId: string | null;
  /** 90, 365 o 0 (sin vencimiento). */
  expiresInDays: number;
}

export interface ApiKeyCreated {
  key: ApiKey;
  /** La llave completa: sale una sola vez. */
  secret: string;
}

export interface ApiKeyRequest {
  at: string;
  method: string;
  path: string;
  scope: string | null;
  status: number;
  latencyMs: number;
  ip: string | null;
  note: string | null;
}

export interface IdName {
  id: string;
  name: string;
  code?: string;
}

export interface IntegrationsMeta {
  scopes: string[];
  areas: IdName[];
  clients: IdName[];
  crypto: boolean;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly http = inject(HttpClient);

  async meta(): Promise<IntegrationsMeta> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<IntegrationsMeta>>('/api/integrations/meta'))).data;
  }

  async destinations(): Promise<ForwardDestination[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ForwardDestination[]>>('/api/integrations/destinations'))).data;
  }

  async createDestination(input: ForwardDestinationInput): Promise<ForwardDestination> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ForwardDestination>>('/api/integrations/destinations', input))).data;
  }

  async updateDestination(id: string, input: ForwardDestinationInput): Promise<ForwardDestination> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<ForwardDestination>>(`/api/integrations/destinations/${id}`, input))).data;
  }

  async deleteDestination(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/integrations/destinations/${id}`));
  }

  async testDestination(id: string): Promise<ForwardTestResult> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ForwardTestResult>>(`/api/integrations/destinations/${id}/test`, {}))).data;
  }

  async keys(): Promise<ApiKey[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ApiKey[]>>('/api/integrations/keys'))).data;
  }

  async createKey(input: ApiKeyInput): Promise<ApiKeyCreated> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ApiKeyCreated>>('/api/integrations/keys', input))).data;
  }

  async revokeKey(id: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/integrations/keys/${id}/revoke`, {}));
  }

  async keyRequests(id: string): Promise<ApiKeyRequest[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ApiKeyRequest[]>>(`/api/integrations/keys/${id}/requests`))).data;
  }
}
