import { Routes } from '@angular/router';
import { ShellComponent } from './shell/shell';
import { authGuard } from './core/auth/auth.guard';
import { nocGuard, socOrNocGuard } from './core/setup/setup.guard';
import { setupCompletedGuard, setupPendingGuard } from './core/setup/setup.guard';

/**
 * Rutas del núcleo — las secciones maestras y la ticketera opcional bajo el
 * shell (spec/06-frontend-arquitectura-y-ui.md sección 3) + login fuera del
 * shell. Cada pantalla se carga al entrar (loadComponent).
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
  // Enlaces públicos (10h): guardias, Ticketera y Mapa en TV y el estado de un
  // cliente. Sin login ni shell; el token decide qué se ve.
  {
    path: 'p/v/:token',
    loadComponent: () =>
      import('./features/public-view/public-view').then((module) => module.PublicViewComponent),
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
      // Mapa (#24): localidades y sectores a revisar (módulo NOC).
      {
        path: 'map',
        canActivate: [nocGuard],
        loadComponent: () => import('./features/map/map').then((module) => module.MapComponent),
      },
      // Avisos con acuse (9.5): se abren desde la campana; la pantalla revisa el permiso.
      {
        path: 'notices',
        loadComponent: () => import('./features/notices/notices').then((module) => module.NoticesComponent),
      },
      // Agenda (9.3): tareas y recurrentes en días hábiles, para todos los perfiles.
      {
        path: 'agenda',
        loadComponent: () => import('./features/agenda/agenda').then((module) => module.AgendaComponent),
      },
      // Inventario (9.2): equipos por área.
      {
        path: 'inventory',
        loadComponent: () => import('./features/inventory/inventory').then((module) => module.InventoryComponent),
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
      // Gestión CSM (spec/16 §4.4, 9.4): Clientes, Metas, Indicadores y Plantillas. El backend decide quién la ve.
      {
        path: 'management',
        loadComponent: () => import('./features/management/management').then((module) => module.ManagementComponent),
      },
      // Mi equipo (spec/16 §3.5, 9d): la jefatura de área. El backend exige la capacidad.
      {
        path: 'team',
        loadComponent: () => import('./features/team/team').then((module) => module.TeamComponent),
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/admin-shell').then((module) => module.AdminShellComponent),
      },
      // Complementos (spec/11): /complements y /complements/:slug (una pestaña
      // por complemento) y /m/:módulo/:slug/:id (página de un complemento en
      // un módulo, 10i). Sus rutas viajan con su código, no en la carga inicial.
      { path: '', loadChildren: () => import('./features/complements/complement-routes').then((module) => module.COMPLEMENT_ROUTES) },
    ],
  },
  { path: '**', redirectTo: '' },
];
