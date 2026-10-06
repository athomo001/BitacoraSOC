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
  EscalationIncident,
  EscalationScope,
  EscalationService,
  IncidentNote,
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
import { OrganizationsService } from '../../core/organizations/organizations.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { Ticket, TicketsService } from '../../core/tickets/tickets.service';
import { MaintenanceWindowsComponent } from './maintenance-windows';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { FlowState, StepStatus, flowState, formatCountdown, secondsUntilEscalation, stepContactKey } from './escalation-flow';

type ScopeKind = 'asset' | 'unit' | 'service';

interface ScopeOption {
  id: string;
  label: string;
  hint: string;
  /** Texto extra para el buscador que no se muestra (p. ej. el código del servicio). */
  search?: string;
}

/** Una fila de la lista del nivel: una persona, o la cabecera plegable de un pool. */
type LevelRow =
  | { kind: 'person'; member: ResolvedMember; inPool: boolean }
  | { kind: 'pool'; key: string; poolId: string; name: string; count: number; open: boolean; next: string | null };

/** Una línea del historial forense: intento, comentario o apertura. */
interface HistoryItem {
  id: string;
  at: string;
  icon: string;
  tone: string;
  text: string;
  detail?: string;
}

/** "TI-Mundo": el nombre del pool con su empresa, como lo nombra el área. */
function poolLabel(pool: { name: string; organization?: string }): string {
  return pool.organization ? `${pool.name}-${pool.organization}` : pool.name;
}

const CHANNEL_ICON: Record<ChannelType, string> = { call: 'call', sms: 'sms', whatsapp: 'chat', email: 'mail', other: 'link' };

/**
 * Escalamiento (rediseño del comentario del dueño #17, canvas v26 aprobado
 * 2026-10-05). Servicio y cliente destacados; cada escalamiento pertenece a
 * un incidente enlazado a un ticket GLPI o interno; arriba el flujo de
 * llamados del legacy (escalation-flow-preview) con flechas en movimiento;
 * abajo solo los contactos del nivel elegido, en filas compactas, con los
 * pools (TI-Mundo…) como una fila plegable que se llama en orden. El flujo
 * avanza solo al marcar "No contesta". A la derecha, el historial forense
 * del incidente con comentarios.
 *
 * La app no llama por teléfono: el operador llama desde el teléfono de
 * guardia y acá registra el resultado. "Escalar" avisa por correo al nivel
 * siguiente.
 */
