import { ChangeDetectionStrategy, Component, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { Organization, OrganizationsService, TeamBulkAction, TeamDetail, TeamSummary } from '../../core/organizations/organizations.service';
import { TeamsDeleteDialogComponent, TeamsDeleteChoice } from './teams-delete-dialog';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { EscalationPool, EscalationService } from '../../core/escalation/escalation.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
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
    .tm__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); }
    .tm__find { flex: 1 1 180px; }
    .tm__kinds { display: flex; flex-wrap: wrap; gap: 4px; }
    .tm__check { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); }
    .tm__note { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 8px 14px; background: var(--accent-soft); }
    .tm__note mat-icon { flex-shrink: 0; color: var(--accent); }
    .tm__bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 14px 0; padding: 8px 10px; border: 1px solid var(--accent); border-radius: var(--radius-md); }
    .tm__group { margin: 10px 14px 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
    .tm__group:last-child { margin-bottom: 14px; }
    .tm__group-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: var(--bg-surface-hover); }
    .tm__group-head mat-icon { color: var(--text-muted); }
    .tm__row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 28px 34px; align-items: center; gap: 10px; padding: 6px 10px; border-top: 1px solid var(--border-subtle); }
    .tm__row--off .tm__name { opacity: 0.55; }
    .tm__name { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; padding: 0; border: none; background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; }
    .tm__name span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class AdminTeamsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly roles = ROLES;
  protected readonly territory = inject(TerritoryService);
  private readonly api = inject(OrganizationsService);
  private readonly directory = inject(DirectoryService);
  private readonly setup = inject(SetupService);
  private readonly escalation = inject(EscalationService);
  /** Pools (TI-Mundo…): se agregan a un nivel como un solo integrante. */
  private readonly pools = signal<EscalationPool[]>([]);
  protected readonly poolResults = computed(() => {
    const q = this.memberQuery().trim().toLowerCase();
    if (q.length < 2) return [];
    return this.pools().filter((p) => p.active && `${p.name} ${p.organizationName ?? ''}`.toLowerCase().includes(q));
  });

  protected readonly teams = signal<TeamSummary[]>([]);
  private readonly injector = inject(Injector);

  // Lista agrupada por organización, con filtros y selección para acciones en lote.
  protected readonly find = signal('');
  protected readonly kindFilter = signal<string>('all');
  protected readonly showInactiveOrgs = signal(false);
  protected readonly checked = signal<Record<string, boolean>>({});
  protected readonly selectedIds = computed(() => Object.keys(this.checked()).filter((id) => this.checked()[id]));

  private readonly orgVisible = computed(() => this.teams().filter((t) => this.showInactiveOrgs() || t.organizationActive !== false));

  protected readonly kindTabs = computed(() => {
    const counts = new Map<string, number>();
    for (const t of this.orgVisible()) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
    return [{ kind: 'all', count: this.orgVisible().length }, ...[...counts].map(([kind, count]) => ({ kind, count }))];
  });

  protected readonly groups = computed(() => {
    const q = this.find().trim().toLowerCase();
    const list = this.orgVisible().filter((t) => (this.kindFilter() === 'all' || t.kind === this.kindFilter())
      && (!q || `${t.name} ${t.organizationName ?? ''}`.toLowerCase().includes(q)));
    const byOrg = new Map<string, TeamSummary[]>();
    for (const t of list) {
      const key = t.organizationId ?? '';
      byOrg.set(key, [...(byOrg.get(key) ?? []), t]);
    }
    const checked = this.checked();
    return [...byOrg].map(([key, teams]) => ({
      key,
      name: teams[0].organizationName || this.i18n.t('teams.noOrg'),
      orgInactive: teams[0].organizationActive === false,
      teams,
      all: teams.every((t) => checked[t.id]),
      some: teams.some((t) => checked[t.id]),
    })).sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name)));
  });

  /** "Lo usa: QRadar · DPP · llamado 2 · 2 tickets" o "Sin uso". */
  protected usageText(t: TeamSummary): string {
    const u = t.usage;
    if (!u) return '';
    const parts = [
      u.steps ? this.i18n.tf('teams.usage.steps', u.steps) : '',
      u.raci ? this.i18n.tf('teams.usage.raci', u.raci) : '',
      u.guards ? this.i18n.tf('teams.usage.guards', u.guards) : '',
      u.tickets ? this.i18n.tf('teams.usage.tickets', u.tickets) : '',
    ].filter(Boolean);
    return parts.length ? `${this.i18n.t('teams.usage.prefix')} ${parts.join(' · ')}` : this.i18n.t('teams.usage.none');
  }

  protected toggle(id: string): void {
    this.checked.update((c) => ({ ...c, [id]: !c[id] }));
  }

  protected toggleGroup(teams: TeamSummary[], on: boolean): void {
    this.checked.update((c) => {
      const next = { ...c };
      for (const t of teams) next[t.id] = on;
      return next;
    });
  }

  protected async setActive(t: TeamSummary, on: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.bulkTeams([t.id], on ? 'activate' : 'deactivate');
      await this.refreshList();
    });
  }

  protected async bulk(action: TeamBulkAction): Promise<void> {
    const ids = this.selectedIds();
    await this.run(async () => {
      await this.api.bulkTeams(ids, action);
      this.checked.set({});
      if (action === 'delete' && ids.includes(this.selected()?.id ?? '')) this.selected.set(null);
      await this.refreshList();
    });
  }

  /** Avisa qué se lleva cada equipo antes de borrar; ofrece solo desactivar. */
  protected async askDelete(): Promise<void> {
    const ids = new Set(this.selectedIds());
    const ref = this.injector.get(Dialog).open<TeamsDeleteChoice>(TeamsDeleteDialogComponent, {
      data: { teams: this.teams().filter((t) => ids.has(t.id)) },
    });
    const choice = await firstValueFrom(ref.closed);
    if (choice === 'delete') await this.bulk('delete');
    if (choice === 'deactivate') await this.bulk('deactivate');
  }
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
    void this.escalation.listPools().then((p) => this.pools.set(p)).catch(() => null);
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

  /** Clic en el equipo abierto lo cierra (la lista vuelve a todo el ancho). */
  protected async select(team: TeamSummary): Promise<void> {
    if (this.selected()?.id === team.id) {
      this.selected.set(null);
      return;
    }
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

  protected async addPool(pool: EscalationPool): Promise<void> {
    const team = this.selected();
    if (!team) return;
    await this.run(async () => {
      await this.api.addMember(team.id, { poolId: pool.id, roleInTeam: this.memberRole(), recipientType: this.memberRecipient(), priority: this.memberPriority() });
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
