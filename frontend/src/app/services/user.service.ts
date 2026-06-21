/**
 * File Purpose: frontend/src/app/services/user.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
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

  uploadAvatar(file: File): Observable<{ message: string; avatarUrl: string; user: User }> {
    const formData = new FormData();
    formData.append('avatar', file);
    return this.http.put<{ message: string; avatarUrl: string; user: User }>(`${this.API_URL}/me/avatar`, formData);
  }

  // Completa el flujo de configuración obligatoria inicial de contraseña y cumpleaños
  forceSetup(data: { newPassword?: string; birthday?: string }): Observable<{ message: string; user: User }> {
    return this.http.put<{ message: string; user: User }>(`${this.API_URL}/me/force-setup`, data);
  }

  // Fuerza de manera masiva el cambio de contraseña a todos los usuarios activos (excepto el administrador actual)
  forcePasswordChangeAll(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.API_URL}/force-password-change-all`, {});
  }
}