@Component({
  selector: 'app-escalation',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule, MaintenanceWindowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './escalation.html',
  styleUrl: './escalation.css',
})
export class EscalationComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly channelIcon = CHANNEL_ICON;

  private readonly api = inject(EscalationService);
  private readonly territory = inject(TerritoryService);
  private readonly modules = inject(ModuleAccessService);
  private readonly orgs = inject(OrganizationsService);
  private readonly features = inject(SystemFeaturesService);
  private readonly ticketsApi = inject(TicketsService);
  private readonly route = inject(ActivatedRoute);

  protected readonly socEnabled = this.modules.soc;
  protected readonly nocEnabled = this.modules.noc;
  protected readonly ticketsEnabled = computed(() => this.features.isEnabled('native_tickets'));

  protected readonly scopeKind = signal<ScopeKind>('asset');
  protected readonly filter = signal('');
  protected readonly showMaintenance = signal(false);
  protected readonly selectedId = signal('');
  private readonly assets = signal<Asset[]>([]);
  private readonly units = signal<TerritorialUnit[]>([]);
  private readonly services = signal<SocService[]>([]);
  /** Mandante de cada organización ("DPP a través de Mundo"). */
  private readonly viaByOrg = signal<Record<string, string>>({});

  protected readonly resolution = signal<Resolution | null>(null);
  protected readonly notFound = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly windows = signal<MaintenanceWindow[]>([]);

  // Incidentes
  protected readonly incidents = signal<EscalationIncident[]>([]);
  protected readonly incidentId = signal<string | null>(null);
  protected readonly incident = computed(() => this.incidents().find((i) => i.id === this.incidentId()) ?? null);
  protected readonly creating = signal(false);
  protected readonly newTitle = signal('');
  protected readonly linkKind = signal<'glpi' | 'internal'>('glpi');
  protected readonly glpiNumber = signal('');
  protected readonly internalTicketId = signal('');
  protected readonly openTickets = signal<Ticket[]>([]);

  protected readonly actions = signal<ActionLog[]>([]);
  protected readonly noteList = signal<IncidentNote[]>([]);
  protected readonly comment = signal('');
  protected readonly attemptNote = signal('');
  protected readonly flash = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly lastChannel = signal<Record<string, ChannelType>>({});

  /** Nivel que se mira abajo (null = el que está en curso). */
  protected readonly viewed = signal<number | null>(null);
  /** Pools abiertos o cerrados a mano ("2:<poolId>" → abierto). */
  protected readonly poolToggles = signal<Record<string, boolean>>({});
  /** Fila con "Ocupado / Inalcanzable" desplegado. */
  protected readonly moreFor = signal<string | null>(null);

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
        all = this.services()
          .map((s) => ({ id: s.id, label: [s.organizationName, s.name].filter(Boolean).join(' · '), hint: '', search: s.code }))
          .sort((a, b) => a.label.localeCompare(b.label));
    }
    return q ? all.filter((o) => `${o.label} ${o.hint} ${o.search ?? ''}`.toLowerCase().includes(q)) : all;
  });

  /** Lo que se destaca arriba: servicio y cliente (o activo / zona en NOC). */
  protected readonly target = computed(() => {
    const id = this.selectedId();
    if (this.scopeKind() === 'service') {
      const s = this.services().find((x) => x.id === id);
      if (!s) return null;
      return { kind: 'service' as const, name: s.name, code: s.code, client: s.organizationName ?? '', via: this.viaByOrg()[s.organizationId] ?? '' };
    }
    if (this.scopeKind() === 'asset') {
      const a = this.assets().find((x) => x.id === id);
      return a ? { kind: 'asset' as const, name: a.name, code: a.code, client: '', via: '' } : null;
    }
    const u = this.units().find((x) => x.id === id);
    return u ? { kind: 'unit' as const, name: u.name, code: u.code, client: '', via: '' } : null;
  });

  protected readonly state = computed<FlowState | null>(() => {
    const res = this.resolution();
    const inc = this.incident();
    return res && inc ? flowState(res.steps, this.actions(), inc.openedAt) : null;
  });

  protected readonly steps = computed(() => [...(this.resolution()?.steps ?? [])].sort((a, b) => a.order - b.order));

  /** El nivel que se muestra abajo: el elegido, o el que está en curso, o el primero. */
  protected readonly shownStep = computed<ResolvedStep | null>(() => {
    const steps = this.steps();
    const order = this.viewed() ?? this.state()?.current ?? steps[0]?.order;
    return steps.find((s) => s.order === order) ?? steps[0] ?? null;
  });

  /** Se pueden registrar llamados en el nivel mostrado. */
  protected readonly actionable = computed(() => {
    const st = this.state();
    const step = this.shownStep();
    return !!st && !!step && !this.incident()?.closedAt && st.current === step.order;
  });

  protected readonly countdown = computed(() => {
    const st = this.state();
    if (!st || st.current === null) return null;
    const step = this.steps().find((s) => s.order === st.current);
    const secs = step ? secondsUntilEscalation(step, st.currentSince, this.now()) : null;
    return secs === null ? null : { text: formatCountdown(secs), overdue: secs < 0 };
  });

  protected readonly rows = computed<LevelRow[]>(() => {
    const step = this.shownStep();
    if (!step) return [];
    const st = this.state();
    const toggles = this.poolToggles();
    const out: LevelRow[] = [];
    const seenPools = new Set<string>();
    const onlyOnePool = step.team.members.length > 0 && step.team.members.every((m) => m.pool && m.pool.id === step.team.members[0].pool?.id);
    for (const m of step.team.members) {
      if (!m.pool) {
        out.push({ kind: 'person', member: m, inPool: false });
        continue;
      }
      if (seenPools.has(m.pool.id)) continue;
      seenPools.add(m.pool.id);
      const people = step.team.members.filter((x) => x.pool?.id === m.pool?.id);
      const key = `${step.order}:${m.pool.id}`;
      const nextMember = people.find((p) => p.id === st?.nextMemberId) ?? people.find((p) => !this.resultOf(step, p));
      const open = toggles[key] ?? (onlyOnePool || people.some((p) => p.id === st?.nextMemberId));
      out.push({ kind: 'pool', key, poolId: m.pool.id, name: poolLabel(m.pool), count: people.length, open, next: nextMember?.name ?? null });
      if (open) for (const p of people) out.push({ kind: 'person', member: p, inPool: true });
    }
    return out;
  });

  protected readonly history = computed<HistoryItem[]>(() => {
    const inc = this.incident();
    if (!inc) return [];
    const items: HistoryItem[] = this.actions().map((a) => ({
      id: a.id,
      at: a.createdAt,
      icon: a.result === 'answered' ? 'call' : a.result === 'escalated_next_tier' ? 'forward_to_inbox' : 'phone_missed',
      tone: a.result === 'answered' ? 'ok' : a.result === 'escalated_next_tier' ? 'warn' : 'bad',
      text: `${this.i18n.tf('esc.attempt', a.stepOrder)} · ${a.contactName ?? this.i18n.t('esc.internalUser')} · ${this.i18n.t(this.resultKey(a.result))}`,
      detail: [a.operatorUsername, a.notes].filter(Boolean).join(' · '),
    }));
    for (const n of this.noteList()) {
      items.push({ id: n.id, at: n.createdAt, icon: 'comment', tone: 'note', text: n.note, detail: n.username });
    }
    items.push({ id: 'opened', at: inc.openedAt, icon: 'flag', tone: 'info', text: this.i18n.tf('esc.incidentOpened', inc.openedBy), detail: this.linkLabel(inc) });
    return items.sort((a, b) => b.at.localeCompare(a.at));
  });

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
        this.orgs
          .list()
          .then((list) => this.viaByOrg.set(Object.fromEntries(list.filter((o) => o.viaName).map((o) => [o.id, o.viaName as string]))))
          .catch(() => null),
      ]);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.catalogError')));
    }
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
    this.incidents.set([]);
    this.incidentId.set(null);
  }

  protected async pick(id: string): Promise<void> {
    this.selectedId.set(id);
    this.flash.set(null);
    this.viewed.set(null);
    this.poolToggles.set({});
    this.incidents.set([]);
    this.incidentId.set(null);
    this.actions.set([]);
    this.noteList.set([]);
    if (!id) return;
    await this.load();
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
      const [res, incidents] = await Promise.all([this.api.resolve(this.scope()), this.api.listIncidents(this.scope())]);
      this.resolution.set(res);
      this.notFound.set(res === null);
      this.incidents.set(incidents);
      const open = incidents.find((i) => !i.closedAt);
      if (open) await this.selectIncident(open.id);
      else this.creating.set(res !== null);
      await this.loadWindows(res);
    } catch (error) {
      this.resolution.set(null);
      this.error.set(problemDetail(error, this.i18n.t('esc.resolveError')));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadWindows(res: Resolution | null): Promise<void> {
    const scopes: EscalationScope[] = [this.scope()];
    if (res?.resolvedUnit && this.scopeKind() !== 'unit') scopes.push({ territorialUnitId: res.resolvedUnit.id });
    try {
      const lists = await Promise.all(scopes.map((s) => this.api.listWindows(s, true)));
      this.windows.set([...new Map(lists.flat().map((w) => [w.id, w])).values()]);
    } catch {
      this.windows.set([]);
    }
  }

  // ===== Incidentes =====

  protected async selectIncident(id: string): Promise<void> {
    this.incidentId.set(id);
    this.creating.set(false);
    this.viewed.set(null);
    this.poolToggles.set({});
    this.flash.set(null);
    try {
      const [actions, notes] = await Promise.all([this.api.listIncidentActions(id), this.api.listIncidentNotes(id)]);
      this.actions.set(actions);
      this.noteList.set(notes);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.resolveError')));
    }
  }

  protected async openNewIncident(): Promise<void> {
    this.creating.set(!this.creating());
    if (this.creating() && this.ticketsEnabled() && !this.openTickets().length) {
      try {
        this.openTickets.set((await this.ticketsApi.list({ openOnly: true })).items);
      } catch {
        this.openTickets.set([]);
      }
    }
  }

  protected async createIncident(): Promise<void> {
    const title = this.newTitle().trim();
    if (!title || this.saving()) return;
    const link =
      this.linkKind() === 'glpi'
        ? { glpiTicket: this.glpiNumber().trim() || undefined }
        : { ticketId: this.internalTicketId() || undefined };
    this.saving.set(true);
    this.error.set(null);
    try {
      const inc = await this.api.createIncident(this.scope(), { title, ...link });
      this.incidents.update((list) => [inc, ...list]);
      this.newTitle.set('');
      this.glpiNumber.set('');
      this.internalTicketId.set('');
      await this.selectIncident(inc.id);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.incidentError')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleClosed(): Promise<void> {
    const inc = this.incident();
    if (!inc || this.saving()) return;
    this.saving.set(true);
    try {
      const updated = await this.api.setIncidentClosed(inc.id, !inc.closedAt);
      this.incidents.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.incidentError')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async addComment(): Promise<void> {
    const inc = this.incident();
    const note = this.comment().trim();
    if (!inc || !note || this.saving()) return;
    this.saving.set(true);
    try {
      const saved = await this.api.addIncidentNote(inc.id, note);
      this.noteList.update((list) => [...list, saved]);
      this.comment.set('');
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.incidentError')));
    } finally {
      this.saving.set(false);
    }
  }

  protected linkLabel(inc: EscalationIncident): string {
    if (inc.glpiTicket) return `GLPI #${inc.glpiTicket}`;
    if (inc.ticketNumber) return this.i18n.tf('esc.internalTicket', inc.ticketNumber);
    return this.i18n.t('esc.noLink');
  }

  // ===== Flujo =====

  protected stepStatus(step: ResolvedStep): StepStatus {
    return this.state()?.statusByStep.get(step.order) ?? 'pending';
  }

  protected statusKey(step: ResolvedStep): MessageKey {
    return `esc.status.${this.stepStatus(step)}` as MessageKey;
  }

  /** Resumen del nivel en su tarjeta: el único con su teléfono; si son varios, los primeros (un pool cuenta como uno). */
  protected stepWho(step: ResolvedStep): string {
    const names: string[] = [];
    const pools = new Set<string>();
    for (const m of step.team.members) {
      if (m.pool) {
        if (pools.has(m.pool.id)) continue;
        pools.add(m.pool.id);
        names.push(`${this.i18n.t('esc.pool')} ${poolLabel(m.pool)} (${step.team.members.filter((x) => x.pool?.id === m.pool?.id).length})`);
      } else {
        names.push(m.name);
      }
    }
    if (names.length === 1 && !pools.size) {
      const phone = step.team.members[0]?.channels.find((c) => c.channelType === 'call')?.value;
      return phone ? `${names[0]} · ${phone}` : names[0];
    }
    if (!names.length) return this.i18n.t('esc.noMembers');
    return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
  }

  protected viewStep(step: ResolvedStep): void {
    this.viewed.set(step.order === this.state()?.current ? null : step.order);
    this.moreFor.set(null);
  }

  protected togglePool(key: string, open: boolean): void {
    this.poolToggles.update((t) => ({ ...t, [key]: !open }));
  }

  protected resultOf(step: ResolvedStep, m: ResolvedMember): ContactResult | undefined {
    return m.contactId ? this.state()?.lastResultByStepContact.get(stepContactKey(step.order, m.contactId)) : undefined;
  }

  protected isNext(m: ResolvedMember): boolean {
    return this.actionable() && this.state()?.nextMemberId === m.id;
  }

  /** Tiene teléfono: solo entonces hay un resultado de llamada que registrar. */
  protected callable(m: ResolvedMember): boolean {
    return m.channels.some((c) => c.channelType === 'call' || c.channelType === 'sms' || c.channelType === 'whatsapp');
  }

  protected phoneOf(m: ResolvedMember): string | null {
    return m.channels.find((c) => c.channelType === 'call' || c.channelType === 'whatsapp' || c.channelType === 'sms')?.value ?? null;
  }

  protected phoneHref(m: ResolvedMember): string | null {
    return m.channels.find((c) => c.channelType === 'call')?.href ?? null;
  }

  protected mailOf(m: ResolvedMember): string | null {
    return m.channels.find((c) => c.channelType === 'email')?.value ?? null;
  }

  /** Nivel siguiente al indicado (null si es el último). */
  protected nextStep(step: ResolvedStep): ResolvedStep | null {
    return this.steps().find((s) => s.order > step.order) ?? null;
  }

  /** Niveles posteriores al en curso a los que se puede saltar. */
  protected canJump(step: ResolvedStep): boolean {
    const st = this.state();
    return !!st && st.current !== null && step.order > st.current && !this.incident()?.closedAt;
  }

  protected async record(step: ResolvedStep, member: ResolvedMember, result: ContactResult, notes?: string): Promise<boolean> {
    const res = this.resolution();
    const inc = this.incident();
    if (!res || !inc || this.saving()) return false;
    this.saving.set(true);
    this.error.set(null);
    this.moreFor.set(null);
    try {
      const outcome = await this.api.recordAction({
        ...this.scope(),
        policyId: res.policyId,
        stepOrder: step.order,
        memberId: member.id,
        channelType: result === 'escalated_next_tier' ? 'email' : (this.lastChannel()[member.id] ?? 'call'),
        result,
        notes: notes ?? (this.attemptNote().trim() || undefined),
        incidentId: inc.id,
      });
      this.actions.update((list) => [...list, outcome.actionLog]);
      this.attemptNote.set('');
      this.viewed.set(null);
      if (outcome.exhausted) this.flash.set(this.i18n.t('esc.flashExhausted'));
      else if (outcome.escalatedToNextStep) this.flash.set(this.i18n.tf('esc.flashNextStep', `${outcome.nextStepOrder} · ${outcome.nextStepTeam?.name ?? ''}`));
      else if (outcome.nextMember) this.flash.set(this.i18n.tf('esc.flashNextMember', outcome.nextMember.name));
      else if (result === 'answered') this.flash.set(this.i18n.tf('esc.flashAnswered', member.name));
      else this.flash.set(null);
      return true;
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.recordError')));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** "Saltar a este nivel": cierra los niveles intermedios como escalados a mano. */
  protected async jumpTo(target: ResolvedStep): Promise<void> {
    let st = this.state();
    while (st && st.current !== null && st.current < target.order) {
      const step = this.steps().find((s) => s.order === st?.current);
      const member = step?.team.members[0];
      if (!step || !member) return;
      if (!(await this.record(step, member, 'escalated_next_tier', this.i18n.tf('esc.jumpNote', target.order)))) return;
      st = this.state();
    }
  }

  /** "Escalar": registra que se escala a mano y avisa por correo al nivel siguiente. */
  protected async escalate(step: ResolvedStep, member: ResolvedMember): Promise<void> {
    const next = this.nextStep(step);
    const note = this.attemptNote().trim();
    const inc = this.incident();
    if (!(await this.record(step, member, 'escalated_next_tier')) || !next) return;
    const target = this.target();
    const message = note || this.i18n.tf('esc.escalateMessage', `${inc?.title ?? ''} · ${target?.client ? target.client + ' · ' : ''}${target?.name ?? ''} · ${step.team.name} → ${next.team.name}`);
    try {
      const out: NotifyOutcome = await this.api.notify(this.scope(), message, 'high', next.order);
      if (!out.sent) {
        const extra = out.reason === 'maintenance_window' && out.maintenanceWindowTitle ? ` («${out.maintenanceWindowTitle}»)` : '';
        this.flash.set(this.i18n.t(`esc.notifyReason.${out.reason ?? 'unknown'}` as MessageKey) + extra);
      }
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('esc.notifyError')));
    }
  }

  protected rememberChannel(member: ResolvedMember, channel: ChannelType): void {
    this.lastChannel.update((map) => ({ ...map, [member.id]: channel }));
  }

  // ===== Etiquetas =====

  protected resultKey(r: ContactResult): MessageKey {
    return `esc.result.${r}` as MessageKey;
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

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('');
  }
}
