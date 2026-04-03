import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuditLog, AuditLogFilters, AuditLogResponse, AuditStats } from '../models/audit-log.model';

@Injectable({
  providedIn: 'root'
})
export class AuditLogService {
  private apiUrl = `${environment.apiUrl}/audit-logs`;

  constructor(private http: HttpClient) { }

  getAuditLogs(filters: AuditLogFilters = {}): Observable<AuditLogResponse> {
    let params = new HttpParams();

    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    if (filters.category) params = params.set('category', filters.category);
    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.event) params = params.set('event', filters.event);
    if (filters.level) params = params.set('level', filters.level);
    if (filters.startDate) params = params.set('startDate', filters.startDate);
    if (filters.endDate) params = params.set('endDate', filters.endDate);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.sourceSlug) params = params.set('sourceSlug', filters.sourceSlug);

    return this.http.get<AuditLogResponse>(this.apiUrl, { params });
  }

  getEvents(): Observable<{ events: string[] }> {
    return this.http.get<{ events: string[] }>(`${this.apiUrl}/events`);
  }

  getStats(): Observable<AuditStats> {
    return this.http.get<AuditStats>(`${this.apiUrl}/stats`);
  }
}
