import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SetupService } from './setup.service';

/**
 * HU-0: mientras el setup inicial no se completó, cualquier ruta de la app
 * redirige a /setup. Si el backend no responde, deja pasar — la pantalla de
 * login mostrará el error real en vez de quedar en un bucle de redirección.
 */
export const setupCompletedGuard: CanActivateFn = async () => {
  const setup = inject(SetupService);
  const router = inject(Router);
  try {
    const status = await setup.loadStatus();
    return status.setupCompleted ? true : router.createUrlTree(['/setup']);
  } catch {
    return true;
  }
};

/** /setup solo existe mientras no haya setup — después, es /login. */
export const setupPendingGuard: CanActivateFn = async () => {
  const setup = inject(SetupService);
  const router = inject(Router);
  try {
    const status = await setup.loadStatus();
    return status.setupCompleted ? router.createUrlTree(['/login']) : true;
  } catch {
    return router.createUrlTree(['/login']);
  }
};
