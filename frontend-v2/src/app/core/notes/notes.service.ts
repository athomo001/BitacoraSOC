import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface Notes {
  content: string;
  lastEditedByUsername?: string;
  updatedAt?: string;
}

/** Pizarrón Admin (visible para toda la sala) y Libreta Personal (Fase 9). */
@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly http = inject(HttpClient);

  async getAdmin(): Promise<Notes> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Notes>>('/api/notes/admin'))).data;
  }

  async putAdmin(content: string): Promise<Notes> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<Notes>>('/api/notes/admin', { content }))).data;
  }

  async getPersonal(): Promise<Notes> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Notes>>('/api/notes/personal'))).data;
  }

  async putPersonal(content: string): Promise<Notes> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<Notes>>('/api/notes/personal', { content }))).data;
  }
}
