import { Routes } from '@angular/router';
import { ShellComponent } from './shell/shell';
import { authGuard } from './core/auth/auth.guard';
import { setupCompletedGuard, setupPendingGuard } from './core/setup/setup.guard';

/**
 * Rutas del núcleo — 5 secciones maestras bajo el shell (spec/06-frontend-
 * arquitectura-y-ui.md sección 3) + login fuera del shell. Todas apuntan a
 * PlaceholderComponent por ahora (Fase 3: sin lógica de negocio, sin HTTP
 * real) — cada fase posterior reemplaza su placeholder por la pantalla real,
 * sin tocar la estructura de rutas.
 *
 * Fase 5 (HU-0): setupCompletedGuard va primero en todo — mientras no haya
 * setup, cualquier ruta (incluida una inexistente, vía el comodín final)
 * termina en /setup.
 */
export const routes: Routes = [
  {
    path: 'setup',
    canActivate: [setupPendingGuard],
    loadComponent: () =>
      import('./features/setup/setup-wizard').then((module) => module.SetupWizardComponent),
  },
  {
    path: 'login',
    canActivate: [setupCompletedGuard],
    loadComponent: () =>
      import('./features/login/login.component').then((module) => module.LoginComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [setupCompletedGuard, authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'entries' },
      {
        path: 'entries',
        loadComponent: () => import('./features/entries/entries').then((module) => module.EntriesComponent),
      },
      {
        path: 'shifts',
        loadComponent: () => import('./features/shifts/shifts').then((module) => module.ShiftsComponent),
      },
      {
        path: 'escalation',
        loadComponent: () =>
          import('./features/escalation/escalation').then((module) => module.EscalationComponent),
      },
      {
        path: 'directory',
        loadComponent: () =>
          import('./features/directory/directory').then((module) => module.DirectoryComponent),
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/admin-shell').then((module) => module.AdminShellComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
