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
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly httpsRetryHeader = 'X-Https-Retry';
  private isRefreshing = false;
  private refreshTokenSubject = new BehaviorSubject<any>(null);

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
          const isSessionBootstrapRequest = req.url.includes('/users/me');
          const isAuthRefreshRequest = req.url.includes('/auth/refresh');
          const isAuthLoginRequest = req.url.includes('/auth/login');
          const shouldSkipForcedLogout = isSessionBootstrapRequest || this.authService.isInitializingSession();

          // 🛡️ Evitar bucles infinitos de redirección si el error 401 ocurre en el endpoint de refresh o login
          if (isAuthRefreshRequest || isAuthLoginRequest) {
            this.authService.logout();
            return throwError(() => error);
          }

          if (!shouldSkipForcedLogout && this.authService.getCurrentUser()) {
            return this.handle401Error(req, next);
          }
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Maneja el refresco silencioso del token al recibir un error 401.
   * Encola peticiones concurrentes y las reintenta tras renovar la sesión.
   */
  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      // 🔄 Invocar endpoint de renovación de sesión en el backend
      return this.authService.refreshSession().pipe(
        switchMap((res: any) => {
          this.isRefreshing = false;
          this.refreshTokenSubject.next(res.token || true);
          
          // 🔁 Reintentar la solicitud original con las credenciales actualizadas
          return next.handle(request.clone({ withCredentials: true }));
        }),
        catchError((refreshError) => {
          this.isRefreshing = false;
          // 🚪 Si el refresco silencioso falla, forzar logout y desviar al analista
          this.authService.logout();
          return throwError(() => refreshError);
        })
      );
    } else {
      // ⏳ Si ya se está procesando un refresco, encolar hasta que se complete
      return this.refreshTokenSubject.pipe(
        filter(token => token !== null),
        take(1),
        switchMap(() => {
          return next.handle(request.clone({ withCredentials: true }));
        })
      );
    }
  }
}
