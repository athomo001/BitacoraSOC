import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Organization, OrganizationsService, TeamDetail, TeamSummary } from '../../core/organizations/organizations.service';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';

const TEAM_KINDS: { id: string; label: string }[] = [
  { id: 'contractor_field', label: 'Cuadrilla de contrata' },
  { id: 'noc_internal', label: 'NOC interno' },
  { id: 'escalation', label: 'Escalamiento' },
  { id: 'oncall', label: 'Guardia' },
  { id: 'raci', label: 'RACI' },
];

const ROLE_LABELS: Record<string, string> = { primary: 'Principal', backup: 'Respaldo', lead: 'Líder' };

/**
 * Administración mínima de equipos (Fase 6 tareas 4-5): el equipo es a quién
 * escala el motor de la Fase 7. Miembros = contactos del directorio (se
 * buscan con el mismo typeahead) o usuarios internos; cobertura territorial
 * solo con el módulo NOC activo.
 */
@Component({
  selector: 'app-admin-teams',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="panel__title">Equipos</h2>
      <p class="panel__hint">Cuadrillas de contrata, NOC interno o equipos de escalamiento. Un equipo de 1 persona es el caso SOC clásico.</p>
      <form class="field-grid teams-form" (ngSubmit)="createTeam()">
        <label class="field"><span>Nombre</span><input name="teamName" placeholder="Cuadrilla Calama" [ngModel]="teamName()" (ngModelChange)="teamName.set($event)" /></label>
        <label class="field">
          <span>Tipo</span>
          <select name="teamKind" [ngModel]="teamKind()" (ngModelChange)="teamKind.set($event)">
            @for (k of kinds; track k.id) { <option [value]="k.id">{{ k.label }}</option> }
          </select>
        </label>
        <label class="field">
          <span>Organización</span>
          <select name="teamOrg" [ngModel]="teamOrg()" (ngModelChange)="teamOrg.set($event)">
            <option value="">(ninguna)</option>
            @for (o of organizations(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
          </select>
        </label>
        <div class="actions teams-form__actions"><button type="submit" class="teams-submit">Crear equipo</button></div>
      </form>
      @if (error()) { <p class="msg msg--error">{{ error() }}</p> }

      <table class="teams-table">
        <thead><tr><th>Equipo</th><th>Tipo</th><th>Organización</th><th>Miembros</th></tr></thead>
        <tbody>
          @for (t of teams(); track t.id) {
            <tr class="teams-row" [class.teams-row--selected]="selected()?.id === t.id" (click)="select(t)">
              <td><strong>{{ t.name }}</strong> <span class="mono teams-slug">{{ t.slug }}</span></td>
              <td>{{ kindLabel(t.kind) }}</td>
              <td>{{ t.organizationName || '—' }}</td>
              <td class="mono">{{ t.memberCount ?? 0 }}</td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="teams-empty">Todavía no hay equipos.</td></tr>
          }
        </tbody>
      </table>
    </section>

    @if (selected(); as team) {
      <section class="panel">
        <h2 class="panel__title">{{ team.name }} — miembros</h2>
        <table class="teams-table">
          <thead><tr><th>Prioridad</th><th>Nombre</th><th>Rol</th><th>Envío</th><th></th></tr></thead>
          <tbody>
            @for (m of team.members; track m.id) {
              <tr>
                <td class="mono">{{ m.priority }}</td>
                <td>{{ m.displayName }} <span class="teams-slug">{{ m.userId ? '(usuario)' : '(contacto)' }}</span></td>
                <td>{{ roleLabels[m.roleInTeam] }}</td>
                <td class="mono">{{ m.recipientType.toUpperCase() }}</td>
                <td><button type="button" class="teams-btn" (click)="removeMember(m.id)">Quitar</button></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="teams-empty">Sin miembros.</td></tr>
            }
          </tbody>
        </table>
        <div class="field-grid teams-add">
          <label class="field">
            <span>Agregar contacto del directorio</span>
            <input name="memberSearch" placeholder="Buscar por nombre, cargo, organización…" [ngModel]="memberQuery()" (ngModelChange)="searchMembers($event)" />
          </label>
          <label class="field">
            <span>Rol</span>
            <select name="memberRole" [ngModel]="memberRole()" (ngModelChange)="memberRole.set($event)">
              <option value="primary">Principal</option><option value="backup">Respaldo</option><option value="lead">Líder</option>
            </select>
          </label>
          <label class="field"><span>Prioridad</span><input name="memberPriority" type="number" min="0" [ngModel]="memberPriority()" (ngModelChange)="memberPriority.set(+$event)" /></label>
        </div>
        @if (memberResults().length > 0) {
          <ul class="teams-results">
            @for (c of memberResults(); track c.id) {
              <li>
                <button type="button" class="teams-btn" (click)="addMember(c)">Agregar</button>
                {{ c.name }} <span class="teams-slug">· {{ c.position || 'sin cargo' }} · {{ c.organizationName }}</span>
              </li>
            }
          </ul>
        }
      </section>

      @if (nocEnabled()) {
        <section class="panel">
          <h2 class="panel__title">{{ team.name }} — cobertura territorial</h2>
          <p class="panel__hint">Qué zonas atiende este equipo. Menor prioridad = cuadrilla principal; mayor = respaldo.</p>
          <table class="teams-table">
            <thead><tr><th>Prioridad</th><th>Unidad</th><th>Código</th><th></th></tr></thead>
            <tbody>
              @for (c of team.coverage ?? []; track c.territorialUnitId) {
                <tr>
                  <td class="mono">{{ c.priority }}</td>
                  <td>{{ c.name }} <span class="teams-slug">({{ territory.kindLabel($any(c.kind)) }})</span></td>
                  <td class="mono">{{ c.code }}</td>
                  <td><button type="button" class="teams-btn" (click)="removeCoverage(c.territorialUnitId)">Quitar</button></td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="teams-empty">Sin cobertura asignada.</td></tr>
              }
            </tbody>
          </table>
          <div class="field-grid teams-add">
            <label class="field">
              <span>Unidad territorial</span>
              <select name="coverUnit" [ngModel]="coverUnit()" (ngModelChange)="coverUnit.set($event)">
                <option value="">Elegir…</option>
                @for (u of units(); track u.id) {
                  <option [value]="u.id">{{ '— '.repeat(u.depth) }}{{ u.name }}</option>
                }
              </select>
            </label>
            <label class="field"><span>Prioridad</span><input name="coverPriority" type="number" min="0" [ngModel]="coverPriority()" (ngModelChange)="coverPriority.set(+$event)" /></label>
            <div class="actions teams-form__actions"><button type="button" class="teams-submit" [disabled]="!coverUnit()" (click)="addCoverage()">Asignar cobertura</button></div>
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .teams-form, .teams-add { align-items: end; margin: 12px 0; }
    .teams-form__actions { margin-top: 0; }
    .teams-submit {
      min-height: var(--row-height); padding: 0 14px; background: var(--border-active); border: none;
      border-radius: var(--radius-sm); color: var(--bg-app); font: inherit; font-weight: 600; cursor: pointer;
    }
    .teams-submit[disabled] { opacity: 0.6; cursor: default; }
    .teams-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .teams-table th { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 11px; text-align: left; }
    .teams-table td { height: var(--row-height); padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); }
    .teams-row { cursor: pointer; }
    .teams-row:hover td { background: var(--bg-surface-hover); }
    .teams-row--selected td { background: var(--bg-surface-hover); }
    .teams-row--selected td:first-child { box-shadow: inset 2px 0 0 var(--border-active); }
    .teams-slug { margin-left: 6px; color: var(--text-muted); font-size: 11px; }
    .teams-empty { color: var(--text-secondary); text-align: center; }
    .teams-btn {
      min-height: 28px; padding: 0 10px; background: none; border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer;
    }
    .teams-results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  `,
})
export class AdminTeamsComponent implements OnInit {
  protected readonly kinds = TEAM_KINDS;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly territory = inject(TerritoryService);
  private readonly api = inject(OrganizationsService);
  private readonly directory = inject(DirectoryService);
  private readonly setup = inject(SetupService);

  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly organizations = signal<Organization[]>([]);
  protected readonly selected = signal<TeamDetail | null>(null);
  protected readonly units = signal<TerritorialUnit[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly nocEnabled = computed(() => this.setup.status()?.nocEnabled ?? false);

  protected readonly teamName = signal('');
  protected readonly teamKind = signal('contractor_field');
  protected readonly teamOrg = signal('');
  protected readonly memberQuery = signal('');
  protected readonly memberResults = signal<DirectoryContact[]>([]);
  protected readonly memberRole = signal('primary');
  protected readonly memberPriority = signal(0);
  protected readonly coverUnit = signal('');
  protected readonly coverPriority = signal(0);

  private searchTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    await this.setup.loadStatus();
    try {
      const [teams, orgs] = await Promise.all([this.api.listTeams(), this.api.list({ active: true })]);
      this.teams.set(teams);
      this.organizations.set(orgs);
      if (this.nocEnabled()) {
        await this.territory.loadLabels();
        this.units.set((await this.territory.list(1, 5000)).units);
      }
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron cargar los equipos.'));
    }
  }

  protected kindLabel(kind: string): string {
    return TEAM_KINDS.find((k) => k.id === kind)?.label ?? kind;
  }

  protected async createTeam(): Promise<void> {
    await this.run(async () => {
      const team = await this.api.createTeam({
        name: this.teamName().trim(),
        kind: this.teamKind(),
        organizationId: this.teamOrg() || undefined,
        audience: 'internal',
      });
      this.teamName.set('');
      await this.refreshList();
      await this.select(team);
    });
  }

  protected async select(team: TeamSummary): Promise<void> {
    await this.run(async () => this.selected.set(await this.api.getTeam(team.id)));
  }

  protected searchMembers(value: string): void {
    this.memberQuery.set(value);
    clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.memberResults.set([]);
      return;
    }
    this.searchTimer = setTimeout(async () => {
      try {
        this.memberResults.set(await this.directory.search(value.trim()));
      } catch {
        this.memberResults.set([]);
      }
    }, 250);
  }

  protected async addMember(contact: DirectoryContact): Promise<void> {
    const team = this.selected();
    if (!team) return;
    await this.run(async () => {
      await this.api.addMember(team.id, { contactId: contact.id, roleInTeam: this.memberRole(), recipientType: 'to', priority: this.memberPriority() });
      this.memberQuery.set('');
      this.memberResults.set([]);
      await this.reloadSelected();
    });
  }

  protected async removeMember(memberId: string): Promise<void> {
    const team = this.selected();
    if (!team) return;
    await this.run(async () => {
      await this.api.removeMember(team.id, memberId);
      await this.reloadSelected();
    });
  }

  protected async addCoverage(): Promise<void> {
    const team = this.selected();
    if (!team || !this.coverUnit()) return;
    await this.run(async () => {
      await this.api.addCoverage(team.id, this.coverUnit(), this.coverPriority());
      this.coverUnit.set('');
      await this.reloadSelected();
    });
  }

  protected async removeCoverage(unitId: string): Promise<void> {
    const team = this.selected();
    if (!team) return;
    await this.run(async () => {
      await this.api.removeCoverage(team.id, unitId);
      await this.reloadSelected();
    });
  }

  private async reloadSelected(): Promise<void> {
    const team = this.selected();
    if (team) {
      this.selected.set(await this.api.getTeam(team.id));
    }
    await this.refreshList();
  }

  private async refreshList(): Promise<void> {
    this.teams.set(await this.api.listTeams());
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo completar la acción.'));
    }
  }
}
