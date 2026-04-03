import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgFor } from '@angular/common';

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
    { label: 'SMTP / Config', route: '/main/admin/smtp' },
    { label: 'HTTPS / Seguridad', route: '/main/admin/security' },
    { label: 'Integraciones', route: '/main/admin/integrations' },
    { label: 'GLPI', route: '/main/admin/glpi' },
    { label: 'Complementos', route: '/main/admin/complements' }
  ];
}
