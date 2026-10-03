import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Redirige a /login si no hay sesión — se aplica al shell completo. Tener un
 * token guardado no basta: antes de mostrar el shell se confirma con el
 * servidor (GET /api/users/me). Un token vencido o inválido nunca deja ver la
 * app, ni siquiera vacía.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  if (auth.user()) {
    return true;
  }
  try {
    await auth.loadMe();
    return true;
  } catch (error) {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
      auth.expireSession();
    }
    return router.createUrlTree(['/login']);
  }
};
