import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { Complement, ComplementSettings } from './complements.service';

/**
 * Revisión y configuración de lo que agrega un complemento (10i), solo en
 * Administración: va aparte para no pesar en la carga inicial de la app.
 */
@Injectable({ providedIn: 'root' })
export class ComplementsAdminService {
  private readonly http = inject(HttpClient);

  async setApprovals(slug: string, approved: string[], house: boolean): Promise<Complement> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<Complement>>(`/api/complements/${slug}/approvals`, { approved, house }))).data;
  }

  /** Vuelve a leer el complement.json de un servicio. */
  async refreshManifest(slug: string): Promise<Complement> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Complement>>(`/api/complements/${slug}/manifest`, {}))).data;
  }

  async getSettings(slug: string): Promise<ComplementSettings> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ComplementSettings>>(`/api/complements/${slug}/settings`))).data;
  }

  async putSettings(slug: string, body: { values: Record<string, unknown>; secrets: Record<string, string>; clear: string[] }): Promise<ComplementSettings> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<ComplementSettings>>(`/api/complements/${slug}/settings`, body))).data;
  }
}
