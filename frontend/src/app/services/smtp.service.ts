/**
 * File Purpose: frontend/src/app/services/smtp.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Configuración SMTP
 * 
 * Funcionalidad:
 *   - Configurar email para notificaciones SOC (solo admin)
 *   - Test de configuración antes de guardar
 *   - UI estilo Passbolt (provider, auth, advanced, sender, recipients)
 * 
 * Endpoints:
 *   - GET  /api/smtp      - Obtener config (sin password)
 *   - POST /api/smtp      - Guardar config (password cifrado AES-256)
 *   - POST /api/smtp/test - Enviar email de prueba (rate limited 3/15min)
 * 
 * Providers soportados:
 *   - Office 365, AWS SES, Elastic Email, Google Mail/Workspace, Mailgun, Custom
 * 
 * Uso SOC:
 *   - Notificaciones automáticas al registrar check con servicios rojos
 *   - Admin configura desde /main/settings
 *   - Password NUNCA se retorna (seguridad backend)
 * 
 * Seguridad:
 *   - Password cifrado con AES-256-GCM en backend
 *   - Rate limit en test: prevenir abuso como relay SMTP
 */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { SmtpConfig, SmtpConfigRequest, SmtpTestResponse } from '../models/smtp.model';

@Injectable({
  providedIn: 'root'
})
export class SmtpService {
  private readonly API_URL = `${environment.apiUrl}/smtp`;

  constructor(private http: HttpClient) {}

  getConfig(): Observable<SmtpConfig | null> {
    return this.http.get<SmtpConfig | null>(this.API_URL);
  }

  getStoredPassword(): Observable<{ password: string }> {
    return this.http.get<{ password: string }>(`${this.API_URL}/password`);
  }

  saveConfig(data: SmtpConfigRequest): Observable<{ message: string; config: SmtpConfig }> {
    return this.http.post<{ message: string; config: SmtpConfig }>(this.API_URL, data);
  }

  testConfig(data: SmtpConfigRequest): Observable<SmtpTestResponse> {
    return this.http.post<SmtpTestResponse>(`${this.API_URL}/test`, data);
  }
}
