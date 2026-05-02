/**
 * File Purpose: frontend/src/app/services/user.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Gestión de Usuarios
 * 
 * Funcionalidad:
 *   - CRUD de usuarios (solo admin)
 *   - Perfil del usuario actual
 * 
 * Endpoints Admin:
 *   - GET    /api/users     - Listar todos los usuarios
 *   - POST   /api/users     - Crear usuario (admin/user/guest)
 *   - PUT    /api/users/:id - Actualizar usuario
 *   - DELETE /api/users/:id - Eliminar usuario
 * 
 * Endpoints Usuario:
 *   - GET /api/users/me - Perfil del usuario autenticado
 *   - PUT /api/users/me - Actualizar perfil propio (theme, fullName)
 * 
 * Reglas SOC:
 *   - Solo admin puede crear/editar/eliminar usuarios
 *   - Guests NO pueden editar su perfil (managed by admin)
 *   - Passwords hasheados en backend (bcrypt 10 rounds)
 *   - Guest expiresAt: calculado según AppConfig
 * 
 * Uso:
 *   - Admin gestiona equipo desde /main/users
 *   - Users editan su propio perfil (fullName, theme)
 */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { User, CreateUserRequest, UpdateProfileRequest } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly API_URL = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  // Public list (for dropdowns, assignments)
  getUsersList(): Observable<User[]> {
    return this.http.get<User[]>(`${this.API_URL}/list`);
  }

  // Admin endpoints
  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(this.API_URL);
  }

  createUser(data: CreateUserRequest): Observable<{ message: string; user: User }> {
    return this.http.post<{ message: string; user: User }>(this.API_URL, data);
  }

  updateUser(id: string, data: Partial<User>): Observable<{ message: string; user: User }> {
    return this.http.put<{ message: string; user: User }>(`${this.API_URL}/${id}`, data);
  }

  deleteUser(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.API_URL}/${id}`);
  }

  // Current user endpoints
  getProfile(): Observable<User> {
    return this.http.get<User>(`${this.API_URL}/me`);
  }

  updateProfile(data: UpdateProfileRequest): Observable<{ message: string; user: User }> {
    return this.http.put<{ message: string; user: User }>(`${this.API_URL}/me`, data);
  }
}
