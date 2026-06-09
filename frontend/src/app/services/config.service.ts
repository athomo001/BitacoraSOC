/**
 * File Purpose: frontend/src/app/services/config.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Configuración Global
 * 
 * Funcionalidad:
 *   - Obtener/actualizar configuración SOC (solo admin)
 *   - Upload de logo personalizado
 * 
 * Endpoints:
 *   - GET  /api/config      - Obtener configuración actual
 *   - PUT  /api/config      - Actualizar configuración (admin)
 *   - POST /api/config/logo - Subir logo (admin, max 2MB)
 * 
 * Configuraciones SOC:
 *   - guestModeEnabled: Permitir creación de invitados
 *   - guestMaxDurationDays: Duración de cuentas guest (1-30 días)
 *   - shiftCheckCooldownHours: Tiempo mínimo entre checks (1-24h)
 *   - logoUrl/logoType: Personalización de branding
 * 
 * Uso:
 *   - Admin accede desde /main/settings
 *   - Cambios se aplican inmediatamente (sin reiniciar)
 *   - Logo se almacena en backend/uploads/logos/
 */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { environment } from '@env/environment';
import { AppConfig, UpdateConfigRequest, ShiftReminder } from '../models/config.model';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private readonly API_URL = `${environment.apiUrl}/config`;
  private logoCache$?: Observable<{ logoUrl: string; loginTheme?: string; appTitle?: string }>;

  constructor(private http: HttpClient) { }

  getConfig(): Observable<AppConfig> {
    return this.http.get<AppConfig>(this.API_URL);
  }

  updateConfig(data: UpdateConfigRequest): Observable<{ message: string; config: AppConfig }> {
    return this.http.put<{ message: string; config: AppConfig }>(this.API_URL, data);
  }

  uploadLogo(file: File): Observable<{ message: string; logoUrl: string }> {
    const formData = new FormData();
    formData.append('logo', file);
    return this.http.post<{ message: string; logoUrl: string }>(`${this.API_URL}/logo`, formData).pipe(
      tap(() => {
        // Invalidar caché de logo para forzar la recarga
        this.logoCache$ = undefined;
      })
    );
  }

  getLogo(forceRefresh = false): Observable<{ logoUrl: string; loginTheme?: string; appTitle?: string }> {
    if (!this.logoCache$ || forceRefresh) {
      this.logoCache$ = this.http.get<{ logoUrl: string; loginTheme?: string; appTitle?: string }>(`${this.API_URL}/logo`).pipe(
        shareReplay(1)
      );
    }
    return this.logoCache$;
  }

  getFavicon(): Observable<{ faviconUrl: string }> {
    return this.http.get<{ faviconUrl: string }>(`${this.API_URL}/favicon`);
  }

  uploadTlsCertificates(files: { cert?: File; key?: File; ca?: File }): Observable<{ message: string; security: AppConfig['security'] }> {
    const formData = new FormData();
    if (files.cert) {
      formData.append('tlsCert', files.cert);
    }
    if (files.key) {
      formData.append('tlsKey', files.key);
    }
    if (files.ca) {
      formData.append('tlsCa', files.ca);
    }

    return this.http.post<{ message: string; security: AppConfig['security'] }>(`${this.API_URL}/security/certificates`, formData);
  }

  resetTlsCertificates(): Observable<{ message: string; security: AppConfig['security'] }> {
    return this.http.delete<{ message: string; security: AppConfig['security'] }>(`${this.API_URL}/security/certificates`);
  }

  // ─── MAIL-REM-043: CRUD de recordatorios de turno ─────────────────────

  getShiftReminders(): Observable<ShiftReminder[]> {
    return this.http.get<ShiftReminder[]>(`${this.API_URL}/shift-reminders`);
  }

  createShiftReminder(data: Partial<ShiftReminder>): Observable<ShiftReminder> {
    return this.http.post<ShiftReminder>(`${this.API_URL}/shift-reminders`, data);
  }

  updateShiftReminder(id: string, data: Partial<ShiftReminder>): Observable<ShiftReminder> {
    return this.http.put<ShiftReminder>(`${this.API_URL}/shift-reminders/${id}`, data);
  }

  deleteShiftReminder(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.API_URL}/shift-reminders/${id}`);
  }
}
