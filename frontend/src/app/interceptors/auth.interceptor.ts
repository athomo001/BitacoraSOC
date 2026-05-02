/**
 * File Purpose: frontend/src/app/interceptors/auth.interceptor.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Interceptor de Autenticación HTTP
 * 
 * Funcionalidad:
 *   - Enviar cookies de sesión (`withCredentials`) en todas las requests
 *   - Manejar errores 401 (token inválido/expirado) con logout automático
 *   - Detectar backend offline (error 0) con mensaje descriptivo
 * 
 * Flujo:
 *   1. Intercepta TODA request HTTP saliente
 *   2. Clona request con `withCredentials: true`
 *   3. Si backend responde 401: ejecuta logout() + redirect a /login
 *   4. Si backend offline (status 0): muestra error de conectividad
 * 
 * Uso:
 *   - Configurado en app.module.ts providers
 *   - Transparente para servicios (no necesitan agregar header manualmente)
 *   - Previene múltiples logins: logout automático si JWT expira
 * 
 * Errores manejados:
 *   - 0: Network error (backend no disponible)
 *   - 401: Unauthorized (token inválido/expirado, guest expirado)
 */
import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly httpsRetryHeader = 'X-Https-Retry';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // QA: todas las llamadas envían cookies de sesión; sin esto el backend no verá `auth_token`.
    req = req.clone({ withCredentials: true });

    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        // Backend exige HTTPS y entrega URL objetivo
        if (error.status === 426) {
          const targetUrl = error?.error?.targetUrl;
          const alreadyRetried = req.headers.has(this.httpsRetryHeader);

          if (targetUrl && !alreadyRetried) {
            const httpsRequest = req.clone({
              url: targetUrl,
              withCredentials: true,
              headers: req.headers.set(this.httpsRetryHeader, '1')
            });

            return next.handle(httpsRequest);
          }
        }

        // Network error (backend unavailable)
        if (error.status === 0) {
          console.error('Backend no disponible. Verifica que el servidor esté corriendo.');
          return throwError(() => new Error('Backend no disponible. Intenta nuevamente más tarde.'));
        }

        if (error.status === 401) {
          // QA: durante bootstrap (`/users/me`) o init de sesión no forzar logout para evitar carrera al arrancar la app.
          const isSessionBootstrapRequest = req.url.includes('/users/me');
          const shouldSkipForcedLogout = isSessionBootstrapRequest || this.authService.isInitializingSession();

          if (!shouldSkipForcedLogout && this.authService.getCurrentUser()) {
            this.authService.logout();
          }
        }
        return throwError(() => error);
      })
    );
  }
}
