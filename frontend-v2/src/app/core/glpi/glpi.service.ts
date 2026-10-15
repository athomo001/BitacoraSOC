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

/** Importación de equipos desde GLPI (spec/16 §5.1, 9.6): Administración → GLPI. */
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
}
