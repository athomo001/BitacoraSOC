import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export type OrganizationType = 'client' | 'contractor' | 'carrier' | 'internal';

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  client: 'Cliente',
  contractor: 'Contrata',
  carrier: 'Carrier',
  internal: 'Interna',
};

export interface Organization {
  id: string;
  name: string;
  code: string;
  type: OrganizationType;
  active: boolean;
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
}

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

  async list(params: { type?: OrganizationType; active?: boolean } = {}): Promise<Organization[]> {
    const query: Record<string, string> = {};
    if (params.type) query['type'] = params.type;
    if (params.active !== undefined) query['active'] = String(params.active);
    return (await firstValueFrom(this.http.get<ApiEnvelope<Organization[]>>('/api/organizations', { params: query }))).data;
  }

  async create(org: { name: string; code: string; type: OrganizationType }): Promise<Organization> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Organization>>('/api/organizations', org))).data;
  }

  async patch(id: string, patch: Partial<Organization>): Promise<Organization> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Organization>>(`/api/organizations/${id}`, patch))).data;
  }

  async listLogSources(): Promise<LogSource[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<LogSource[]>>('/api/log-sources'))).data;
  }

  async createLogSource(src: { code: string; displayName: string; category: string }): Promise<LogSource> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<LogSource>>('/api/log-sources', src))).data;
  }

  async listTeams(): Promise<TeamSummary[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamSummary[]>>('/api/teams'))).data;
  }

  async getTeam(id: string): Promise<TeamDetail> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamDetail>>(`/api/teams/${id}`))).data;
  }

  async createTeam(team: { name: string; kind: string; organizationId?: string; audience: string }): Promise<TeamSummary> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<TeamSummary>>('/api/teams', team))).data;
  }

  async addMember(teamId: string, member: { contactId?: string; userId?: string; roleInTeam: string; recipientType: string; priority: number }): Promise<void> {
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
