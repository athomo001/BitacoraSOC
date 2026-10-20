import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { ResolvedChannel } from '../escalation/escalation.service';

/** Las cuatro letras, en el orden en que se muestran. */
export const RACI_ROLES = ['responsible', 'accountable', 'consulted', 'informed'] as const;
export type RaciRole = (typeof RACI_ROLES)[number];

export interface RaciMember {
  name: string;
  channels: ResolvedChannel[];
}

/** Quien ocupa una letra: una persona (equipo «raci»), una lista o una guardia. */
export interface RaciTeam {
  id: string;
  name: string;
  kind: string;
  members: RaciMember[];
}

export interface RaciActivity {
  id: string;
  clientId: string;
  clientName: string;
  topic: string;
  activity: string;
  notes: string;
  letters: Record<RaciRole, RaciTeam[]>;
}

export interface RaciForm {
  clientId: string;
  topic: string;
  activity: string;
  notes: string;
  responsible: string[];
  accountable: string[];
  consulted: string[];
  informed: string[];
}

/** RACI por cliente (paridad con el legacy: Escalamiento → Matriz RACI). */
@Injectable({ providedIn: 'root' })
export class RaciService {
  private readonly http = inject(HttpClient);

  async list(clientId?: string): Promise<RaciActivity[]> {
    const params: Record<string, string> = clientId ? { clientId } : {};
    return (await firstValueFrom(this.http.get<ApiEnvelope<RaciActivity[]>>('/api/raci', { params }))).data;
  }

  async create(form: RaciForm): Promise<RaciActivity> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<RaciActivity>>('/api/raci', form))).data;
  }

  async update(id: string, form: RaciForm): Promise<RaciActivity> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<RaciActivity>>(`/api/raci/${id}`, form))).data;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/raci/${id}`));
  }

  /** El equipo «raci» de un contacto del directorio (se crea si no existe). */
  async person(contactId: string): Promise<{ id: string; name: string; kind: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ id: string; name: string; kind: string }>>('/api/raci/people', { contactId }))).data;
  }
}
