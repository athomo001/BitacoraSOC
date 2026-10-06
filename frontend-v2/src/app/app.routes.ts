import { Routes } from '@angular/router';
import { ShellComponent } from './shell/shell';
import { authGuard } from './core/auth/auth.guard';
import { socOrNocGuard } from './core/setup/setup.guard';
import { setupCompletedGuard, setupPendingGuard } from './core/setup/setup.guard';

/**
 * Rutas del núcleo — 5 secciones maestras y ticketera opcional bajo el shell (spec/06-frontend-
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
  // Seguimiento público del ticket (spec/06 §6.4): lo abre el cliente, sin
  // login ni shell, por eso va sin guards.
  {
    path: 'p/tickets/:token',
    loadComponent: () =>
      import('./features/tickets/public-ticket').then((module) => module.PublicTicketComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [setupCompletedGuard, authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'entries' },
      {
        path: 'entries',
        canActivate: [socOrNocGuard],
        loadComponent: () => import('./features/entries/entries').then((module) => module.EntriesComponent),
      },
      {
        path: 'tickets',
        loadComponent: () => import('./features/tickets/tickets').then((module) => module.TicketsComponent),
      },
      {
        path: 'shifts',
        canActivate: [socOrNocGuard],
        loadComponent: () => import('./features/shifts/shifts').then((module) => module.ShiftsComponent),
      },
      {
        path: 'escalation',
        // Con solo la Ticketera no hay Bitácora, Turnos ni Escalamiento (este
        // último es por servicio SOC o activo/zona NOC): socOrNocGuard lleva a
        // la Ticketera.
        canActivate: [socOrNocGuard],
        loadComponent: () =>
          import('./features/escalation/escalation').then((module) => module.EscalationComponent),
      },
      {
        path: 'reports',
        loadComponent: () => import('./features/reports/reports').then((module) => module.ReportsComponent),
      },
      {
        path: 'directory',
        loadComponent: () =>
          import('./features/directory/directory').then((module) => module.DirectoryComponent),
      },
      // Complementos (spec/11): una pestaña por complemento; el ítem del menú
      // solo aparece con la funcionalidad encendida.
      {
        path: 'complements',
        loadComponent: () =>
          import('./features/complements/complements').then((module) => module.ComplementsComponent),
      },
      {
        path: 'complements/:slug',
        loadComponent: () =>
          import('./features/complements/complements').then((module) => module.ComplementsComponent),
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
