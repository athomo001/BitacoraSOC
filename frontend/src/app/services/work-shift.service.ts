import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  WorkShift,
  WorkShiftFormData,
  CurrentShiftResponse,
  ReorderRequest,
  ShiftType
} from '../models/work-shift.model';

/**
 * Servicio de Turnos de Trabajo
 * 
 * Funcionalidad:
 *   - CRUD de turnos de trabajo (admin)
 *   - Consultar turno actual según hora
 *   - Listar turnos activos/inactivos
 *   - Reordenar turnos
 * 
 * Endpoints:
 *   - GET    /api/work-shifts              - Listar turnos
 *   - GET    /api/work-shifts/current      - Obtener turno actual
 *   - GET    /api/work-shifts/:id          - Obtener turno específico
 *   - POST   /api/work-shifts              - Crear turno (admin)
 *   - PUT    /api/work-shifts/:id          - Actualizar turno (admin)
 *   - DELETE /api/work-shifts/:id          - Eliminar turno (admin)
 *   - PUT    /api/work-shifts/reorder      - Reordenar turnos (admin)
 */

@Injectable({
  providedIn: 'root'
})
export class WorkShiftService {
  private apiUrl = `${environment.apiUrl}/work-shifts`;

  constructor(private http: HttpClient) { }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔍 CONSULTAS (todos los usuarios)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Listar todos los turnos
   * @param type - Filtrar por tipo (regular | emergency)
   * @param active - Filtrar por estado activo
   */
  getShifts(type?: ShiftType, active?: boolean): Observable<WorkShift[]> {
    let params = new HttpParams();

    if (type) {
      params = params.set('type', type);
    }

    if (active !== undefined) {
      params = params.set('active', active.toString());
    }

    return this.http.get<WorkShift[]>(this.apiUrl, { params });
  }

  /**
   * Obtener turno actual según hora del sistema
   */
  getCurrentShift(): Observable<CurrentShiftResponse> {
    return this.http.get<CurrentShiftResponse>(`${this.apiUrl}/current`);
  }

  /**
   * Obtener turno específico por ID
   */
  getShift(id: string): Observable<WorkShift> {
    return this.http.get<WorkShift>(`${this.apiUrl}/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 ADMINISTRACIÓN (solo admin)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Crear nuevo turno
   */
  createShift(data: WorkShiftFormData): Observable<WorkShift> {
    return this.http.post<WorkShift>(this.apiUrl, data);
  }

  /**
   * Actualizar turno existente
   */
  updateShift(id: string, data: Partial<WorkShiftFormData>): Observable<WorkShift> {
    return this.http.put<WorkShift>(`${this.apiUrl}/${id}`, data);
  }

  /**
   * Eliminar turno
   */
  deleteShift(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }

  /**
   * Reordenar turnos (drag & drop)
   */
  reorderShifts(request: ReorderRequest): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/reorder`, request);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🏢 ASIGNACIONES OPERATIVAS (OPS-ASSIGN)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getAssignments(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/assignments`);
  }

  createAssignment(data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/assignments`, data);
  }

  updateAssignment(id: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/assignments/${id}`, data);
  }

  deleteAssignment(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/assignments/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🛠️ UTILIDADES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Formatear hora para display
   */
  formatTime(time: string): string {
    return time; // Ya viene en formato HH:MM
  }

  /**
   * Obtener label del tipo de turno
   */
  getTypeLabel(type: ShiftType): string {
    return type === 'regular' ? 'Regular' : 'Emergencia';
  }

  /**
   * Validar si un turno cruza medianoche
   */
  crossesMidnight(startTime: string, endTime: string): boolean {
    return startTime > endTime;
  }

  /**
   * Formatear rango de horas para display
   */
  formatTimeRange(startTime: string, endTime: string): string {
    if (this.crossesMidnight(startTime, endTime)) {
      return `${startTime} - ${endTime} (cruza medianoche)`;
    }
    return `${startTime} - ${endTime}`;
  }
}
