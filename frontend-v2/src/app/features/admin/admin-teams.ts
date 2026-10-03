import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { Organization, OrganizationsService, TeamDetail, TeamSummary } from '../../core/organizations/organizations.service';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';

/** Tipos de equipo del backend (teams.kind); la etiqueta sale de i18n. */
const TEAM_KINDS = ['contractor_field', 'noc_internal', 'escalation', 'oncall', 'raci'] as const;
/** Tipos que solo existen con NOC: sin NOC no se ofrecen al crear. */
const NOC_KINDS: ReadonlySet<string> = new Set(['contractor_field', 'noc_internal']);
const ROLES = ['primary', 'backup', 'lead'] as const;

/**
 * Equipos (Administración → Catálogos), re-vestido con los componentes del
 * artboard "Administración": lista a la izquierda y el equipo elegido a la
 * derecha. El equipo es a quién escala el motor de la Fase 7: miembros =
 * contactos del directorio (con Para/CC, que el aviso por correo respeta) y,
 * con NOC, las zonas que cubre.
 */
@Component({
  selector: 'app-admin-teams',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-teams.html',
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tm__create { padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
    .tm__detail { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .tm__add { border-top: 1px solid var(--border-subtle); }
    .tm__search { flex-basis: 220px; }
    .tm__results { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 12px; }
    .tm__results li { display: flex; align-items: center; gap: 10px; }
  `,
})
export class AdminTeamsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly roles = ROLES;
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
  protected readonly kinds = computed(() => TEAM_KINDS.filter((k) => this.nocEnabled() || !NOC_KINDS.has(k)));

  protected readonly teamName = signal('');
  protected readonly teamKind = signal('escalation');
  protected readonly teamOrg = signal('');
  protected readonly memberQuery = signal('');
  protected readonly memberResults = signal<DirectoryContact[]>([]);
  protected readonly memberRole = signal('primary');
  protected readonly memberPriority = signal(0);
  protected readonly memberRecipient = signal<'to' | 'cc'>('to');
  protected readonly searching = signal(false);
  protected readonly busy = signal(false);
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
      this.error.set(problemDetail(error, this.i18n.t('teams.loadError')));
    }
  }

  protected kindKey(kind: string): MessageKey {
    return `teams.kind.${kind}` as MessageKey;
  }

  protected roleKey(role: string): MessageKey {
    return `teams.role.${role}` as MessageKey;
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
    this.searching.set(true);
    this.searchTimer = setTimeout(async () => {
      try {
        this.memberResults.set(await this.directory.search(value.trim()));
      } catch {
        this.memberResults.set([]);
      } finally {
        this.searching.set(false);
      }
    }, 250);
  }

  protected async addMember(contact: DirectoryContact): Promise<void> {
    const team = this.selected();
    if (!team) return;
    await this.run(async () => {
      await this.api.addMember(team.id, { contactId: contact.id, roleInTeam: this.memberRole(), recipientType: this.memberRecipient(), priority: this.memberPriority() });
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
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('teams.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
