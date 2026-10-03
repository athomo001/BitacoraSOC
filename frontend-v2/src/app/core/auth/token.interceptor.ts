import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Agrega Authorization: Bearer <jwt> a toda request /api/* — un solo lugar,
 * ningún feature arma el header a mano (spec/06-frontend-arquitectura-y-ui.md
 * sección 7, DIP). Si el servidor dice que la sesión ya no vale, se cierra y
 * se vuelve al login.
 */
export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();

  if (!token || !req.url.startsWith('/api/')) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(
    catchError((error: unknown) => {
      if (isSessionRejected(error)) auth.expireSession();
      return throwError(() => error);
    }),
  );
};

/**
 * 401 por la sesión (token ausente, inválido, vencido o revocado). Un 401 por
 * una contraseña o un código mal escritos ("invalid-credentials",
 * "invalid-code") no cierra la sesión.
 */
export function isSessionRejected(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 401) return false;
  const type: unknown = (error.error as { type?: unknown } | null)?.type;
  return typeof type === 'string' && /\/(missing-token|invalid-token|revoked-token)$/.test(type);
}
