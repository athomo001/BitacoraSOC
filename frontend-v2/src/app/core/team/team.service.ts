import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface TeamArea {
  code: string;
  name: string;
}

export interface TeamGroup {
  id: string;
  name: string;
  level?: string;
}

/** Condición del día: la de Dotación, o la guardia. */
export type TeamCondition = 'office' | 'telework' | 'guardia' | 'vacation' | 'medical_leave' | 'medical_appointment' | 'training';

export interface TeamPerson {
  id: string;
  username: string;
  fullName: string;
  email: string;
  active: boolean;
  /** La jefatura puede tocarla (no es admin, ni ella misma, ni tiene grupos de otras áreas). */
  editable: boolean;
  groups: TeamGroup[];
  today: TeamCondition;
  week: { date: string; condition: TeamCondition }[];
  tickets: number;
  breached: number;
}

export interface TeamView {
  area: TeamArea;
  stats: { people: number; tickets: number; breached: number; away: number };
  people: TeamPerson[];
  /** Los grupos del área que la jefatura puede asignar. */
  groups: TeamGroup[];
}

export interface TeamTicket {
  id: string;
  number: string;
  title: string;
  status: string;
  breached: boolean;
}

export interface NewTeamPerson {
  area: string;
  fullName: string;
  username: string;
  email: string;
  groupId: string;
}

/** Mi equipo: la jefatura de área (spec/16 §3.5, 9d). */
@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly http = inject(HttpClient);

  async areas(): Promise<TeamArea[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamArea[]>>('/api/team/areas'))).data;
  }

  async team(area: string): Promise<TeamView> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamView>>('/api/team', { params: { area } }))).data;
  }

  async tickets(area: string, personId: string): Promise<TeamTicket[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamTicket[]>>(`/api/team/people/${personId}/tickets`, { params: { area } }))).data;
  }

  /** Alta con contraseña temporal: se muestra una sola vez. */
  async create(person: NewTeamPerson): Promise<{ id: string; username: string; tempPassword: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ id: string; username: string; tempPassword: string }>>('/api/team/people', person))).data;
  }

  async setGroup(area: string, personId: string, groupId: string): Promise<void> {
    await firstValueFrom(this.http.put(`/api/team/people/${personId}/group`, { area, groupId }));
  }

  async setActive(area: string, personId: string, active: boolean): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/team/people/${personId}`, { area, active }));
  }
}
