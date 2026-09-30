import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  ActionLog,
  Asset,
  ChannelType,
  ContactResult,
  EscalationScope,
  EscalationService,
  MaintenanceWindow,
  NotifyOutcome,
  Resolution,
  ResolvedMember,
  ResolvedStep,
  ResolvedVia,
  StepMode,
  SocService,
} from '../../core/escalation/escalation.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { FlowState, flowState, formatCountdown, secondsUntilEscalation } from './escalation-flow';

type ScopeKind = 'asset' | 'unit' | 'service';

interface ScopeOption {
  id: string;
  label: string;
  hint: string;
}

const CHANNEL_ICON: Record<ChannelType, string> = { call: 'call', sms: 'sms', whatsapp: 'chat', email: 'mail', other: 'link' };

/**
 * Escalamiento / Despacho (Fase 7, HU-1/1t/1u/1z/2/3). Tarjetas de pasos
 * con flechas animadas portadas del escalation-flow-preview del legacy, más
 * lo que el legacy no tenía: botones de canal directos (tel:, wa.me, mailto:),
 * registro de cada intento con su resultado, paso en curso resaltado con su
 * cuenta regresiva y la línea de tiempo del incidente.
 *
 * La app no llama por teléfono: el operador llama desde el teléfono
 * dedicado y acá solo registra el resultado. El único envío automático es
 * el aviso por correo del botón "Enviar aviso".
 */
