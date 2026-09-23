import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Agrega Authorization: Bearer <jwt> a toda request /api/* — un solo lugar,
 * ningún feature arma el header a mano (spec/06-frontend-arquitectura-y-ui.md
 * sección 7, DIP).
 */
export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();

  if (!token || !req.url.startsWith('/api/')) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
