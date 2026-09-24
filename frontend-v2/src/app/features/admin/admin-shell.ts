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
import { AdminAccessComponent } from './admin-access';
import { AdminReportsComponent } from './admin-reports';

type AdminTab = 'modules' | 'features' | 'territory' | 'organizations' | 'teams' | 'escalation' | 'smtp' | 'shifts' | 'reports' | 'backups' | 'audit' | 'access';

const TABS: readonly { id: AdminTab; label: string }[] = [
  { id: 'modules', label: 'Módulos' },
  { id: 'features', label: 'Funcionalidades' },
  { id: 'territory', label: 'Territorio' },
  { id: 'organizations', label: 'Organizaciones' },
  { id: 'teams', label: 'Equipos' },
  { id: 'escalation', label: 'Escalamiento' },
  { id: 'shifts', label: 'Turnos' },
  { id: 'smtp', label: 'Correo' },
  { id: 'reports', label: 'Reportes' },
  { id: 'backups', label: 'Respaldos' },
  { id: 'audit', label: 'Auditoría' },
  { id: 'access', label: 'Usuarios y grupos' },
];

const GROUPS: readonly { label: string; tabs: readonly { id: AdminTab; label: string }[] }[] = [
  { label: 'Configuración inicial', tabs: [{ id: 'access', label: 'Usuarios y grupos' }, { id: 'shifts', label: 'Usuarios y turnos' }] },
  { label: 'Operación NOC', tabs: [{ id: 'escalation', label: 'Escalamiento' }, { id: 'smtp', label: 'Correo' }, { id: 'reports', label: 'Reportes' }, { id: 'backups', label: 'Respaldos' }, { id: 'audit', label: 'Auditoría' }] },
  { label: 'Catálogos', tabs: [{ id: 'territory', label: 'Territorio' }, { id: 'organizations', label: 'Organizaciones' }, { id: 'teams', label: 'Equipos' }] },
  { label: 'Plataforma', tabs: [{ id: 'modules', label: 'Módulos' }, { id: 'features', label: 'Funcionalidades' }] },
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
  imports: [AdminModulesComponent, AdminFeaturesComponent, AdminTerritoryComponent, AdminOrganizationsComponent, AdminTeamsComponent, AdminEscalationComponent, AdminShiftsComponent, AdminSmtpComponent, AdminReportsComponent, AdminBackupsComponent, AdminAuditComponent, AdminAccessComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="admin" [class.admin--compact]="compact()">
      <h1 class="admin__title">Administración</h1>
      <div class="admin__layout">
        <aside class="admin__navigation" [class.admin__navigation--compact]="compact()" aria-label="Secciones de administración">
          <button type="button" class="admin__compact-toggle" (click)="toggleCompact()" [attr.aria-label]="compact() ? 'Expandir menú' : 'Compactar menú'">{{ compact() ? '»' : '«' }} <span>{{ compact() ? 'Expandir' : 'Compactar' }}</span></button>
          @for (group of groups; track group.label) {
            <div class="admin__group"><h2>{{ group.label }}</h2><div role="tablist">
              @for (tab of group.tabs; track tab.id) {
                <button type="button" role="tab" class="admin__tab" [class.admin__tab--active]="active() === tab.id"
                  [attr.aria-selected]="active() === tab.id" [attr.title]="tab.label" (click)="active.set(tab.id)"><span class="admin__tab-label">{{ tab.label }}</span><span class="admin__tab-icon">{{ tab.label.charAt(0) }}</span></button>
              }
            </div></div>
          }
        </aside>
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
          @case ('reports') { <app-admin-reports /> }
          @case ('backups') { <app-admin-backups /> }
          @case ('audit') { <app-admin-audit /> }
          @case ('access') { <app-admin-access /> }
        }
        </div>
      </div>
    </div>
  `,
  styles: `
    .admin {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      max-width: none;
      box-sizing: border-box;
      padding: 24px;
    }
    .admin__title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .admin__layout {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 24px;
      align-items: start;
    }
    .admin__navigation {
      position: sticky;
      top: 16px;
      display: grid;
      gap: 18px;
      padding-right: 16px;
      border-right: 1px solid var(--border-subtle);
    }
    .admin__compact-toggle {
      min-height: 30px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .admin__compact-toggle:hover { color: var(--text-primary); border-color: var(--border-active); }
    .admin__navigation--compact { grid-template-columns: 1fr; width: 54px; padding-right: 8px; }
    .admin__navigation--compact .admin__compact-toggle { padding: 0; text-align: center; }
    .admin__navigation--compact .admin__compact-toggle span,
    .admin__tab-icon { display: none; }
    .admin__navigation--compact .admin__group h2,
    .admin__navigation--compact .admin__tab-label { display: none; }
    .admin--compact .admin__layout { grid-template-columns: 62px minmax(0, 1fr); gap: 16px; }
    .admin--compact .admin__body { min-width: 0; }
    .admin__navigation--compact .admin__tab { width: 100%; justify-content: center; padding-right: 0; padding-left: 0; text-align: center; white-space: nowrap; writing-mode: horizontal-tb; word-break: keep-all; }
    .admin__navigation--compact .admin__tab-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; font-weight: 700; }
    .admin__navigation--compact .admin__tab { border-left: 0; }
    .admin__navigation--compact .admin__tab--active { border-right: 2px solid var(--border-active); }
    .admin__group {
      display: grid;
      gap: 6px;
    }
    .admin__group h2 {
      margin: 0;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .admin__group > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .admin__tab {
      min-height: 34px;
      padding: 7px 10px;
      background: none;
      border: none;
      border-left: 2px solid transparent;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .admin__tab:hover {
      color: var(--text-primary);
    }
    .admin__tab--active {
      color: var(--text-primary);
      border-left-color: var(--border-active);
      background: var(--bg-surface-hover);
    }
    @media (width <= 820px) {
      .admin__layout { grid-template-columns: 1fr; }
      .admin__navigation { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); padding-right: 0; border-right: 0; }
    }
  `,
})
export class AdminShellComponent {
  protected readonly tabs = TABS;
  protected readonly groups = GROUPS;
  protected readonly active = signal<AdminTab>('access');
  protected readonly compact = signal(localStorage.getItem('bitacora.admin.compact.v2') === 'true');

  protected toggleCompact(): void {
    const value = !this.compact();
    this.compact.set(value);
    localStorage.setItem('bitacora.admin.compact.v2', String(value));
  }
}
