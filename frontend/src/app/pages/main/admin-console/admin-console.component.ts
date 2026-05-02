/**
 * File Purpose: frontend/src/app/pages/main/admin-console/admin-console.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgFor } from '@angular/common';

/*
 * QA — consola admin (solo navegación):
 * Esta pantalla lista enlaces; la autorización real está en guards + APIs (`authenticate` / `authorize` en backend).
 * Matriz sugerida: usuario estándar no debe obtener 200 en rutas /api/admin/* aunque adivine la URL del front.
 */

@Component({
  selector: 'app-admin-console',
  templateUrl: './admin-console.component.html',
  styleUrls: ['./admin-console.component.scss'],
  imports: [NgFor, RouterLink, RouterLinkActive, RouterOutlet]
})
export class AdminConsoleComponent {
  readonly sections = [
    { label: 'Usuarios', route: '/main/admin/users' },
    { label: 'Checklist', route: '/main/admin/checklist' },
    { label: 'Turnos', route: '/main/admin/work-shifts' },
    { label: 'Catálogos', route: '/main/admin/catalogs' },
    { label: 'Escalación', route: '/main/admin/escalation' },
    { label: 'EMAIL Config', route: '/main/admin/smtp' },
    { label: 'HTTPS / Seguridad', route: '/main/admin/security' },
    { label: 'Integraciones', route: '/main/admin/integrations' },
    { label: 'GLPI', route: '/main/admin/glpi' },
    { label: 'Complementos', route: '/main/admin/complements' }
  ];
}
