import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Qué hacer con los equipos de una entidad de GLPI. */
export interface GlpiEntityRule {
  organizationId: string | null;
  skip: boolean;
}

/** Qué pasó, la causa probable y qué hacer (como el legacy). */
export interface GlpiExplanation {
  error: string;
  cause: string;
  next: string;
  raw: string;
}

export interface GlpiTest {
  at: string;
  ok: boolean;
  version?: string;
  user?: string;
  entities: number;
  computers: number;
  network: number;
  explanation?: GlpiExplanation;
}

export type GlpiAutoMode = 'off' | 'night' | '6h';

export interface GlpiConfig {
  url: string;
  hasAppToken: boolean;
  hasUserToken: boolean;
  verifyTls: boolean;
  timeoutSeconds: number;
  importComputers: boolean;
  importNetwork: boolean;
  areaId: string | null;
  /** Tipo de computador en GLPI → tipo de equipo de la Bitácora. */
  computerTypes: Record<string, string>;
  /** Id de entidad de GLPI → regla. */
  entities: Record<string, GlpiEntityRule>;
  autoMode: GlpiAutoMode;
  nextAutoAt?: string;
  lastTest?: GlpiTest;
}

/** Lo que se guarda: un token vacío conserva el guardado. */
export interface GlpiConfigInput extends Omit<GlpiConfig, 'hasAppToken' | 'hasUserToken' | 'nextAutoAt' | 'lastTest'> {
  appToken?: string;
  userToken?: string;
}

export interface GlpiCatalog {
  entities: { id: number; name: string }[];
  computerTypes: string[];
}

export type GlpiAction = 'create' | 'update' | 'unchanged' | 'reactivate' | 'deactivate' | 'skip' | 'error';

export interface GlpiPlanRow {
  action: GlpiAction;
  itemtype: 'Computer' | 'NetworkEquipment';
  glpiId: number;
  name: string;
  kind: string;
  assetId?: string;
  code?: string;
  changes?: string[];
  detail?: string;
  /** Equipo de la app con la misma serie: se puede vincular. */
  linkAssetId?: string;
}

export interface GlpiPlan {
  readAt: string;
  computers: number;
  network: number;
  counts: Record<GlpiAction, number>;
  rows: GlpiPlanRow[];
  warnings: string[];
  linked: number;
  holdBack: boolean;
  holdReason?: string;
}

export interface GlpiRun {
  id: string;
  trigger: 'manual' | 'auto';
  userName?: string;
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  created: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  skipped: number;
  unchanged: number;
  heldBack: number;
  message: string;
}

export type GlpiTicketsEvery = 'off' | '5m' | '15m';

/** Tickets de GLPI en la Ticketera (10d.1, spec/18): qué se trae y cada cuánto. */
export interface GlpiTicketsConfig {
  enabled: boolean;
  every: GlpiTicketsEvery;
  sinceDays: number;
  /** Entidades marcadas («Traer»), con sus hijas. */
  entities: number[];
  /** Entidad → cliente: el mismo mapeo del inventario. */
  clients: Record<string, string>;
  /** Grupo técnico de GLPI → área de la app; sin área no se trae. */
  groupAreas: Record<string, string>;
  firstLoadPending: boolean;
  nextAutoAt?: string;
  connected: boolean;
}

export interface GlpiTicketsConfigInput {
  enabled: boolean;
  every: GlpiTicketsEvery;
  sinceDays: number;
  entities: number[];
  clients: Record<string, string | null>;
  groupAreas: Record<string, string | null>;
}

export interface GlpiTicketsCatalog {
  entities: { id: number; name: string; parentId: number }[];
  groups: { id: number; name: string; openCount: number }[];
}

export interface GlpiTicketRun {
  id: string;
  trigger: 'manual' | 'auto';
  userName?: string;
  firstLoad: boolean;
  startedAt: string;
  finishedAt?: string;
  running: boolean;
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  message: string;
}

/** Importación de equipos desde GLPI (spec/16 §5.1, 9.6): Administración → GLPI. */
/** Una entidad o un grupo de GLPI para elegir. */
export interface GlpiOption {
  id: number;
  name: string;
}

/** «Escribir en GLPI» (10d.2): por cliente su entidad y por área su grupo al crear. */
export interface GlpiWriteConfig {
  enabled: boolean;
  hasToken: boolean;
  defaultType: 1 | 2;
  clients: { clientId: string; clientName: string; entities: GlpiOption[]; entityId: number | null }[];
  areas: { areaId: string; areaName: string; groups: GlpiOption[]; groupId: number | null }[];
  warning?: string;
}

