import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface SystemFeature {
  code: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  configPayload: Record<string, unknown>;
  updatedAt: string;
}

/**
 * GET/PATCH /api/system-features — "cero .env" (docs/adr/0009).
 *
 * Además de las llamadas HTTP, guarda qué funcionalidades están activas en
 * una señal compartida: el menú lateral (ticketera) y Administración →
 * Funcionalidades leen el mismo estado, así que activar la ticketera la
 * muestra en el menú al instante, sin recargar. Los cambios hechos desde
 * otra pestaña u otro admin llegan por SSE (`system_feature.updated`) y
 * entran por `apply()`.
 */
@Injectable({ providedIn: 'root' })
export class SystemFeaturesService {
  private readonly http = inject(HttpClient);
  private readonly enabledCodes = signal<ReadonlySet<string>>(new Set());

  isEnabled(code: string): boolean {
    return this.enabledCodes().has(code);
  }

  async list(): Promise<SystemFeature[]> {
    const response = await firstValueFrom(this.http.get<ApiEnvelope<SystemFeature[]>>('/api/system-features'));
    this.enabledCodes.set(new Set(response.data.filter((f) => f.isEnabled).map((f) => f.code)));
    return response.data;
  }

  async setEnabled(code: string, isEnabled: boolean): Promise<SystemFeature> {
    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<SystemFeature>>(`/api/system-features/${code}`, { isEnabled }),
    );
    this.apply(response.data);
    return response.data;
  }

  /** Aplica un cambio puntual (respuesta de PATCH o evento SSE). */
  apply(feature: Pick<SystemFeature, 'code' | 'isEnabled'>): void {
    this.enabledCodes.update((current) => {
      const next = new Set(current);
      if (feature.isEnabled) next.add(feature.code);
      else next.delete(feature.code);
      return next;
    });
  }
}
