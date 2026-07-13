/**
 * File Purpose: frontend/src/app/services/entry.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Entradas de Bitácora
 * 
 * Funcionalidad:
 *   - CRUD de entradas (operativas/incidentes)
 *   - Búsqueda y filtrado (query, tipo, tags, rango fechas)
 *   - Paginación (page, limit)
 *   - Autocomplete de tags
 * 
 * Endpoints:
 *   - GET    /api/entries - Lista con filtros + paginación
 *   - POST   /api/entries - Crear entrada
 *   - PUT    /api/entries/:id - Actualizar entrada
 *   - DELETE /api/entries/:id - Eliminar entrada (admin/user)
 *   - GET    /api/entries/tags/suggest - Autocomplete tags
 * 
 * Filtros:
 *   - query: full-text search en content (MongoDB text index)
 *   - entryType: operativa | incidente
 *   - tags: array de tags (AND logic)
 *   - startDate/endDate: rango de createdAt
 * 
 * Uso SOC:
 *   - Analistas registran incidentes/actividades operativas
 *   - Tags (#vulnerabilidad, #firewall) para categorización
 *   - Guests solo pueden ver, no crear/editar/eliminar
 */
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  Entry,
  CreateEntryRequest,
  EntriesResponse,
  EntryFilters,
  TagSuggestion
} from '../models/entry.model';

@Injectable({
  providedIn: 'root'
})
export class EntryService {
  private readonly API_URL = `${environment.apiUrl}/entries`;

  constructor(private http: HttpClient) {}

  createEntry(data: CreateEntryRequest): Observable<{ message: string; entry: Entry }> {
    return this.http.post<{ message: string; entry: Entry }>(this.API_URL, data);
  }

  getEntries(filters: EntryFilters = {}): Observable<EntriesResponse> {
    let params = new HttpParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, value.toString());
      }
    });

    return this.http.get<EntriesResponse>(this.API_URL, { params });
  }

  getEntryById(id: string): Observable<Entry> {
    return this.http.get<Entry>(`${this.API_URL}/${id}`);
  }

  updateEntry(id: string, data: Partial<CreateEntryRequest>): Observable<{ message: string; entry: Entry }> {
    return this.http.put<{ message: string; entry: Entry }>(`${this.API_URL}/${id}`, data);
  }

  deleteEntry(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.API_URL}/${id}`);
  }

  suggestTags(query: string): Observable<TagSuggestion[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<TagSuggestion[]>(`${this.API_URL}/tags/suggest`, { params });
  }

  /**
   * Exporta las entradas filtradas en formato CSV
   * @param filters Filtros aplicados en la búsqueda
   * @returns Un observable que contiene el archivo blob tipo CSV
   */
  exportEntries(filters: EntryFilters = {}): Observable<Blob> {
    let params = new HttpParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, value.toString());
      }
    });

    return this.http.get(`${this.API_URL}/export`, {
      params,
      responseType: 'blob'
    });
  }

  /**
   * Edición masiva/individual de entradas por admin
   * Solo admin puede editar: tags, clientId, entryType
   * Campos inmutables: content, timestamp, author
   */
  adminEditEntries(
    entryIds: string[],
    updates: {
      tags?: string[];
      clientId?: string | null;
      entryType?: 'operativa' | 'incidente' | 'ofensa';
    }
  ): Observable<{ message: string; modifiedCount: number; matchedCount: number }> {
    return this.http.put<{ message: string; modifiedCount: number; matchedCount: number }>(
      `${this.API_URL}/admin/edit`,
      { entryIds, updates }
    );
  }
}
