/**
 * File Purpose: frontend/src/app/services/note.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Notas (Admin y Personales)
 * 
 * Funcionalidad:
 *   - Nota Admin: única nota global visible para todos (solo admin edita)
 *   - Notas Personales: cada usuario tiene su propia nota (privada)
 *   - Autosave: componente main-layout guarda cada 3s automáticamente
 * 
 * Endpoints:
 *   - GET /api/notes/admin    - Obtener nota admin (todos)
 *   - PUT /api/notes/admin    - Actualizar nota admin (solo admin)
 *   - GET /api/notes/personal - Obtener nota personal del usuario actual
 *   - PUT /api/notes/personal - Actualizar nota personal
 * 
 * Uso SOC:
 *   - Admin Note: Anuncios/recordatorios para todo el equipo
 *   - Personal Note: Notas privadas del analista (tareas, recordatorios)
 *   - Guests NO tienen acceso a notas (ni admin ni personales)
 * 
 * Autosave:
 *   - debounceTime(3000): espera 3s sin cambios antes de guardar
 *   - distinctUntilChanged: solo guarda si el contenido realmente cambió
 */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { AdminNote, PersonalNote, UpdateNoteRequest } from '../models/note.model';

@Injectable({
  providedIn: 'root'
})
export class NoteService {
  private readonly API_URL = `${environment.apiUrl}/notes`;

  constructor(private http: HttpClient) {}

  // ========== NOTAS DEL ADMINISTRADOR ==========
  
  getAdminNote(): Observable<AdminNote> {
    return this.http.get<AdminNote>(`${this.API_URL}/admin`);
  }

  updateAdminNote(data: UpdateNoteRequest): Observable<{ message: string; note: AdminNote }> {
    return this.http.put<{ message: string; note: AdminNote }>(`${this.API_URL}/admin`, data);
  }

  // ========== NOTAS PERSONALES ==========
  
  getPersonalNote(): Observable<PersonalNote> {
    return this.http.get<PersonalNote>(`${this.API_URL}/personal`);
  }

  updatePersonalNote(data: UpdateNoteRequest): Observable<{ message: string; note: PersonalNote }> {
    return this.http.put<{ message: string; note: PersonalNote }>(`${this.API_URL}/personal`, data);
  }
}
