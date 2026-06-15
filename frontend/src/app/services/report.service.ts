/**
 * File Purpose: frontend/src/app/services/report.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Reportes y Análisis
 * 
 * Funcionalidad:
 *   - Dashboard con KPIs y métricas SOC (solo admin)
 *   - Exportación de entradas a CSV
 * 
 * Endpoints:
 *   - GET /api/reports/overview       - KPIs agregados (últimos N días)
 *   - GET /api/reports/export-entries - CSV de entradas (rango fechas)
 * 
 * KPIs Calculados:
 *   - Entradas por tipo (operativa/incidente)
 *   - Incidentes por analista (top 10)
 *   - Tags más usados (top 15)
 *   - Servicios con rojos (frecuencia)
 *   - Tendencia temporal (series por día)
 *   - Total usuarios activos
 *   - Total checks de turno
 * 
 * Uso SOC:
 *   - Admin monitorea operación desde /main/reports
 *   - Identificar analistas más activos, tags recurrentes, servicios problemáticos
 *   - Exports para auditorías externas o backups offline
 */
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { MailAnalytics, ReportOverview, TagStats, PeriodSummaryReport } from '../models/report.model';

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
}
