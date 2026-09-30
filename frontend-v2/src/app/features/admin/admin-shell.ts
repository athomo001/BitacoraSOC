import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { DomainModule, ModuleAccessService } from '../../core/auth/module-access.service';
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
import { AdminChecklistComponent } from './admin-checklist';
import { AdminComplementsComponent } from './admin-complements';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';

export type AdminSection =
  | 'access' | 'shifts' | 'checklist' | 'escalation' | 'smtp' | 'reports'
  | 'organizations' | 'territory' | 'teams'
  | 'modules' | 'features' | 'backups' | 'audit' | 'complements';

interface NavItem {
  id: AdminSection;
  icon: string;
  labelKey: MessageKey;
  badge?: string;
  /** Sección de un módulo SOC/NOC: si el módulo no aplica, no aparece (sin aviso de "desactivado"). */
  requiresModule?: DomainModule;
  /** Funcionalidad opcional (`system_features`): apagada, la sección no aparece. */
  requiresFeature?: string;
}

/** Mismo orden y agrupación que el artboard aprobado "Administración". */
const NAV: readonly { labelKey: MessageKey; items: readonly NavItem[] }[] = [
  { labelKey: 'admin.group.people', items: [{ id: 'access', icon: 'group', labelKey: 'admin.nav.access' }] },
  {
    labelKey: 'admin.group.operation',
    items: [
      { id: 'shifts', icon: 'schedule', labelKey: 'admin.nav.shifts' },
      { id: 'checklist', icon: 'checklist', labelKey: 'admin.nav.checklist' },
      { id: 'escalation', icon: 'call_split', labelKey: 'admin.nav.escalation' },
      { id: 'smtp', icon: 'mail', labelKey: 'admin.nav.smtp' },
      { id: 'reports', icon: 'summarize', labelKey: 'admin.nav.reports' },
    ],
  },
  {
    labelKey: 'admin.group.catalogs',
    items: [
      { id: 'organizations', icon: 'business', labelKey: 'admin.nav.organizations' },
      { id: 'territory', icon: 'map', labelKey: 'admin.nav.territory', requiresModule: 'noc' },
      { id: 'teams', icon: 'groups', labelKey: 'admin.nav.teams' },
    ],
  },
  {
    labelKey: 'admin.group.system',
    items: [
      { id: 'modules', icon: 'apps', labelKey: 'admin.nav.modules' },
      { id: 'features', icon: 'toggle_on', labelKey: 'admin.nav.features' },
      { id: 'backups', icon: 'backup', labelKey: 'admin.nav.backups' },
      { id: 'audit', icon: 'policy', labelKey: 'admin.nav.audit' },
      { id: 'complements', icon: 'extension', labelKey: 'admin.nav.complements', requiresFeature: 'complements' },
    ],
  },
];

const SECTION_KEY = 'bitacora.admin.section';

