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
import { environment } from '@env/environment';
import { AppConfig, UpdateConfigRequest } from '../models/config.model';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private readonly API_URL = `${environment.apiUrl}/config`;

  constructor(private http: HttpClient) {}

  getConfig(): Observable<AppConfig> {
    return this.http.get<AppConfig>(this.API_URL);
  }

  updateConfig(data: UpdateConfigRequest): Observable<{ message: string; config: AppConfig }> {
    return this.http.put<{ message: string; config: AppConfig }>(this.API_URL, data);
  }

  uploadLogo(file: File): Observable<{ message: string; logoUrl: string }> {
    const formData = new FormData();
    formData.append('logo', file);
    return this.http.post<{ message: string; logoUrl: string }>(`${this.API_URL}/logo`, formData);
  }

  getLogo(): Observable<{ logoUrl: string }> {
    return this.http.get<{ logoUrl: string }>(`${this.API_URL}/logo`);
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
}
