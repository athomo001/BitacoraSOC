/**
 * File Purpose: frontend/src/app/services/shift-closure.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { ShiftClosure, ShiftClosureRequest } from '../models/shift-closure.model';

@Injectable({
  providedIn: 'root'
})
export class ShiftClosureService {
  private readonly API_URL = `${environment.apiUrl}/checklist`;

  constructor(private http: HttpClient) {}

  // Registrar cierre de turno (B2m)
  createClosure(data: ShiftClosureRequest): Observable<{ message: string; closure: ShiftClosure }> {
    return this.http.post<{ message: string; closure: ShiftClosure }>(`${this.API_URL}/closure`, data);
  }

  // Obtener cierres de turno del usuario
  getClosures(limit = 10, page = 1): Observable<{ closures: ShiftClosure[]; pagination: any }> {
    const params = new HttpParams()
      .set('limit', limit.toString())
      .set('page', page.toString());
    return this.http.get<{ closures: ShiftClosure[]; pagination: any }>(`${this.API_URL}/closures`, { params });
  }
}
