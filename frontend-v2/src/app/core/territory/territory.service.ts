import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import {
  ImportResult,
  PageMeta,
  TerritorialKind,
  TerritorialLabels,
  TerritorialUnit,
} from './territory.models';

/** Seed de Chile servido como asset estático (angular.json → ../seed). */
export const CHILE_SEED_URL = '/seed/territorial_units_chile.json';

const DEFAULT_LABELS: TerritorialLabels = {
  country: 'País',
  region: 'Región',
  zone: 'Zona',
  site: 'Sitio',
};

/**
 * Territorio país-agnóstico (spec/01-arquitectura.md sección 4). Único lugar
 * que conoce las etiquetas por nivel: ningún componente escribe "Región" a
 * mano, todos llaman kindLabel() (HU-TERR-1).
 */
@Injectable({ providedIn: 'root' })
export class TerritoryService {
  private readonly http = inject(HttpClient);

  private readonly _labels = signal<TerritorialLabels>(DEFAULT_LABELS);
  readonly labels = this._labels.asReadonly();

  kindLabel(kind: TerritorialKind): string {
    return this._labels()[kind];
  }

  async loadLabels(): Promise<TerritorialLabels> {
    const response = await firstValueFrom(
      this.http.get<ApiEnvelope<TerritorialLabels>>('/api/config/territorial-labels'),
    );
    this._labels.set(response.data);
    return response.data;
  }

  async saveLabels(patch: Partial<TerritorialLabels>): Promise<TerritorialLabels> {
    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<TerritorialLabels>>('/api/config/territorial-labels', patch),
    );
    this._labels.set(response.data);
    return response.data;
  }

  /**
   * Manda el JSON tal cual lo trae el archivo — la validación de forma
   * (kind fuera de orden, JSON roto) la hace el backend y vuelve como 400.
   */
  async importTree(json: string): Promise<ImportResult> {
    const response = await firstValueFrom(
      this.http.post<ApiEnvelope<ImportResult>>('/api/territorial-units/import', json, {
        headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
      }),
    );
    return response.data;
  }

  fetchChileSeed(): Promise<string> {
    return firstValueFrom(this.http.get(CHILE_SEED_URL, { responseType: 'text' }));
  }

  fetchTemplate(): Promise<string> {
    return firstValueFrom(
      this.http.get('/api/territorial-units/import/template', { responseType: 'text' }),
    );
  }

  async list(page = 1, pageSize = 500): Promise<{ units: TerritorialUnit[]; meta: PageMeta }> {
    const response = await firstValueFrom(
      this.http.get<ApiEnvelope<TerritorialUnit[]>>('/api/territorial-units', {
        params: { page, pageSize },
      }),
    );
    return { units: response.data, meta: response.meta as PageMeta };
  }

  async setActive(id: string, active: boolean): Promise<TerritorialUnit> {
    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<TerritorialUnit>>(`/api/territorial-units/${id}`, { active }),
    );
    return response.data;
  }
}
