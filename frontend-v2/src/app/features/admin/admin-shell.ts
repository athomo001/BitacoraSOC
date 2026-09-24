import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { AdminModulesComponent } from './admin-modules';
import { AdminFeaturesComponent } from './admin-features';
import { AdminTerritoryComponent } from './admin-territory';
import { AdminOrganizationsComponent } from './admin-organizations';
import { AdminTeamsComponent } from './admin-teams';
import { AdminEscalationComponent } from './admin-escalation';
import { AdminSmtpComponent } from './admin-smtp';
import { AdminShiftsComponent } from './admin-shifts';
import { AdminBackupsComponent } from './admin-backups';
import { AdminAuditComponent } from './admin-audit';

type AdminTab = 'modules' | 'features' | 'territory' | 'organizations' | 'teams' | 'escalation' | 'smtp' | 'shifts' | 'backups' | 'audit';

const TABS: readonly { id: AdminTab; label: string }[] = [
  { id: 'modules', label: 'Módulos' },
  { id: 'features', label: 'Funcionalidades' },
  { id: 'territory', label: 'Territorio' },
  { id: 'organizations', label: 'Organizaciones' },
  { id: 'teams', label: 'Equipos' },
  { id: 'escalation', label: 'Escalamiento' },
  { id: 'shifts', label: 'Turnos' },
  { id: 'smtp', label: 'Correo' },
  { id: 'backups', label: 'Respaldos' },
  { id: 'audit', label: 'Auditoría' },
];

/**
 * Sección maestra Administración (Alt+5). Pestañas contextuales
 * horizontales dentro de la sección — la barra lateral sigue con 1 solo
 * nivel (spec/06-frontend-arquitectura-y-ui.md sección 3). Pestañas en
 * tokens neutros, nunca un color por pestaña (regla 1.2). Las fases
 * siguientes agregan sus pestañas acá (usuarios, grupos, SMTP…).
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [AdminModulesComponent, AdminFeaturesComponent, AdminTerritoryComponent, AdminOrganizationsComponent, AdminTeamsComponent, AdminEscalationComponent, AdminShiftsComponent, AdminSmtpComponent, AdminBackupsComponent, AdminAuditComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="admin">
      <h1 class="admin__title">Administración</h1>
      <div class="admin__tabs" role="tablist">
        @for (tab of tabs; track tab.id) {
          <button type="button" role="tab" class="admin__tab" [class.admin__tab--active]="active() === tab.id"
            [attr.aria-selected]="active() === tab.id" (click)="active.set(tab.id)">
            {{ tab.label }}
          </button>
        }
      </div>
      <div class="admin__body">
        @switch (active()) {
          @case ('modules') { <app-admin-modules /> }
          @case ('features') { <app-admin-features /> }
          @case ('territory') { <app-admin-territory /> }
          @case ('organizations') { <app-admin-organizations /> }
          @case ('teams') { <app-admin-teams /> }
          @case ('escalation') { <app-admin-escalation /> }
          @case ('shifts') { <app-admin-shifts /> }
          @case ('smtp') { <app-admin-smtp /> }
          @case ('backups') { <app-admin-backups /> }
          @case ('audit') { <app-admin-audit /> }
        }
      </div>
    </div>
  `,
  styles: `
    .admin {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 1100px;
      padding: 24px;
    }
    .admin__title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .admin__tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .admin__tab {
      min-height: var(--row-height);
      padding: 0 14px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-secondary);
      font: inherit;
      cursor: pointer;
    }
    .admin__tab:hover {
      color: var(--text-primary);
    }
    .admin__tab--active {
      color: var(--text-primary);
      border-bottom-color: var(--border-active);
    }
  `,
})
export class AdminShellComponent {
  protected readonly tabs = TABS;
  protected readonly active = signal<AdminTab>('modules');
}
