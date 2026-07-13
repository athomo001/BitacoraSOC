/**
 * File Purpose: frontend/src/app/services/report.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { MailAnalytics, ReportOverview, PeriodSummaryReport } from '../models/report.model';

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private readonly API_URL = `${environment.apiUrl}/reports`;

  constructor(private http: HttpClient) {}

  getOverview(days = 30): Observable<ReportOverview> {
    const params = new HttpParams().set('days', days.toString());
    return this.http.get<ReportOverview>(`${this.API_URL}/overview`, { params });
  }

  exportEntries(startDate?: string, endDate?: string): Observable<Blob> {
    let params = new HttpParams();
    if (startDate) params = params.set('startDate', startDate);
    if (endDate) params = params.set('endDate', endDate);

    return this.http.get(`${this.API_URL}/export-entries`, {
      params,
      responseType: 'blob'
    });
  }

  getTagsTrend(tags: string[], days = 30): Observable<any[]> {
    let params = new HttpParams().set('days', days.toString());
    tags.forEach(tag => {
      params = params.append('tags', tag);
    });
    return this.http.get<any[]>(`${this.API_URL}/tags-trend`, { params });
  }

  getHeatmapData(days = 30): Observable<any[]> {
    const params = new HttpParams().set('days', days.toString());
    return this.http.get<any[]>(`${this.API_URL}/heatmap`, { params });
  }

  getEntriesByLogSource(days = 30): Observable<any[]> {
    const params = new HttpParams().set('days', days.toString());
    return this.http.get<any[]>(`${this.API_URL}/entries-by-logsource`, { params });
  }

  getMailAnalytics(days = 30): Observable<MailAnalytics> {
    const params = new HttpParams().set('days', days.toString());
    return this.http.get<MailAnalytics>(`${this.API_URL}/mail-analytics`, { params });
  }

  /**
   * Obtiene el resumen consolidado analítico y narrativo para un rango de fechas.
   * @param startDate Fecha de inicio (formato ISO)
   * @param endDate Fecha de fin (formato ISO)
   */
  getPeriodSummary(startDate: string, endDate: string): Observable<PeriodSummaryReport> {
    const params = new HttpParams()
      .set('startDate', startDate)
      .set('endDate', endDate);
    return this.http.get<PeriodSummaryReport>(`${this.API_URL}/period-summary`, { params });
  }

  /**
   * Obtiene las estadísticas de uso y el análisis de calidad de los analistas.
   * @param days Cantidad de días del período analizado
   * @param userId ID del usuario específico o 'all' para todos
   */
  getUserStats(days = 30, userId = 'all', includeAllUsers = false): Observable<any> {
    const params = new HttpParams()
      .set('days', days.toString())
      .set('userId', userId)
      .set('includeAllUsers', includeAllUsers.toString());
    return this.http.get<any>(`${this.API_URL}/user-stats`, { params });
  }
}
