import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import {
  Asset,
  EscalationScope,
  EscalationService,
  MODE_LABELS,
  MaintenanceWindow,
  Policy,
  SocService,
  StepMode,
} from '../../core/escalation/escalation.service';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';

type ScopeKind = 'asset' | 'unit' | 'service';

/**
 * Administración del motor de escalación (Fase 7): políticas por servicio
 * (SOC), activo o unidad territorial (NOC) con sus pasos → equipo, servicios
 * SOC y ventanas de mantenimiento. Portado en espíritu de la pestaña
 * "Flujo" y de "Mantenimientos" del legacy (escalation-flow-tab /
 * escalation-simple), pero sobre equipos en vez de contactos sueltos por paso.
 */
@Component({
  selector: 'app-admin-escalation',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="msg msg--error">{{ error() }}</p> }

    <section class="panel">
      <h2 class="panel__title">Políticas de escalación</h2>
      <p class="panel__hint">
        Orden de resolución: política propia del activo → política de su zona (de la más específica a la más general) →
        equipos que cubren la zona. Un servicio SOC usa su propia política.
      </p>
      <form class="field-grid esc-form" (ngSubmit)="createPolicy()">
        <label class="field">
          <span>Aplica a</span>
          <select name="policyKind" [ngModel]="policyKind()" (ngModelChange)="policyKind.set($event); policyTarget.set('')">
            @if (nocEnabled()) { <option value="asset">Activo</option><option value="unit">Unidad territorial</option> }
            @if (socEnabled()) { <option value="service">Servicio SOC</option> }
          </select>
        </label>
        <label class="field">
          <span>Destino</span>
          <select name="policyTarget" [ngModel]="policyTarget()" (ngModelChange)="policyTarget.set($event)">
            <option value="">Elegir…</option>
            @for (o of targetOptions(); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
          </select>
        </label>
        <div class="actions esc-form__actions"><button type="submit" class="esc-submit" [disabled]="!policyTarget()">Crear política</button></div>
      </form>

      <table class="esc-table">
        <thead><tr><th>Aplica a</th><th>Pasos</th><th></th></tr></thead>
        <tbody>
          @for (p of policies(); track p.id) {
            <tr class="esc-row" [class.esc-row--selected]="selectedId() === p.id" (click)="selectedId.set(p.id)">
              <td><strong>{{ scopeLabel(p) }}</strong></td>
              <td>{{ stepsSummary(p) }}</td>
              <td><button type="button" class="esc-btn" (click)="$event.stopPropagation(); deletePolicy(p)">Eliminar</button></td>
            </tr>
          } @empty {
            <tr><td colspan="3" class="esc-empty">Todavía no hay políticas. Sin política, un activo usa la cobertura de equipos de su zona.</td></tr>
          }
        </tbody>
      </table>
    </section>

    @if (selected(); as p) {
      <section class="panel">
        <h2 class="panel__title">{{ scopeLabel(p) }} — pasos</h2>
        <table class="esc-table">
          <thead><tr><th>Paso</th><th>Equipo</th><th>Modo</th><th>Esperar</th><th></th></tr></thead>
          <tbody>
            @for (s of p.steps; track s.stepOrder) {
              <tr>
                <td class="mono">{{ s.stepOrder }}</td>
                <td>{{ s.teamName }}</td>
                <td>{{ modeLabels[s.mode] }}</td>
                <td class="mono">{{ s.waitBeforeEscalateMinutes }} min</td>
                <td><button type="button" class="esc-btn" (click)="deleteStep(p, s.stepOrder)">Quitar</button></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="esc-empty">Sin pasos: agrega al menos uno.</td></tr>
            }
          </tbody>
        </table>
        <form class="field-grid esc-form" (ngSubmit)="addStep(p)">
          <label class="field"><span>Paso</span><input name="stepOrder" type="number" min="1" [ngModel]="stepOrder()" (ngModelChange)="stepOrder.set(+$event)" /></label>
          <label class="field">
            <span>Equipo</span>
            <select name="stepTeam" [ngModel]="stepTeam()" (ngModelChange)="stepTeam.set($event)">
              <option value="">Elegir…</option>
              @for (t of teams(); track t.id) { <option [value]="t.id">{{ t.name }}{{ t.organizationName ? ' — ' + t.organizationName : '' }}</option> }
            </select>
          </label>
          <label class="field">
            <span>Modo</span>
            <select name="stepMode" [ngModel]="stepMode()" (ngModelChange)="stepMode.set($event)">
              <option value="unique">Único (el principal)</option>
              <option value="sequential">Uno tras otro</option>
              <option value="pool">Todos a la vez</option>
            </select>
          </label>
          <label class="field"><span>Esperar (min)</span><input name="stepWait" type="number" min="0" [ngModel]="stepWait()" (ngModelChange)="stepWait.set(+$event)" /></label>
          <div class="actions esc-form__actions"><button type="submit" class="esc-submit" [disabled]="!stepTeam()">Agregar paso</button></div>
        </form>
      </section>
    }

    @if (socEnabled()) {
      <section class="panel">
        <h2 class="panel__title">Servicios SOC</h2>
        <p class="panel__hint">El servicio que se monitorea para un cliente (SIEM, EDR, firewall…). Cada uno puede tener su política.</p>
        <form class="field-grid esc-form" (ngSubmit)="createService()">
          <label class="field">
            <span>Cliente</span>
            <select name="svcOrg" [ngModel]="svcOrg()" (ngModelChange)="svcOrg.set($event)">
              <option value="">Elegir…</option>
              @for (o of clients(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
            </select>
          </label>
          <label class="field"><span>Nombre</span><input name="svcName" placeholder="SIEM Cliente A" [ngModel]="svcName()" (ngModelChange)="svcName.set($event)" /></label>
          <label class="field"><span>Código</span><input name="svcCode" placeholder="SIEM-A" [ngModel]="svcCode()" (ngModelChange)="svcCode.set($event)" /></label>
          <div class="actions esc-form__actions"><button type="submit" class="esc-submit" [disabled]="!svcOrg() || !svcName().trim()">Crear servicio</button></div>
        </form>
        <table class="esc-table">
          <thead><tr><th>Servicio</th><th>Código</th><th>Cliente</th></tr></thead>
          <tbody>
            @for (s of services(); track s.id) {
              <tr><td>{{ s.name }}</td><td class="mono">{{ s.code }}</td><td>{{ s.organizationName }}</td></tr>
            } @empty {
              <tr><td colspan="3" class="esc-empty">Sin servicios.</td></tr>
            }
          </tbody>
        </table>
      </section>
    }

    <section class="panel">
      <h2 class="panel__title">Ventanas de mantenimiento</h2>
      <p class="panel__hint">
        Con supresión, el aviso por correo no se envía mientras la ventana está vigente (queda auditado igual). Una ventana
        sobre una zona cubre a todos sus activos.
      </p>
      <form class="field-grid esc-form" (ngSubmit)="createWindow()">
        <label class="field">
          <span>Aplica a</span>
          <select name="winKind" [ngModel]="winKind()" (ngModelChange)="winKind.set($event); winTarget.set('')">
            @if (nocEnabled()) { <option value="asset">Activo</option><option value="unit">Unidad territorial</option> }
            @if (socEnabled()) { <option value="service">Servicio SOC</option> }
          </select>
        </label>
        <label class="field">
          <span>Destino</span>
          <select name="winTarget" [ngModel]="winTarget()" (ngModelChange)="winTarget.set($event)">
            <option value="">Elegir…</option>
            @for (o of winOptions(); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
          </select>
        </label>
        <label class="field"><span>Título</span><input name="winTitle" placeholder="Mantención troncal Calama" [ngModel]="winTitle()" (ngModelChange)="winTitle.set($event)" /></label>
        <label class="field"><span>Desde</span><input name="winStart" type="datetime-local" [ngModel]="winStart()" (ngModelChange)="winStart.set($event)" /></label>
        <label class="field"><span>Hasta</span><input name="winEnd" type="datetime-local" [ngModel]="winEnd()" (ngModelChange)="winEnd.set($event)" /></label>
        <label class="field esc-check">
          <input name="winSuppress" type="checkbox" [ngModel]="winSuppress()" (ngModelChange)="winSuppress.set($event)" />
          <span>Suprimir avisos por correo</span>
        </label>
        <div class="actions esc-form__actions">
          <button type="submit" class="esc-submit" [disabled]="!winTarget() || !winTitle().trim() || !winStart() || !winEnd()">Programar ventana</button>
        </div>
      </form>
      <table class="esc-table">
        <thead><tr><th>Título</th><th>Aplica a</th><th>Desde</th><th>Hasta</th><th>Supresión</th><th></th></tr></thead>
        <tbody>
          @for (w of windows(); track w.id) {
            <tr [class.esc-row--inactive]="!w.active">
              <td>{{ w.title }}</td>
              <td>{{ scopeLabel(w) }}</td>
              <td class="mono">{{ w.startsAt | date: 'dd/MM/yy HH:mm' }}</td>
              <td class="mono">{{ w.endsAt | date: 'dd/MM/yy HH:mm' }}</td>
              <td>{{ w.suppressNotifications ? 'Sí' : 'No (informativa)' }}</td>
              <td>@if (w.active) { <button type="button" class="esc-btn" (click)="closeWindow(w)">Cerrar</button> } @else { <span class="esc-empty">Cerrada</span> }</td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="esc-empty">Sin ventanas programadas.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .esc-form { align-items: end; margin: 12px 0; }
    .esc-form__actions { margin-top: 0; }
    .esc-check { flex-direction: row; align-items: center; gap: 6px; min-height: var(--row-height); }
    .esc-submit {
      min-height: var(--row-height); padding: 0 14px; background: var(--border-active); border: none;
      border-radius: var(--radius-sm); color: var(--bg-app); font: inherit; font-weight: 600; cursor: pointer;
    }
    .esc-submit[disabled] { opacity: 0.6; cursor: default; }
    .esc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .esc-table th { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 11px; text-align: left; }
    .esc-table td { height: var(--row-height); padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); }
    .esc-row { cursor: pointer; }
    .esc-row:hover td, .esc-row--selected td { background: var(--bg-surface-hover); }
    .esc-row--selected td:first-child { box-shadow: inset 2px 0 0 var(--border-active); }
    .esc-row--inactive td { color: var(--text-muted); }
    .esc-empty { color: var(--text-secondary); text-align: center; }
    .esc-btn {
      min-height: 28px; padding: 0 10px; background: none; border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer;
    }
  `,
})
export class AdminEscalationComponent implements OnInit {
  protected readonly modeLabels = MODE_LABELS;
  private readonly api = inject(EscalationService);
  private readonly orgs = inject(OrganizationsService);
  private readonly territory = inject(TerritoryService);
  private readonly setup = inject(SetupService);

  protected readonly socEnabled = computed(() => this.setup.status()?.socEnabled ?? false);
  protected readonly nocEnabled = computed(() => this.setup.status()?.nocEnabled ?? false);
  protected readonly error = signal<string | null>(null);

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
    await this.setup.loadStatus();
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

  protected scopeLabel(s: EscalationScope): string {
    if (s.assetId) {
      const a = this.assets().find((x) => x.id === s.assetId);
      return `Activo: ${a ? a.name : s.assetId}`;
    }
    if (s.territorialUnitId) {
      const u = this.units().find((x) => x.id === s.territorialUnitId);
      return `Zona: ${u ? `${u.name} (${u.code})` : s.territorialUnitId}`;
    }
    const svc = this.services().find((x) => x.id === s.serviceId);
    return `Servicio: ${svc ? svc.name : s.serviceId}`;
  }

  protected stepsSummary(p: Policy): string {
    if (p.steps.length === 0) return 'sin pasos';
    return p.steps.map((s) => `${s.stepOrder}. ${s.teamName}`).join(' → ');
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
    if (!confirm(`¿Eliminar la política de ${this.scopeLabel(p)}?`)) return;
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
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo completar la acción.'));
    }
  }
}
