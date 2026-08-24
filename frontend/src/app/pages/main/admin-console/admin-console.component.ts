/**
 * File Purpose: frontend/src/app/pages/main/admin-console/admin-console.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgFor } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

/*
 * QA — consola admin (solo navegación):
 * Esta pantalla lista enlaces; la autorización real está en guards + APIs (`authenticate` / `authorize` en backend).
 * Matriz sugerida: usuario estándar no debe obtener 200 en rutas /api/admin/* aunque adivine la URL del front.
 */

@Component({
  selector: 'app-admin-console',
  templateUrl: './admin-console.component.html',
  styleUrls: ['./admin-console.component.scss'],
  imports: [NgFor, RouterLink, RouterLinkActive, RouterOutlet, MatTabsModule, MatIconModule]
})
export class AdminConsoleComponent {
  // Mismo patrón que escalation-simple (mat-tab-nav-bar con ícono + texto, sin
  // banner de título grande) para ahorrar espacio vertical y verse consistente.
  readonly sections = [
    { label: 'Usuarios', route: '/main/admin/users', icon: 'group' },
    { label: 'Checklist', route: '/main/admin/checklist', icon: 'checklist' },
    { label: 'Turnos', route: '/main/admin/work-shifts', icon: 'schedule' },
    { label: 'Clientes y Catálogos', route: '/main/admin/catalogs', icon: 'business' },
    { label: 'Escalación', route: '/main/admin/escalation', icon: 'contact_phone' },
    // Configuración general de correo y envío de notificaciones
    { label: 'EMAIL Config', route: '/main/admin/smtp', icon: 'mail' },
    // Parámetros de certificados SSL/TLS y autenticación Single Sign-On (SSO)
    { label: 'Seguridad', route: '/main/admin/security', icon: 'security' },
    { label: 'Integraciones', route: '/main/admin/integrations', icon: 'hub' },
    { label: 'Complementos', route: '/main/admin/complements', icon: 'extension' }
  ];
}
