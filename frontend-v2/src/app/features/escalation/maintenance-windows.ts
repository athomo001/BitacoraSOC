import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Asset, EscalationService, MaintenanceWindow, SocService, WindowTarget } from '../../core/escalation/escalation.service';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { AgendaService } from '../../core/agenda/agenda.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/escalation';
type ScopeKind = 'asset' | 'unit' | 'service' | 'client' | 'area' | 'team';

/**
 * Ventanas de mantenimiento: programar y cerrar. La usan Administración →
 * Escalamiento y la pantalla de Escalamiento, porque también las crea el
 * analista (comentario del dueño #16), no solo el admin. Solo ofrece los
 * destinos de los módulos encendidos. Desde la 9.5 también aplican a un
 * cliente, un área o un equipo de la app; la que está en curso se cierra
 * antes de tiempo («Cerrar ahora», queda registrado) y la programada se cancela.
 */
@Component({
  selector: 'app-maintenance-windows',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>engineering</mat-icon>{{ i18n.t('escAdmin.windows') }}</h3>
      </div>
      <p class="adm-card__note mw__lead">{{ i18n.t('escAdmin.windowsHint') }}</p>
      @if (error(); as e) { <p class="adm-error mw__msg" role="alert">{{ e }}</p> }
      <form class="adm-card__body mw__form" (ngSubmit)="create()">
        <div class="adm-row">
          <label class="adm-field adm-field--narrow">
            <span class="adm-label">{{ i18n.t('escAdmin.appliesTo') }}</span>
            <select class="adm-input" name="winKind" [ngModel]="kind()" (ngModelChange)="kind.set($event); target.set('')">
              @for (k of kinds(); track k) { <option [value]="k">{{ i18n.t(kindKey(k)) }}</option> }
            </select>
          </label>
          <label class="adm-field">
            <span class="adm-label">{{ i18n.t('escAdmin.target') }}</span>
            <select class="adm-input" name="winTarget" [ngModel]="target()" (ngModelChange)="target.set($event)">
              <option value="">{{ i18n.t('teams.pick') }}</option>
              @for (o of options(); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
            </select>
          </label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('escAdmin.windowTitle') }}</span><input class="adm-input" name="winTitle" [placeholder]="i18n.t('escAdmin.windowTitlePlaceholder')" [ngModel]="title()" (ngModelChange)="title.set($event)" /></label>
        </div>
        <div class="adm-row">
          <label class="adm-field"><span class="adm-label">{{ i18n.t('audit.range.from') }}</span><input class="adm-input" name="winStart" type="datetime-local" [ngModel]="start()" (ngModelChange)="start.set($event)" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('audit.range.to') }}</span><input class="adm-input" name="winEnd" type="datetime-local" [ngModel]="end()" (ngModelChange)="end.set($event)" /></label>
          <label class="adm-switch-row mw__suppress">
            <span class="switch">
              <input class="switch__input" type="checkbox" role="switch" [checked]="suppress()" (change)="suppress.set(!suppress())" />
              <span class="switch__track" aria-hidden="true"></span>
            </span>
            <span class="adm-strong">{{ i18n.t('escAdmin.suppress') }}</span>
          </label>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !target() || !title().trim() || !start() || !end()"><mat-icon>event</mat-icon>{{ i18n.t('escAdmin.schedule') }}</button>
        </div>
      </form>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('escAdmin.windowTitle') }}</th><th>{{ i18n.t('escAdmin.appliesTo') }}</th><th>{{ i18n.t('escAdmin.when') }}</th><th>{{ i18n.t('escAdmin.notices') }}</th><th></th></tr></thead>
          <tbody>
            @for (w of windows(); track w.id) {
              <tr [class.mw__inactive]="!w.active">
                <td><strong>{{ w.title }}</strong>@if (w.agendaTaskId) { <span class="adm-small adm-secondary"> · {{ i18n.t('escAdmin.fromTask') }}</span> }</td>
                <td>{{ i18n.t(kindKey(kindOf(w))) }}: {{ targetName(w) }}</td>
                <td class="mono adm-small">{{ w.startsAt | date: 'dd/MM/yy HH:mm' }} → {{ w.endsAt | date: 'dd/MM/yy HH:mm' }}</td>
                <td><span class="pill" [class]="w.suppressNotifications ? 'tone-warn' : 'tone-neutral'">{{ i18n.t(w.suppressNotifications ? 'escAdmin.suppressed' : 'escAdmin.informative') }}</span></td>
                <td class="adm-num">
                  @switch (stateOf(w)) {
                    @case ('running') { <button type="button" class="adm-btn" [disabled]="busy()" (click)="closeNow(w)">{{ i18n.t('escAdmin.closeNow') }}</button> }
                    @case ('upcoming') { <button type="button" class="adm-btn" [disabled]="busy()" (click)="close(w)">{{ i18n.t('escAdmin.cancelWindow') }}</button> }
                    @case ('closedEarly') { <span class="pill tone-neutral">{{ i18n.tf('escAdmin.closedEarly', (w.closedAt | date: 'dd/MM HH:mm') ?? '') }}</span> }
                    @case ('ended') { <span class="pill tone-neutral">{{ i18n.t('escAdmin.ended') }}</span> }
                    @default { <span class="pill tone-neutral">{{ i18n.t('escAdmin.cancelled') }}</span> }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!windows().length) { <p class="adm-empty">{{ i18n.t('escAdmin.noWindows') }}</p> }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .mw__lead { padding-bottom: 0; }
    .mw__msg { margin: 8px 14px 0; }
    .mw__form { border-bottom: 1px solid var(--border-subtle); }
    .mw__suppress { align-self: center; flex: 0 0 auto; }
    .mw__inactive td { color: var(--text-muted); }
  `,
})
export class MaintenanceWindowsComponent implements OnInit {
  /** Destino ya elegido en la pantalla (p. ej. el servicio abierto en Escalamiento). */
  readonly presetServiceId = input<string | null>(null);

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(EscalationService);
  private readonly territory = inject(TerritoryService);
  private readonly modules = inject(ModuleAccessService);
  private readonly orgs = inject(OrganizationsService);
  private readonly agenda = inject(AgendaService);

  protected readonly windows = signal<MaintenanceWindow[]>([]);
  private readonly services = signal<SocService[]>([]);
  private readonly assets = signal<Asset[]>([]);
  private readonly units = signal<TerritorialUnit[]>([]);
  private readonly clients = signal<Organization[]>([]);
  private readonly areas = signal<{ id: string; name: string }[]>([]);
  private readonly teams = signal<TeamSummary[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly kind = signal<ScopeKind>('service');
  protected readonly target = signal('');
  protected readonly title = signal('');
  protected readonly start = signal('');
  protected readonly end = signal('');
  protected readonly suppress = signal(true);

  protected readonly kinds = computed<ScopeKind[]>(() => [
    ...(this.modules.noc() ? (['asset', 'unit'] as const) : []),
    ...(this.modules.soc() ? (['service'] as const) : []),
    'client', 'area', 'team',
  ]);
  protected readonly options = computed(() => {
    switch (this.kind()) {
      case 'asset':
        return this.assets().map((a) => ({ id: a.id, label: `${a.name} (${a.code})` }));
      case 'unit':
        return this.units().filter((u) => u.active).map((u) => ({ id: u.id, label: `${'— '.repeat(u.depth)}${u.name}` }));
      case 'client':
        return this.clients().map((c) => ({ id: c.id, label: c.name }));
      case 'area':
        return this.areas().map((a) => ({ id: a.id, label: a.name }));
      case 'team':
        return this.teams().map((t) => ({ id: t.id, label: t.name }));
      default:
        return this.services()
          .map((s) => ({ id: s.id, label: serviceLabel(s) }))
          .sort((a, b) => a.label.localeCompare(b.label));
    }
  });

  async ngOnInit(): Promise<void> {
    await this.modules.load();
    this.kind.set(this.kinds()[0] ?? 'service');
    await this.run(() =>
      Promise.all([
        this.refresh(),
        this.modules.soc() ? this.api.listServices().then((s) => this.services.set(s)) : null,
        this.modules.noc() ? this.api.listAssets().then((a) => this.assets.set(a)) : null,
        this.modules.noc() ? this.territory.list(1, 5000).then((r) => this.units.set(r.units)) : null,
        this.orgs.list({ clients: true, active: true }).then((c) => this.clients.set(c), () => this.clients.set([])),
        this.agenda.meta().then((m) => this.areas.set(m.areas), () => this.areas.set([])),
        this.orgs.listTeams().then((t) => this.teams.set(t.filter((x) => x.kind !== 'step')), () => this.teams.set([])),
      ]),
    );
    const preset = this.presetServiceId();
    if (preset && this.modules.soc()) {
      this.kind.set('service');
      this.target.set(preset);
    }
  }

  protected kindOf(s: WindowTarget): ScopeKind {
    if (s.assetId) return 'asset';
    if (s.territorialUnitId) return 'unit';
    if (s.organizationId) return 'client';
    if (s.areaId) return 'area';
    if (s.teamId) return 'team';
    return 'service';
  }

  /** En curso, programada, cerrada antes de tiempo, terminada o cancelada. */
  protected stateOf(w: MaintenanceWindow): 'running' | 'upcoming' | 'closedEarly' | 'ended' | 'cancelled' {
    const now = Date.now();
    if (!w.active) return 'cancelled';
    if (w.closedAt) return 'closedEarly';
    if (new Date(w.endsAt).getTime() <= now) return 'ended';
    return new Date(w.startsAt).getTime() <= now ? 'running' : 'upcoming';
  }

  protected kindKey(kind: ScopeKind): MessageKey {
    return `escAdmin.kind.${kind}` as MessageKey;
  }

  protected targetName(s: WindowTarget): string {
    if (s.organizationId) return this.clients().find((x) => x.id === s.organizationId)?.name ?? s.organizationId;
    if (s.areaId) return this.areas().find((x) => x.id === s.areaId)?.name ?? s.areaId;
    if (s.teamId) return this.teams().find((x) => x.id === s.teamId)?.name ?? s.teamId;
    if (s.assetId) return this.assets().find((x) => x.id === s.assetId)?.name ?? s.assetId;
    if (s.territorialUnitId) {
      const u = this.units().find((x) => x.id === s.territorialUnitId);
      return u ? `${u.name} (${u.code})` : s.territorialUnitId;
    }
    const svc = this.services().find((x) => x.id === s.serviceId);
    return svc ? serviceLabel(svc) : (s.serviceId ?? '');
  }

  protected async create(): Promise<void> {
    const id = this.target();
    const scope: WindowTarget = {
      asset: { assetId: id }, unit: { territorialUnitId: id }, service: { serviceId: id },
      client: { organizationId: id }, area: { areaId: id }, team: { teamId: id },
    }[this.kind()];
    await this.run(async () => {
      await this.api.createWindow({
        ...scope,
        title: this.title().trim(),
        // datetime-local viene sin zona: se interpreta en la hora local del navegador.
        startsAt: new Date(this.start()).toISOString(),
        endsAt: new Date(this.end()).toISOString(),
        suppressNotifications: this.suppress(),
      });
      this.title.set('');
      await this.refresh();
    });
  }

  protected async closeNow(w: MaintenanceWindow): Promise<void> {
    await this.run(async () => {
      await this.api.closeWindowNow(w.id);
      await this.refresh();
    });
  }

  protected async close(w: MaintenanceWindow): Promise<void> {
    await this.run(async () => {
      await this.api.closeWindow(w.id);
      await this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    this.windows.set(await this.api.listWindows());
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

/** "Cliente · Servicio": varios clientes tienen un servicio con el mismo nombre. */
function serviceLabel(s: { name: string; organizationName?: string | null }): string {
  return [s.organizationName, s.name].filter(Boolean).join(' · ');
}