export interface GlpiWriteConfigInput {
  enabled: boolean;
  /** undefined/null = se mantiene; '' = se quita. */
  token?: string | null;
  defaultType: 1 | 2;
  clientEntities: Record<string, number>;
  areaGroups: Record<string, number>;
}

export interface GlpiWriteTest {
  ok: boolean;
  user?: string;
  profile?: string;
  problem?: GlpiExplanation;
}

export type GlpiOutboxState = 'queued' | 'sent' | 'failed';

export interface GlpiOutboxItem {
  id: string;
  kind: 'followup' | 'solve' | 'close' | 'reopen';
  glpiTicketId: number;
  ticketNumber?: string;
  state: GlpiOutboxState;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string;
  createdAt: string;
}

/** La vista previa de «Crear en GLPI». */
export interface GlpiCreatePreview {
  entities: GlpiOption[];
  entityId: number | null;
  groups: GlpiOption[];
  groupId: number | null;
  type: 1 | 2;
  urgency: number;
  impact: number;
  title: string;
  description: string;
  problem?: string;
  warning?: string;
}

export interface GlpiCreateInput {
  entityId: number;
  groupId: number;
  type: 1 | 2;
  title: string;
}

@Injectable({ providedIn: 'root' })
export class GlpiService {
  private readonly http = inject(HttpClient);

  async config(): Promise<GlpiConfig> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiConfig>>('/api/glpi/config'))).data;
  }

  async saveConfig(input: GlpiConfigInput): Promise<GlpiConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<GlpiConfig>>('/api/glpi/config', input))).data;
  }

  async test(): Promise<GlpiTest> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<GlpiTest>>('/api/glpi/test', {}))).data;
  }

  async catalog(): Promise<GlpiCatalog> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiCatalog>>('/api/glpi/catalog'))).data;
  }

  async preview(): Promise<GlpiPlan> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<GlpiPlan>>('/api/glpi/preview', {}))).data;
  }

  async import(): Promise<GlpiRun> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<GlpiRun>>('/api/glpi/import', {}))).data;
  }

  async link(assetId: string, itemtype: GlpiPlanRow['itemtype'], glpiId: number): Promise<void> {
    await firstValueFrom(this.http.post('/api/glpi/link', { assetId, itemtype, glpiId }));
  }

  async runs(): Promise<GlpiRun[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiRun[]>>('/api/glpi/runs'))).data;
  }

  async ticketsConfig(): Promise<GlpiTicketsConfig> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiTicketsConfig>>('/api/glpi/tickets/config'))).data;
  }

  async saveTicketsConfig(input: GlpiTicketsConfigInput): Promise<GlpiTicketsConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<GlpiTicketsConfig>>('/api/glpi/tickets/config', input))).data;
  }

  async ticketsCatalog(): Promise<GlpiTicketsCatalog> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiTicketsCatalog>>('/api/glpi/tickets/catalog'))).data;
  }

  /** «Sincronizar ahora»: la corrida sigue en segundo plano; se mira en ticketRuns(). */
  async syncTickets(): Promise<void> {
    await firstValueFrom(this.http.post('/api/glpi/tickets/sync', {}));
  }

  async ticketRuns(): Promise<GlpiTicketRun[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiTicketRun[]>>('/api/glpi/tickets/runs'))).data;
  }

  async writeConfig(): Promise<GlpiWriteConfig> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiWriteConfig>>('/api/glpi/write/config'))).data;
  }

  async saveWriteConfig(input: GlpiWriteConfigInput): Promise<GlpiWriteConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<GlpiWriteConfig>>('/api/glpi/write/config', input))).data;
  }

  /** Abre sesión con el token de escritura sin crear nada. */
  async testWrite(): Promise<GlpiWriteTest> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<GlpiWriteTest>>('/api/glpi/write/test', {}))).data;
  }

  async writeQueue(): Promise<GlpiOutboxItem[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<GlpiOutboxItem[]>>('/api/glpi/write/queue'))).data;
  }

  /** Lo que falló vuelve a la cola (uno o todo). */
  async retryWrite(id?: string): Promise<number> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ queued: number }>>('/api/glpi/write/retry', id ? { id } : {}))).data.queued;
  }
}