function readSection(): AdminSection {
  try {
    const stored = localStorage.getItem(SECTION_KEY) as AdminSection | null;
    if (stored && NAV.some((group) => group.items.some((item) => item.id === stored))) return stored;
  } catch {
    // Sin almacenamiento se abre en Usuarios y grupos.
  }
  return 'access';
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Administración (Alt+5) según el artboard aprobado: una sola lista plana
 * con íconos, agrupada por tema como el legacy, y un buscador de ajustes
 * (Ctrl+K). Reemplaza el menú anidado con botón "Compactar". Recuerda la
 * última sección abierta.
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [
    MatIconModule, AdminModulesComponent, AdminFeaturesComponent, AdminTerritoryComponent, AdminOrganizationsComponent, AdminTeamsComponent,
    AdminEscalationComponent, AdminShiftsComponent, AdminSmtpComponent, AdminReportsComponent, AdminBackupsComponent, AdminAuditComponent,
    AdminAccessComponent, AdminChecklistComponent, AdminComplementsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <div class="adm">
      <aside class="adm__nav" [attr.aria-label]="i18n.t('admin.sections')">
        <div class="adm__head">
          <h1 class="adm__title">{{ i18n.t('nav.admin') }}</h1>
          <label class="adm__search">
            <mat-icon>search</mat-icon>
            <input #search type="search" [value]="query()" (input)="query.set(search.value)" (keydown.enter)="goFirstMatch()" (keydown.escape)="query.set('')"
              [placeholder]="i18n.t('admin.search')" [attr.aria-label]="i18n.t('admin.search')" />
            <kbd class="mono">Ctrl+K</kbd>
          </label>
        </div>
        <div class="adm__groups">
          @for (group of groups(); track group.labelKey) {
            <div class="adm__group" role="group" [attr.aria-label]="i18n.t(group.labelKey)">
              <span class="adm__group-label">{{ i18n.t(group.labelKey) }}</span>
              @for (item of group.items; track item.id) {
                <button type="button" class="adm__item" [class.adm__item--active]="active() === item.id" [attr.aria-current]="active() === item.id ? 'page' : null" (click)="go(item.id)">
                  <mat-icon>{{ item.icon }}</mat-icon>
                  <span class="adm__item-label">{{ i18n.t(item.labelKey) }}</span>
                  @if (item.badge) { <span class="pill tone-system">{{ item.badge }}</span> }
                </button>
              }
            </div>
          } @empty {
            <p class="adm__none">{{ i18n.t('admin.searchEmpty') }}</p>
          }
        </div>
      </aside>
      <main class="adm__body">
        @switch (active()) {
          @case ('access') { <app-admin-access /> }
          @case ('shifts') { <app-admin-shifts /> }
          @case ('checklist') { <app-admin-checklist /> }
          @case ('escalation') { <app-admin-escalation /> }
          @case ('smtp') { <app-admin-smtp /> }
          @case ('reports') { <app-admin-reports /> }
          @case ('organizations') { <app-admin-organizations /> }
          @case ('territory') { <app-admin-territory /> }
          @case ('teams') { <app-admin-teams /> }
          @case ('modules') { <app-admin-modules /> }
          @case ('features') { <app-admin-features /> }
          @case ('backups') { <app-admin-backups (goToFeatures)="go('features')" /> }
          @case ('audit') { <app-admin-audit /> }
          @case ('complements') { <app-admin-complements /> }
        }
      </main>
    </div>
  `,
  styles: `
    :host { display: block; height: calc(100% + 32px); margin: -16px; } /* ocupa todo el área de trabajo del shell (que tiene 16px de padding) */
    .adm { display: grid; grid-template-columns: 212px minmax(0, 1fr); height: 100%; min-height: 0; }
    .adm__nav { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border-subtle); background: var(--bg-surface); }
    .adm__head { padding: 14px 14px 10px; }
    .adm__title { margin: 0; font-size: 15px; font-weight: 600; }
    .adm__search { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 0 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-muted); }
    .adm__search:focus-within { border-color: var(--accent); }
    .adm__search mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .adm__search input { flex: 1; min-width: 0; min-height: 30px; border: none; outline: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
    .adm__search kbd { font-size: 10px; }
    .adm__groups { display: flex; flex: 1; flex-direction: column; gap: 10px; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
    .adm__group { display: flex; flex-direction: column; gap: 1px; }
    .adm__group-label { padding: 4px 10px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .adm__item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .adm__item mat-icon { width: 17px; height: 17px; font-size: 17px; }
    .adm__item:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
    .adm__item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .adm__item--active, .adm__item--active:hover { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .adm__item-label { flex: 1; }
    .adm__none { margin: 0; padding: 8px 10px; color: var(--text-muted); font-size: 12px; }
    .adm__body { min-width: 0; overflow-y: auto; padding: 16px 20px; }
    @media (width <= 820px) {
      .adm { grid-template-columns: minmax(0, 1fr); height: auto; }
      .adm__nav { border-right: none; border-bottom: 1px solid var(--border-subtle); }
      .adm__groups { flex-flow: row wrap; }
      .adm__group { flex: 1 1 180px; }
    }
  `,
})
export class AdminShellComponent {
  protected readonly i18n = inject(I18nService);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('search');

  private readonly modules = inject(ModuleAccessService);
  private readonly features = inject(SystemFeaturesService);
  private readonly modulesLoaded = signal(false);
  private readonly selected = signal<AdminSection>(readSection());
  protected readonly query = signal('');

  /** El menú sin las secciones de módulos que no aplican. */
  private readonly nav = computed(() =>
    NAV.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => (!item.requiresModule || this.modules.has(item.requiresModule)) && (!item.requiresFeature || this.features.isEnabled(item.requiresFeature)),
      ),
    })).filter(
      (group) => group.items.length > 0,
    ),
  );

  /** Si la última sección recordada ya no aplica (se apagó su módulo), se abre Usuarios y grupos. */
  protected readonly active = computed<AdminSection>(() => {
    const selected = this.selected();
    if (!this.modulesLoaded()) return selected;
    return this.nav().some((group) => group.items.some((item) => item.id === selected)) ? selected : 'access';
  });

  constructor() {
    void this.modules.load().finally(() => this.modulesLoaded.set(true));
  }

  /** El buscador filtra por nombre de sección o de grupo, sin tildes. */
  protected readonly groups = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return this.nav();
    return this.nav().map((group) => {
      const groupMatches = normalize(this.i18n.t(group.labelKey)).includes(q);
      return { ...group, items: group.items.filter((item) => groupMatches || normalize(this.i18n.t(item.labelKey)).includes(q)) };
    }).filter((group) => group.items.length > 0);
  });

  protected go(section: AdminSection): void {
    this.selected.set(section);
    this.query.set('');
    try {
      localStorage.setItem(SECTION_KEY, section);
    } catch {
      // Recordar la sección es una comodidad, no un requisito.
    }
  }

  protected goFirstMatch(): void {
    const first = this.groups()[0]?.items[0];
    if (first) this.go(first.id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.searchInput().nativeElement.focus();
    }
  }
}
