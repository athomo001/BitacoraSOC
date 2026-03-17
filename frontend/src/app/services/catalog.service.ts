/**
 * 📚 Servicio de Catálogos
 * 
 * Servicio centralizado para búsqueda typeahead de catálogos grandes:
 *   - Eventos SOC (1900+ registros)
 *   - Log Sources / Clientes
 *   - Tipos de Operación
 * 
 * Performance:
 *   - Búsqueda server-side (no carga todo el catálogo)
 *   - Máximo 20 resultados por búsqueda
 *   - Soporte para cursor pagination (si se necesita load-more)
 * 
 * Uso:
 *   - Componente EntityAutocomplete usa estos métodos
 *   - RxJS switchMap cancela requests anteriores automáticamente
 */
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  CatalogEvent,
  CatalogLogSource,
  CatalogOperationType,
  CatalogSearchResponse
} from '../models/catalog.model';

@Injectable({
  providedIn: 'root'
})
export class CatalogService {
  private readonly API_URL = environment.apiUrl;

  constructor(private http: HttpClient) { }

  /**
   * Buscar eventos en catálogo (typeahead)
   * 
   * @param query Término de búsqueda
   * @param cursor Cursor para pagination (opcional)
   * @param limit Máximo de resultados (default 20)
   */
  searchEvents(
    query: string,
    cursor?: string,
    limit: number = 20
  ): Observable<CatalogSearchResponse<CatalogEvent>> {
    let params = new HttpParams()
      .set('search', query.trim())
      .set('enabled', 'true')
      .set('limit', limit.toString())
      .set('t', Date.now().toString());

    if (cursor) {
      params = params.set('cursor', cursor);
    }

    return this.http.get<CatalogSearchResponse<CatalogEvent>>(
      `${this.API_URL}/catalog/events`,
      { params }
    );
  }

  /**
   * Buscar log sources en catálogo (typeahead)
   * 
   * @param query Término de búsqueda
   * @param cursor Cursor para pagination (opcional)
   * @param limit Máximo de resultados (default 20)
   */
  searchLogSources(
    query: string,
    cursor?: string,
    limit: number = 20
  ): Observable<CatalogSearchResponse<CatalogLogSource>> {
    let params = new HttpParams()
      .set('search', query.trim())
      .set('enabled', 'true')
      .set('limit', limit.toString())
      .set('t', Date.now().toString());

    if (cursor) {
      params = params.set('cursor', cursor);
    }

    return this.http.get<CatalogSearchResponse<CatalogLogSource>>(
      `${this.API_URL}/catalog/log-sources`,
      { params }
    );
  }

  /**
   * Buscar tipos de operación en catálogo (typeahead)
   * 
   * @param query Término de búsqueda
   * @param cursor Cursor para pagination (opcional)
   * @param limit Máximo de resultados (default 20)
   */
  searchOperationTypes(
    query: string,
    cursor?: string,
    limit: number = 20
  ): Observable<CatalogSearchResponse<CatalogOperationType>> {
    let params = new HttpParams()
      .set('search', query.trim())
      .set('enabled', 'true')
      .set('limit', limit.toString())
      .set('t', Date.now().toString());

    if (cursor) {
      params = params.set('cursor', cursor);
    }

    return this.http.get<CatalogSearchResponse<CatalogOperationType>>(
      `${this.API_URL}/catalog/operation-types`,
      { params }
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MÉTODOS ADMIN (CRUD)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // EVENTOS
  getAllEvents(page: number = 1, limit: number = 50, search: string = ''): Observable<any> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (search) {
      params = params.set('search', search.trim());
    }

    return this.http.get(`${this.API_URL}/admin/catalog/events`, { params });
  }

  createEvent(data: Partial<CatalogEvent>): Observable<CatalogEvent> {
    return this.http.post<CatalogEvent>(`${this.API_URL}/admin/catalog/events`, data);
  }

  updateEvent(id: string, data: Partial<CatalogEvent>): Observable<CatalogEvent> {
    return this.http.put<CatalogEvent>(`${this.API_URL}/admin/catalog/events/${id}`, data);
  }

  deleteEvent(id: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/admin/catalog/events/${id}`);
  }

  // LOG SOURCES
  getAllLogSources(): Observable<any> {
    return this.http.get(`${this.API_URL}/admin/catalog/log-sources`);
  }

  createLogSource(data: Partial<CatalogLogSource>): Observable<CatalogLogSource> {
    return this.http.post<CatalogLogSource>(`${this.API_URL}/admin/catalog/log-sources`, data);
  }

  updateLogSource(id: string, data: Partial<CatalogLogSource>): Observable<CatalogLogSource> {
    return this.http.put<CatalogLogSource>(`${this.API_URL}/admin/catalog/log-sources/${id}`, data);
  }

  deleteLogSource(id: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/admin/catalog/log-sources/${id}`);
  }

  // OPERATION TYPES
  getAllOperationTypes(): Observable<any> {
    return this.http.get(`${this.API_URL}/admin/catalog/operation-types`);
  }

  createOperationType(data: Partial<CatalogOperationType>): Observable<CatalogOperationType> {
    return this.http.post<CatalogOperationType>(`${this.API_URL}/admin/catalog/operation-types`, data);
  }

  updateOperationType(id: string, data: Partial<CatalogOperationType>): Observable<CatalogOperationType> {
    return this.http.put<CatalogOperationType>(`${this.API_URL}/admin/catalog/operation-types/${id}`, data);
  }

  deleteOperationType(id: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/admin/catalog/operation-types/${id}`);
  }
}
