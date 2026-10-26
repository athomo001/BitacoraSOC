import { Routes } from '@angular/router';

/** Rutas de los complementos, cargadas al entrar a una de ellas (app.routes.ts). */
export const COMPLEMENT_ROUTES: Routes = [
  // Una pestaña por complemento; el ítem del menú solo aparece con la funcionalidad encendida.
  { path: 'complements', loadComponent: () => import('./complements').then((module) => module.ComplementsComponent) },
  { path: 'complements/:slug', loadComponent: () => import('./complements').then((module) => module.ComplementsComponent) },
  // Página de un complemento en un módulo sin pestañas (10i, spec/11 §12).
  { path: 'm/:module/:slug/:id', loadComponent: () => import('./complement-page').then((module) => module.ComplementPageComponent) },
];
