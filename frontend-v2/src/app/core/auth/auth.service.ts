import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, AuthUser, LoginResult } from './auth.models';

const TOKEN_STORAGE_KEY = 'bitacorasoc.token';

/**
 * Estado de sesión con Signals nativos (spec/06-frontend-arquitectura-y-ui.md
 * sección 7, DIP): los componentes inyectan este servicio, nunca HttpClient
 * directo. El JWT se persiste en localStorage (sobrevive a un F5, se pierde
 * si el usuario limpia el sitio — aceptable para una sesión de trabajo, no
 * es un dato de negocio).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(readStoredToken());
  private readonly _user = signal<AuthUser | null>(null);

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);

  async login(username: string, password: string): Promise<LoginResult> {
    const response = await firstValueFrom(
      this.http.post<ApiEnvelope<LoginResult>>('/api/auth/login', { username, password }),
    );
    this.applyLoginResult(response.data);
    return response.data;
  }

  async mfaAuthenticate(tempToken: string, code: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<ApiEnvelope<{ token: string }>>('/api/auth/mfa/authenticate', { tempToken, code }),
    );
    this.setToken(response.data.token);
  }

  /** POST /api/auth/forgot-password — responde igual exista o no la cuenta. */
  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/forgot-password', { email }));
  }

  async loadMe(): Promise<AuthUser> {
    const response = await firstValueFrom(this.http.get<ApiEnvelope<AuthUser>>('/api/users/me'));
    this._user.set(response.data);
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // Si el logout en el backend falla (ej. token ya vencido), igual se
      // limpia la sesión local — el usuario ya está saliendo.
    }
    this.clearSession();
    this.router.navigateByUrl('/login');
  }

  /**
   * Adopta un JWT emitido por otra vía que no es login — hoy solo
   * POST /api/setup/bootstrap, que ya devuelve la sesión del admin recién
   * creado (el wizard sigue con el paso de territorio sin pedir login).
   */
  acceptToken(token: string): void {
    this.setToken(token);
  }

  private applyLoginResult(result: LoginResult): void {
    if ('token' in result) {
      this.setToken(result.token);
    }
  }

  private setToken(token: string): void {
    this._token.set(token);
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // Storage bloqueado (modo privado, etc.) — la sesión igual funciona en
      // memoria para esta pestaña.
    }
  }

  private clearSession(): void {
    this._token.set(null);
    this._user.set(null);
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ver setToken().
    }
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}