@Component({
  selector: 'app-escalation',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './escalation.html',
  styleUrl: './escalation.css',
})
export class EscalationComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly channelIcon = CHANNEL_ICON;
  /** Los dos resultados menos frecuentes van como botones secundarios. */
  protected readonly otherResults: ContactResult[] = ['busy', 'unreachable'];

  private readonly api = inject(EscalationService);
  private readonly territory = inject(TerritoryService);
  private readonly modules = inject(ModuleAccessService);
  private readonly route = inject(ActivatedRoute);

  // Módulo encendido en la instalación y dentro del alcance del usuario:
  // lo que no aplica ni se muestra ni se pide (evita los 403 de módulo).
  protected readonly socEnabled = this.modules.soc;
  protected readonly nocEnabled = this.modules.noc;

  protected readonly scopeKind = signal<ScopeKind>('asset');
  protected readonly filter = signal('');
  protected readonly selectedId = signal('');
  private readonly assets = signal<Asset[]>([]);
  private readonly units = signal<TerritorialUnit[]>([]);
  private readonly services = signal<SocService[]>([]);

  protected readonly resolution = signal<Resolution | null>(null);
  protected readonly notFound = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly windows = signal<MaintenanceWindow[]>([]);

  /** Inicio del incidente en curso: los intentos previos no cuentan. */
  protected readonly since = signal(new Date().toISOString());
  protected readonly actions = signal<ActionLog[]>([]);
  protected readonly notes = signal('');
  protected readonly lastChannel = signal<Record<string, ChannelType>>({});
  protected readonly flash = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly notifyMessage = signal('');
  protected readonly notifySeverity = signal('high');
  protected readonly notifyResult = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly notifying = signal(false);

  private readonly now = signal(Date.now());

  protected readonly options = computed<ScopeOption[]>(() => {
    const q = this.filter().trim().toLowerCase();
    let all: ScopeOption[];
    switch (this.scopeKind()) {
      case 'asset':
        all = this.assets().map((a) => ({ id: a.id, label: a.name, hint: [a.code, a.ipAddress].filter(Boolean).join(' · ') }));
        break;
      case 'unit':
        all = this.units().map((u) => ({ id: u.id, label: `${'— '.repeat(u.depth)}${u.name}`, hint: u.code }));
        break;
      default:
        all = this.services().map((s) => ({ id: s.id, label: s.name, hint: [s.code, s.organizationName].filter(Boolean).join(' · ') }));
    }
    return q ? all.filter((o) => `${o.label} ${o.hint}`.toLowerCase().includes(q)) : all;
  });

  protected readonly state = computed<FlowState | null>(() => {
    const res = this.resolution();
    return res ? flowState(res.steps, this.actions(), this.since()) : null;
  });

  protected readonly countdown = computed(() => {
    const res = this.resolution();
    const st = this.state();
    if (!res || !st || st.current === null) return null;
    const step = res.steps.find((s) => s.order === st.current);
    const secs = step ? secondsUntilEscalation(step, st.currentSince, this.now()) : null;
    return secs === null ? null : { text: formatCountdown(secs), overdue: secs < 0 };
  });

  protected readonly timeline = computed(() => [...this.actions()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async ngOnInit(): Promise<void> {
    await this.modules.load();
    if (!this.nocEnabled()) this.scopeKind.set('service');
    try {
      await Promise.all([
        this.nocEnabled() ? this.api.listAssets().then((a) => this.assets.set(a)) : null,
        this.nocEnabled() ? this.territory.list(1, 5000).then((r) => this.units.set(r.units)) : null,
        this.socEnabled() ? this.api.listServices().then((s) => this.services.set(s)) : null,
      ]);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.catalogError')));
    }
    // Enlazable desde otras pantallas: /escalation?assetId=… (o serviceId / territorialUnitId).
    const params = this.route.snapshot.queryParamMap;
    const pairs: [string, ScopeKind][] = [['assetId', 'asset'], ['territorialUnitId', 'unit'], ['serviceId', 'service']];
    for (const [param, kind] of pairs) {
      const id = params.get(param);
      if (id) {
        this.scopeKind.set(kind);
        await this.pick(id);
        break;
      }
    }
  }

  protected setKind(kind: ScopeKind): void {
    this.scopeKind.set(kind);
    this.filter.set('');
    this.selectedId.set('');
    this.resolution.set(null);
    this.notFound.set(false);
  }

  protected async pick(id: string): Promise<void> {
    this.selectedId.set(id);
    if (!id) return;
    this.since.set(this.storedSince() ?? this.startIncident());
    this.actions.set([]);
    this.notifyResult.set(null);
    this.flash.set(null);
    await this.load();
  }

  protected async newIncident(): Promise<void> {
    this.since.set(this.startIncident());
    this.actions.set([]);
    this.notifyResult.set(null);
    this.flash.set(this.i18n.t('esc.newIncidentFlash'));
  }

  /**
   * El inicio del incidente se recuerda por activo/servicio en esta pestaña
   * del navegador para que un F5 no borre la tarjeta a mitad de una
   * escalación. Pasadas 12 h (la misma ventana por defecto del backend) se
   * da por un incidente nuevo. Cuando la Fase 9 vincule la entrada de
   * bitácora, el inicio real pasa a ser el de la entrada.
   */
  private sinceKey(): string {
    return `bitacora.escalation.since.${this.scopeKind()}:${this.selectedId()}`;
  }

  private storedSince(): string | null {
    try {
      const value = sessionStorage.getItem(this.sinceKey());
      if (value && Date.now() - new Date(value).getTime() < 12 * 3600_000) return value;
    } catch {
      // almacenamiento bloqueado: se parte un incidente nuevo
    }
    return null;
  }

  private startIncident(): string {
    const now = new Date().toISOString();
    try {
      sessionStorage.setItem(this.sinceKey(), now);
    } catch {
      // sin almacenamiento solo se pierde el recordatorio tras un F5
    }
    return now;
  }

  private scope(): EscalationScope {
    const id = this.selectedId();
    switch (this.scopeKind()) {
      case 'asset':
        return { assetId: id };
      case 'unit':
        return { territorialUnitId: id };
      default:
        return { serviceId: id };
    }
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.notFound.set(false);
    try {
      const res = await this.api.resolve(this.scope());
      this.resolution.set(res);
      this.notFound.set(res === null);
      if (res?.policyId) {
        this.actions.set(await this.api.listActions(res.policyId, this.since()));
      }
      await this.loadWindows(res);
    } catch (error) {
      this.resolution.set(null);
      this.error.set(problemDetail(error, this.i18n.t('esc.resolveError')));
    } finally {
      this.loading.set(false);
    }
  }

  /** Ventanas vigentes del activo/servicio y de la zona resuelta. */
  private async loadWindows(res: Resolution | null): Promise<void> {
    const scopes: EscalationScope[] = [this.scope()];
    if (res?.resolvedUnit && this.scopeKind() !== 'unit') scopes.push({ territorialUnitId: res.resolvedUnit.id });
    try {
      const lists = await Promise.all(scopes.map((s) => this.api.listWindows(s, true)));
      // Una ventana puede venir por el activo y por su zona: se muestra una vez.
      this.windows.set([...new Map(lists.flat().map((w) => [w.id, w])).values()]);
    } catch {
      this.windows.set([]);
    }
  }

  protected stepStatus(step: ResolvedStep): string {
    return this.state()?.statusByStep.get(step.order) ?? 'pending';
  }

  protected memberResult(member: ResolvedMember): ContactResult | undefined {
    return member.contactId ? this.state()?.lastResultByContact.get(member.contactId) : undefined;
  }

  protected rememberChannel(member: ResolvedMember, channel: ChannelType): void {
    this.lastChannel.update((map) => ({ ...map, [member.id]: channel }));
  }

  protected chosenChannel(member: ResolvedMember): ChannelType {
    return this.lastChannel()[member.id] ?? 'call';
  }

  protected async record(step: ResolvedStep, member: ResolvedMember, result: ContactResult): Promise<boolean> {
    const res = this.resolution();
    if (!res || this.saving()) return false;
    this.saving.set(true);
    this.error.set(null);
    try {
      const outcome = await this.api.recordAction({
        ...this.scope(),
        policyId: res.policyId,
        stepOrder: step.order,
        memberId: member.id,
        channelType: this.chosenChannel(member),
        result,
        notes: this.notes().trim() || undefined,
        since: this.since(),
      });
      this.actions.update((list) => [...list, outcome.actionLog]);
      this.notes.set('');
      if (outcome.exhausted) {
        this.flash.set(this.i18n.t('esc.flashExhausted'));
      } else if (outcome.escalatedToNextStep) {
        this.flash.set(this.i18n.tf('esc.flashNextStep', `${outcome.nextStepOrder} · ${outcome.nextStepTeam?.name ?? ''}`));
      } else if (outcome.nextMember) {
        this.flash.set(this.i18n.tf('esc.flashNextMember', outcome.nextMember.name));
      } else if (result === 'answered') {
        this.flash.set(this.i18n.tf('esc.flashAnswered', member.name));
      } else {
        this.flash.set(null);
      }
      return true;
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.recordError')));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** El paso que sigue al indicado (null si es el último). */
  protected nextStep(step: ResolvedStep): ResolvedStep | null {
    const steps = [...(this.resolution()?.steps ?? [])].sort((a, b) => a.order - b.order);
    return steps.find((s) => s.order > step.order) ?? null;
  }

  /**
   * "Escalar (correo)" del artboard: registra que se escala a mano y avisa
   * por correo al paso siguiente, con la nota del intento o un texto por
   * defecto. La llamada sigue siendo manual; el correo es el único envío.
   */
  protected async escalate(step: ResolvedStep, member: ResolvedMember): Promise<void> {
    const next = this.nextStep(step);
    const note = this.notes().trim();
    const ok = await this.record(step, member, 'escalated_next_tier');
    if (!ok || !next) return;
    const message = note || this.i18n.tf('esc.escalateMessage', `${this.targetLabel()} · ${step.team.name} → ${next.team.name}`);
    await this.sendNotify(message, next.order);
  }

  protected async notify(): Promise<void> {
    if (!this.notifyMessage().trim()) return;
    if (await this.sendNotify(this.notifyMessage().trim())) this.notifyMessage.set('');
  }

  /** Envía el aviso (al primer paso, o al indicado) y deja el resultado a la vista. */
  private async sendNotify(message: string, stepOrder?: number): Promise<boolean> {
    if (this.notifying()) return false;
    this.notifying.set(true);
    this.notifyResult.set(null);
    try {
      const out: NotifyOutcome = await this.api.notify(this.scope(), message, this.notifySeverity(), stepOrder);
      if (out.sent) {
        const to = (out.recipients ?? []).filter((r) => r.email).map((r) => r.name).join(', ');
        this.notifyResult.set({ ok: true, text: this.i18n.tf('esc.notifySent', to || this.i18n.t('esc.notifyTeam')) });
        return true;
      }
      const reasonKey = `esc.notifyReason.${out.reason ?? 'unknown'}` as MessageKey;
      const extra = out.reason === 'maintenance_window' && out.maintenanceWindowTitle ? ` («${out.maintenanceWindowTitle}»)` : '';
      this.notifyResult.set({ ok: false, text: this.i18n.t(reasonKey) + extra });
    } catch (error) {
      this.notifyResult.set({ ok: false, text: problemDetail(error, this.i18n.t('esc.notifyError')) });
    } finally {
      this.notifying.set(false);
    }
    return false;
  }

  // ===== Etiquetas =====

  /** El nombre de lo que se eligió (activo, zona o servicio), para el encabezado. */
  protected readonly targetLabel = computed(() => this.options().find((o) => o.id === this.selectedId())?.label.replace(/^(— )+/, '') ?? '');

  protected resultKey(r: ContactResult): MessageKey {
    return `esc.result.${r}` as MessageKey;
  }

  protected channelKey(c: ChannelType): MessageKey {
    return `esc.channel.${c}` as MessageKey;
  }

  protected roleKey(role: string): MessageKey {
    return `teams.role.${role}` as MessageKey;
  }

  protected viaKey(via: ResolvedVia): MessageKey {
    return `esc.via.${via}` as MessageKey;
  }

  protected modeKey(mode: StepMode): MessageKey {
    return `escAdmin.mode.${mode}` as MessageKey;
  }

  protected statusKey(step: ResolvedStep): MessageKey {
    return `esc.status.${this.stepStatus(step)}` as MessageKey;
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('');
  }
}
