import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/**
 * Código del tipo de organización. Desde la migración 000013 los tipos son
 * configurables (organization_types): 'client', 'mandante', 'internal',
 * 'contractor', 'carrier' de fábrica y los que cree el admin.
 */
export type OrganizationType = string;

/** Un tipo de organización (Administración → Organizaciones → Tipos). */
export interface OrganizationKind {
  code: string;
  name: string;
  description: string | null;
  /** Se elige como cliente en tickets y escalamiento. */
  isClient: boolean;
  /** Lo usa la aplicación: se renombra pero no se borra. */
  system: boolean;
  organizations: number;
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  type: OrganizationType;
  active: boolean;
  /** Mandante a través del cual se atiende ("JUNJI vía Mundo"). */
  viaOrganizationId?: string | null;
  viaName?: string | null;
}

/** Algo asociado a una organización que hay que resolver antes de eliminarla. */
export interface OrgDependentItem {
  id: string;
  name: string;
  code?: string;
  detail: string;
  /** Sin historial (entradas, tickets, mantenciones): se puede eliminar. */
  deletable: boolean;
}

export interface OrgDependentTicket {
  id: string;
  number: string;
  title: string;
  status: string;
  createdAt: string;
}

/** Lo que muestra el popup de eliminar organización (canvas v22). */
export interface OrgDependents {
  services: OrgDependentItem[];
  teams: OrgDependentItem[];
  assets: OrgDependentItem[];
  /** Opcionales: si no se mueven quedan en el histórico con el nombre de la organización. */
  tickets: OrgDependentTicket[];
  /** Los contactos no dependen de la organización: se quedan en el Directorio. */
  contacts: number;
}

export type OrgDependentKind = 'service' | 'team' | 'asset' | 'ticket';

export interface OrgDeleteAction {
  kind: OrgDependentKind;
  id: string;
  op: 'move' | 'delete' | 'rename';
  to?: string;
  name?: string;
}

export interface OrgDeletePlan {
  /** "Todo de una": mueve los servicios, equipos y activos que queden sin resolver. */
  moveTo?: string;
  actions: OrgDeleteAction[];
}

export interface LogSource {
  id: string;
  code: string;
  displayName: string;
  category: string;
  active: boolean;
}

export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
  kind: string;
  audience: 'internal' | 'client';
  organizationId?: string;
  organizationName?: string;
  active: boolean;
  memberCount?: number;
  /** Solo en la lista: false si su organización está desactivada. */
  organizationActive?: boolean;
  /** Lo desactivó su organización (vuelve si se reactiva). */
  deactivatedByOrg?: boolean;
  /** Qué lo usa: se avisa antes de borrar. */
  usage?: TeamUsage;
}

/** steps: "QRadar · DPP #2, …": política y número de llamado (vacío si ninguna lo usa). */
export interface TeamUsage { steps: string; raci: number; guards: number; tickets: number; }

export type TeamBulkAction = 'activate' | 'deactivate' | 'delete';

export interface TeamMember {
  id: string;
  userId?: string;
  contactId?: string;
  displayName: string;
  recipientType: 'to' | 'cc';
  roleInTeam: 'primary' | 'backup' | 'lead';
  priority: number;
}

export interface TeamCoverage {
  territorialUnitId: string;
  name: string;
  code: string;
  kind: string;
  priority: number;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMember[];
  coverage?: TeamCoverage[];
}

/** Organizaciones, catálogo de tecnologías y equipos (Fase 6). */
@Injectable({ providedIn: 'root' })
export class OrganizationsService {
  private readonly http = inject(HttpClient);

  /** `clients: true` trae las de los tipos que cuentan como cliente (Cliente, Mandante…). */
  async list(params: { type?: OrganizationType; active?: boolean; clients?: boolean } = {}): Promise<Organization[]> {
    const query: Record<string, string> = {};
    if (params.type) query['type'] = params.type;
    if (params.clients) query['clients'] = 'true';
    if (params.active !== undefined) query['active'] = String(params.active);
    return (await firstValueFrom(this.http.get<ApiEnvelope<Organization[]>>('/api/organizations', { params: query }))).data;
  }

  async create(org: { name: string; code: string; type: OrganizationType }): Promise<Organization> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Organization>>('/api/organizations', org))).data;
  }

  async listTypes(): Promise<OrganizationKind[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<OrganizationKind[]>>('/api/organization-types'))).data;
  }

  async createType(t: { code: string; name: string; isClient: boolean }): Promise<OrganizationKind> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<OrganizationKind>>('/api/organization-types', t))).data;
  }

  async patchType(code: string, patch: { name?: string; isClient?: boolean }): Promise<OrganizationKind> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<OrganizationKind>>(`/api/organization-types/${code}`, patch))).data;
  }

  /** Si tiene organizaciones, `moveTo` dice a qué tipo pasan antes de borrarlo. */
  async deleteType(code: string, moveTo?: string): Promise<void> {
    const params: Record<string, string> = moveTo ? { moveTo } : {};
    await firstValueFrom(this.http.delete(`/api/organization-types/${code}`, { params }));
  }

  /** Solo si no tiene nada asociado; si no, el backend responde 409 explicando qué tiene. */
  async dependents(id: string): Promise<OrgDependents> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<OrgDependents>>(`/api/organizations/${id}/dependents`))).data;
  }

  /** Aplica lo decidido en el popup (todo o nada) y elimina (archiva) la organización. */
  async remove(id: string, plan?: OrgDeletePlan): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/organizations/${id}`, plan ? { body: plan } : {}));
  }

  async patch(id: string, patch: Partial<Organization>): Promise<Organization> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Organization>>(`/api/organizations/${id}`, patch))).data;
  }

  async listLogSources(): Promise<LogSource[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<LogSource[]>>('/api/log-sources'))).data;
  }

  async patchLogSource(id: string, patch: { displayName?: string; category?: string; active?: boolean }): Promise<LogSource> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<LogSource>>(`/api/log-sources/${id}`, patch))).data;
  }

  async createLogSource(src: { code: string; displayName: string; category: string }): Promise<LogSource> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<LogSource>>('/api/log-sources', src))).data;
  }

  async listTeams(): Promise<TeamSummary[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamSummary[]>>('/api/teams'))).data;
  }

  /** Activar, desactivar o borrar varios equipos. Borrar es en cascada (menos el Directorio). */
  async bulkTeams(ids: string[], action: TeamBulkAction): Promise<void> {
    await firstValueFrom(this.http.post('/api/teams/bulk', { ids, action }));
  }

  async getTeam(id: string): Promise<TeamDetail> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamDetail>>(`/api/teams/${id}`))).data;
  }

  async createTeam(team: { name: string; kind: string; organizationId?: string; audience: string }): Promise<TeamSummary> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<TeamSummary>>('/api/teams', team))).data;
  }

  async addMember(teamId: string, member: { contactId?: string; userId?: string; poolId?: string; roleInTeam: string; recipientType: string; priority: number }): Promise<void> {
    await firstValueFrom(this.http.post(`/api/teams/${teamId}/members`, member));
  }

  async removeMember(teamId: string, memberId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/teams/${teamId}/members/${memberId}`));
  }

  async addCoverage(teamId: string, territorialUnitId: string, priority: number): Promise<void> {
    await firstValueFrom(this.http.post(`/api/teams/${teamId}/coverage`, { territorialUnitId, priority }));
  }

  async removeCoverage(teamId: string, territorialUnitId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/teams/${teamId}/coverage/${territorialUnitId}`));
  }
}
