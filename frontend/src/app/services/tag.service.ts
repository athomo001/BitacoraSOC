/**
 * File Purpose: frontend/src/app/services/tag.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { TagStats } from '../models/report.model';

@Injectable({
  providedIn: 'root'
})
export class TagService {
  private readonly API_URL = `${environment.apiUrl}/tags`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<{ tags: TagStats[] }> {
    return this.http.get<{ tags: TagStats[] }>(`${this.API_URL}`);
  }

  getStats(): Observable<TagStats[]> {
    return this.http.get<TagStats[]>(`${this.API_URL}/stats`);
  }

  getList(): Observable<string[]> {
    return this.http.get<string[]>(`${this.API_URL}/list`);
  }

  suggest(query: string): Observable<TagStats[]> {
    return this.http.get<TagStats[]>(`${this.API_URL}/suggest`, {
      params: { q: query }
    });
  }

  rename(current: string, next: string): Observable<any> {
    return this.http.put(`${this.API_URL}/${encodeURIComponent(current)}`, { name: next });
  }

  delete(tag: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/${encodeURIComponent(tag)}`);
  }
}
