import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
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
  MODE_LABELS,
  MaintenanceWindow,
  NotifyOutcome,
  RESULT_LABELS,
  Resolution,
  ResolvedMember,
  ResolvedStep,
  SocService,
  VIA_LABELS,
} from '../../core/escalation/escalation.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';
import { ButtonComponent } from '../../shared/ui/button/button';
import { FlowState, flowState, formatCountdown, secondsUntilEscalation } from './escalation-flow';

type ScopeKind = 'asset' | 'unit' | 'service';

interface ScopeOption {
  id: string;
  label: string;
  hint: string;
}

const CHANNEL_LABELS: Record<ChannelType, string> = {
  call: 'Llamar',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  other: 'Otro',
};

const NOTIFY_REASONS: Record<string, string> = {
  maintenance_window: 'No se envió: hay una ventana de mantenimiento con supresión vigente',
  no_email_recipients: 'No se envió: nadie del primer paso tiene correo configurado',
  smtp_not_configured: 'No se envió: el correo saliente (SMTP) no está configurado — Administración → Correo',
  smtp_error: 'No se envió: el servidor de correo rechazó el envío',
};

const ROLE_LABELS: Record<string, string> = { primary: 'Principal', backup: 'Respaldo', lead: 'Líder' };

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
  imports: [FormsModule, DatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './escalation.html',
  styleUrl: './escalation.css',
})
export class EscalationComponent implements OnInit {
  protected readonly modeLabels = MODE_LABELS;
  protected readonly resultLabels = RESULT_LABELS;
  protected readonly channelLabels = CHANNEL_LABELS;
  protected readonly viaLabels = VIA_LABELS;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly results: ContactResult[] = ['answered', 'no_answer', 'busy', 'unreachable'];

  private readonly api = inject(EscalationService);
  private readonly territory = inject(TerritoryService);
  private readonly setup = inject(SetupService);
  private readonly route = inject(ActivatedRoute);

  protected readonly socEnabled = computed(() => this.setup.status()?.socEnabled ?? false);
  protected readonly nocEnabled = computed(() => this.setup.status()?.nocEnabled ?? false);

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
    await this.setup.loadStatus();
    if (!this.nocEnabled()) this.scopeKind.set('service');
    try {
      await Promise.all([
        this.nocEnabled() ? this.api.listAssets().then((a) => this.assets.set(a)) : null,
        this.nocEnabled() ? this.territory.list(1, 5000).then((r) => this.units.set(r.units)) : null,
        this.socEnabled() ? this.api.listServices().then((s) => this.services.set(s)) : null,
      ]);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron cargar los catálogos.'));
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
    this.flash.set('Nuevo incidente: los intentos anteriores ya no cuentan para este flujo.');
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
      this.error.set(problemDetail(error, 'No se pudo resolver la escalación.'));
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
      this.windows.set(lists.flat());
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

  protected async record(step: ResolvedStep, member: ResolvedMember, result: ContactResult): Promise<void> {
    const res = this.resolution();
    if (!res || this.saving()) return;
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
        this.flash.set('Se agotaron todos los pasos sin respuesta. Evalúa escalar por fuera del flujo.');
      } else if (outcome.escalatedToNextStep) {
        this.flash.set(`Escala al paso ${outcome.nextStepOrder}: ${outcome.nextStepTeam?.name ?? ''}.`);
      } else if (outcome.nextMember) {
        this.flash.set(`Siguiente en el paso ${step.order}: ${outcome.nextMember.name}.`);
      } else if (result === 'answered') {
        this.flash.set(`${member.name} contestó. Flujo detenido.`);
      } else {
        this.flash.set(null);
      }
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo registrar el intento.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async notify(): Promise<void> {
    if (!this.notifyMessage().trim() || this.notifying()) return;
    this.notifying.set(true);
    this.notifyResult.set(null);
    try {
      const out: NotifyOutcome = await this.api.notify(this.scope(), this.notifyMessage().trim(), this.notifySeverity());
      if (out.sent) {
        const to = (out.recipients ?? []).filter((r) => r.email).map((r) => r.name).join(', ');
        this.notifyResult.set({ ok: true, text: `Aviso enviado a ${to || 'los destinatarios del primer paso'}.` });
        this.notifyMessage.set('');
      } else {
        const extra = out.reason === 'maintenance_window' && out.maintenanceWindowTitle ? ` («${out.maintenanceWindowTitle}»)` : '';
        this.notifyResult.set({ ok: false, text: (NOTIFY_REASONS[out.reason ?? ''] ?? 'No se envió el aviso.') + extra });
      }
    } catch (error) {
      this.notifyResult.set({ ok: false, text: problemDetail(error, 'No se pudo enviar el aviso.') });
    } finally {
      this.notifying.set(false);
    }
  }
}
