import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  Asset,
  EscalationScope,
  EscalationService,
  MaintenanceWindow,
  Policy,
  SocService,
  StepMode,
} from '../../core/escalation/escalation.service';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

type ScopeKind = 'asset' | 'unit' | 'service';
const MODES: readonly StepMode[] = ['unique', 'sequential', 'pool'];

/**
 * Administración del motor de escalación (Fase 7), re-vestido con los
 * componentes del artboard "Administración": políticas a la izquierda y los
 * pasos de la elegida a la derecha, servicios SOC y ventanas de
 * mantenimiento. Portado en espíritu de "Flujo" y "Mantenimientos" del
 * legacy, pero sobre equipos en vez de contactos sueltos por paso. Solo
 * ofrece los destinos de los módulos que aplican (sin avisos de "apagado").
 */
@Component({
  selector: 'app-admin-escalation',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-escalation.html',
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ea__lead { padding-bottom: 0; }
    .ea__form { padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
    .ea__name { margin-top: 3px; }
    .ea__step-form { border-top: 1px solid var(--border-subtle); }
    .ea__win-form { border-bottom: 1px solid var(--border-subtle); }
    .ea__actions { display: flex; justify-content: flex-end; }
    .ea__confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
    .ea__suppress { align-self: center; flex: 0 0 auto; }
    .ea__inactive td { color: var(--text-muted); }
  `,
})
export class AdminEscalationComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly modes = MODES;
  private readonly api = inject(EscalationService);
  private readonly orgs = inject(OrganizationsService);
  private readonly territory = inject(TerritoryService);
  private readonly modules = inject(ModuleAccessService);

  protected readonly socEnabled = this.modules.soc;
  protected readonly nocEnabled = this.modules.noc;
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);

  /** Destinos posibles según los módulos que aplican. */
  protected readonly kinds = computed<ScopeKind[]>(() => [...(this.nocEnabled() ? (['asset', 'unit'] as const) : []), ...(this.socEnabled() ? (['service'] as const) : [])]);

  protected readonly policies = signal<Policy[]>([]);
  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly services = signal<SocService[]>([]);
  protected readonly clients = signal<Organization[]>([]);
  protected readonly windows = signal<MaintenanceWindow[]>([]);
  private readonly assets = signal<Asset[]>([]);
  private readonly units = signal<TerritorialUnit[]>([]);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.policies().find((p) => p.id === this.selectedId()) ?? null);

  protected readonly policyKind = signal<ScopeKind>('asset');
  protected readonly policyTarget = signal('');
  protected readonly stepOrder = signal(1);
  protected readonly stepTeam = signal('');
  protected readonly stepMode = signal<StepMode>('unique');
  protected readonly stepWait = signal(10);
  protected readonly svcOrg = signal('');
  protected readonly svcName = signal('');
  protected readonly svcCode = signal('');
  protected readonly winKind = signal<ScopeKind>('unit');
  protected readonly winTarget = signal('');
  protected readonly winTitle = signal('');
  protected readonly winStart = signal('');
  protected readonly winEnd = signal('');
  protected readonly winSuppress = signal(true);

  protected readonly targetOptions = computed(() => this.optionsFor(this.policyKind()));
  protected readonly winOptions = computed(() => this.optionsFor(this.winKind()));

  async ngOnInit(): Promise<void> {
    await this.modules.load();
    if (!this.nocEnabled()) {
      this.policyKind.set('service');
      this.winKind.set('service');
    }
    await this.run(async () => {
      await Promise.all([
        this.refreshPolicies(),
        this.refreshWindows(),
        this.orgs.listTeams().then((t) => this.teams.set(t)),
        this.nocEnabled() ? this.api.listAssets().then((a) => this.assets.set(a)) : null,
        this.nocEnabled() ? this.territory.list(1, 5000).then((r) => this.units.set(r.units)) : null,
        this.socEnabled() ? this.refreshServices() : null,
        this.socEnabled() ? this.orgs.list({ type: 'client', active: true }).then((o) => this.clients.set(o)) : null,
      ]);
    });
  }

  private optionsFor(kind: ScopeKind): { id: string; label: string }[] {
    switch (kind) {
      case 'asset':
        return this.assets().map((a) => ({ id: a.id, label: `${a.name} (${a.code})` }));
      case 'unit':
        return this.units().map((u) => ({ id: u.id, label: `${'— '.repeat(u.depth)}${u.name}` }));
      default:
        return this.services().map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }));
    }
  }

  private scopeOf(kind: ScopeKind, id: string): EscalationScope {
    if (kind === 'asset') return { assetId: id };
    if (kind === 'unit') return { territorialUnitId: id };
    return { serviceId: id };
  }

  protected kindOf(s: EscalationScope): ScopeKind {
    if (s.assetId) return 'asset';
    if (s.territorialUnitId) return 'unit';
    return 'service';
  }

  protected kindKey(kind: ScopeKind): MessageKey {
    return `escAdmin.kind.${kind}` as MessageKey;
  }

  protected modeKey(mode: StepMode): MessageKey {
    return `escAdmin.mode.${mode}` as MessageKey;
  }

  protected modeHintKey(mode: StepMode): MessageKey {
    return `escAdmin.modeHint.${mode}` as MessageKey;
  }

  /** El nombre del activo, zona o servicio al que apunta. */
  protected targetName(s: EscalationScope): string {
    if (s.assetId) {
      const a = this.assets().find((x) => x.id === s.assetId);
      return a ? a.name : s.assetId;
    }
    if (s.territorialUnitId) {
      const u = this.units().find((x) => x.id === s.territorialUnitId);
      return u ? `${u.name} (${u.code})` : s.territorialUnitId;
    }
    const svc = this.services().find((x) => x.id === s.serviceId);
    return svc ? svc.name : (s.serviceId ?? '');
  }

  protected stepsSummary(p: Policy): string {
    if (p.steps.length === 0) return this.i18n.t('escAdmin.noStepsShort');
    return p.steps.map((s) => `${s.stepOrder}. ${s.teamName}`).join(' → ');
  }

  protected select(p: Policy): void {
    this.selectedId.set(p.id);
    this.confirmDelete.set(false);
    this.stepOrder.set((p.steps.at(-1)?.stepOrder ?? 0) + 1);
  }

  protected async createPolicy(): Promise<void> {
    await this.run(async () => {
      const p = await this.api.createPolicy(this.scopeOf(this.policyKind(), this.policyTarget()));
      this.policyTarget.set('');
      await this.refreshPolicies();
      this.selectedId.set(p.id);
      this.stepOrder.set(1);
    });
  }

  protected async deletePolicy(p: Policy): Promise<void> {
    this.confirmDelete.set(false);
    await this.run(async () => {
      await this.api.deletePolicy(p.id);
      if (this.selectedId() === p.id) this.selectedId.set(null);
      await this.refreshPolicies();
    });
  }

  protected async addStep(p: Policy): Promise<void> {
    await this.run(async () => {
      await this.api.addStep(p.id, { stepOrder: this.stepOrder(), teamId: this.stepTeam(), mode: this.stepMode(), waitBeforeEscalateMinutes: this.stepWait() });
      this.stepTeam.set('');
      this.stepOrder.update((n) => n + 1);
      await this.refreshPolicies();
    });
  }

  protected async deleteStep(p: Policy, order: number): Promise<void> {
    await this.run(async () => {
      await this.api.deleteStep(p.id, order);
      await this.refreshPolicies();
    });
  }

  protected async createService(): Promise<void> {
    await this.run(async () => {
      await this.api.createService({ organizationId: this.svcOrg(), name: this.svcName().trim(), code: this.svcCode().trim() });
      this.svcName.set('');
      this.svcCode.set('');
      await this.refreshServices();
    });
  }

  protected async createWindow(): Promise<void> {
    await this.run(async () => {
      await this.api.createWindow({
        ...this.scopeOf(this.winKind(), this.winTarget()),
        title: this.winTitle().trim(),
        // datetime-local viene sin zona: se interpreta en la hora local del navegador.
        startsAt: new Date(this.winStart()).toISOString(),
        endsAt: new Date(this.winEnd()).toISOString(),
        suppressNotifications: this.winSuppress(),
      });
      this.winTitle.set('');
      await this.refreshWindows();
    });
  }

  protected async closeWindow(w: MaintenanceWindow): Promise<void> {
    await this.run(async () => {
      await this.api.closeWindow(w.id);
      await this.refreshWindows();
    });
  }

  private async refreshPolicies(): Promise<void> {
    this.policies.set(await this.api.listPolicies());
  }

  private async refreshWindows(): Promise<void> {
    this.windows.set(await this.api.listWindows());
  }

  private async refreshServices(): Promise<void> {
    this.services.set(await this.api.listServices());
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('escAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
