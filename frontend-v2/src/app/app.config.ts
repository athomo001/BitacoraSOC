import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: los `data` de cada ruta llegan como
    // @Input()/input() del componente sin código de resolución manual — así
    // las 5 secciones maestras comparten un solo PlaceholderComponent
    // (ver app.routes.ts) en vez de 5 archivos casi idénticos.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
