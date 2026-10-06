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
    // withComponentInputBinding: los `data` de cada ruta llegan como
    // @Input()/input() del componente sin código de resolución manual — así
    // las 5 secciones maestras comparten un solo PlaceholderComponent
    // (ver app.routes.ts) en vez de 5 archivos casi idénticos.
    provideRouter(routes, withComponentInputBinding()),
    // Marca (comentario del dueño #8): nombre, favicon y fuente del título desde el primer pintado.
    provideAppInitializer(() => inject(BrandingService).load()),
  ],
};
