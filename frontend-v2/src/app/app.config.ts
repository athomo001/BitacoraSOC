import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrandingService } from './core/branding/branding.service';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { tokenInterceptor } from './core/auth/token.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([tokenInterceptor])),
    // withComponentInputBinding: los `data` y parámetros de cada ruta llegan
    // como input() del componente sin código de resolución manual.
    provideRouter(routes, withComponentInputBinding()),
    // Marca (comentario del dueño #8): nombre, favicon y fuente del título desde el primer pintado.
    provideAppInitializer(() => inject(BrandingService).load()),
  ],
};
