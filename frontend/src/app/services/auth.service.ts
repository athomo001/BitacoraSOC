/**
 * Servicio de Autenticación
 * 
 * Funcionalidad:
 *   - Login con JWT en cookie HttpOnly
 *   - Logout con limpieza de storage y redirect a /login
 *   - getCurrentUser() observable para cambios reactivos
 *   - Validación de roles (isAdmin, isGuest, hasRole)
 * 
 * Flujo:
 *   1. Login: POST /api/auth/login → backend guarda cookie HttpOnly + user en localStorage
 *   2. Interceptor: envía cookies con credenciales en todas las requests
 *   3. Guards: usan isAuthenticated() y hasRole() para proteger rutas
 *   4. Logout: limpia storage + navega a /login
 * 
 * Storage:
 *   - bitacora_user: JSON serializado del user
 * 
 * Roles SOC:
 *   - admin: Acceso total
 *   - user: Analista SOC (sin admin functions)
 *   - guest: Solo lectura (no puede crear entradas ni checks)
 */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '@env/environment';
import { User, LoginRequest, LoginResponse } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = environment.apiUrl;
  private readonly USER_KEY = 'bitacora_user';

  private currentUserSubject = new BehaviorSubject<User | null>(this.getUserFromStorage());
  public currentUser$ = this.currentUserSubject.asObservable();
  private sessionInitializedSubject = new BehaviorSubject<boolean>(false);
  public sessionInitialized$ = this.sessionInitializedSubject.asObservable();
  private initializingSession = false;

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  async initializeSession(): Promise<void> {
    if (this.sessionInitializedSubject.value || this.initializingSession) {
      return;
    }

    this.initializingSession = true;

    try {
      const user = await firstValueFrom(this.http.get<User>(`${this.API_URL}/users/me`, { withCredentials: true }));
      this.setUser(user);
      this.currentUserSubject.next(user);
    } catch {
      localStorage.removeItem(this.USER_KEY);
      this.currentUserSubject.next(null);
    } finally {
      this.initializingSession = false;
      this.sessionInitializedSubject.next(true);
    }
  }

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.API_URL}/auth/login`, credentials, { withCredentials: true })
      .pipe(
        tap(response => {
          console.log('[AuthService] Login response:', response);
          console.log('[AuthService] User role:', response.user.role);
          this.setUser(response.user);
          this.currentUserSubject.next(response.user);
          console.log('[AuthService] User saved to localStorage');
          console.log('[AuthService] Current user now:', this.getCurrentUser());
        })
      );
  }

  logout(): void {
    this.http.post(`${this.API_URL}/auth/logout`, {}, { withCredentials: true }).subscribe({
      error: () => {
      }
    });
    localStorage.removeItem(this.USER_KEY);
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  isAuthenticated(): boolean {
    return !!this.getCurrentUser();
  }

  isSessionInitialized(): boolean {
    return this.sessionInitializedSubject.value;
  }

  isInitializingSession(): boolean {
    return this.initializingSession;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  updateCurrentUser(user: User): void {
    this.setUser(user);
    this.currentUserSubject.next(user);
  }

  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.role === 'admin';
  }

  isGuest(): boolean {
    const user = this.getCurrentUser();
    return user?.role === 'guest';
  }

  hasRole(...roles: string[]): boolean {
    const user = this.getCurrentUser();
    return user ? roles.includes(user.role) : false;
  }
  forgotPassword(email: string): Observable<{ message: string; resetToken?: string; resetUrl?: string }> {
    return this.http.post<{ message: string; resetToken?: string; resetUrl?: string }>(
      `${this.API_URL}/auth/forgot-password`,
      { email }
    );
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.API_URL}/auth/reset-password`,
      { token, newPassword }
    );
  }
  private setUser(user: User): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  private getUserFromStorage(): User | null {
    const userStr = localStorage.getItem(this.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
  }
}
