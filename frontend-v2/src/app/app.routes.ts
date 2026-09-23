import { Routes } from '@angular/router';
import { ShellComponent } from './shell/shell';
import { PlaceholderComponent } from './shared/ui/placeholder/placeholder';

/**
 * Rutas del núcleo — 5 secciones maestras bajo el shell (spec/06-frontend-
 * arquitectura-y-ui.md sección 3) + login fuera del shell. Todas apuntan a
 * PlaceholderComponent por ahora (Fase 3: sin lógica de negocio, sin HTTP
 * real) — cada fase posterior reemplaza su placeholder por la pantalla real,
 * sin tocar la estructura de rutas.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login-shell').then((module) => module.LoginShellComponent),
  },
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'entries' },
      {
        path: 'entries',
        component: PlaceholderComponent,
        data: { title: 'Bitácora', builtInPhase: 'la Fase 9' },
      },
      {
        path: 'shifts',
        component: PlaceholderComponent,
        data: { title: 'Turnos y Checklist', builtInPhase: 'las Fases 8 y 11' },
      },
      {
        path: 'escalation',
        component: PlaceholderComponent,
        data: { title: 'Escalamiento / Despacho', builtInPhase: 'la Fase 7' },
      },
      {
        path: 'directory',
        component: PlaceholderComponent,
        data: { title: 'Directorio', builtInPhase: 'la Fase 6' },
      },
      {
        path: 'admin',
        component: PlaceholderComponent,
        data: { title: 'Administración', builtInPhase: 'las Fases 4-13' },
      },
    ],
  },
];
