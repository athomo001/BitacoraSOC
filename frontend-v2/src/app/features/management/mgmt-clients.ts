import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ManagementService, MgmtAction, MgmtClient, MgmtClientDetail, MgmtMeta, MgmtTicket, MgmtTimelineEvent } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { problemDetail } from '../../core/http-error';
import { CLOCK_TONE, PRIORITY_SHORT, clockText } from '../../core/tickets/ticket-view';
import { addDays, isoDay, parseDay } from '../agenda/agenda-format';
import {
  GOAL_TONE, HEALTH_ICON, HEALTH_RANK, HEALTH_TONE, contactText, day, durationText, goalStateKey, healthKey, kindKey, pct, reasonText,
} from './mgmt-format';
import { ActionDialogComponent, ActionDialogData } from './action-dialog';
import { MgmtNotesComponent } from './mgmt-notes';
import { AccountDialogComponent, AccountDialogData } from './account-dialog';
import { ComplementSlot, ComplementsService } from '../../core/complements/complements.service';
import { ComplementFrameComponent } from '../../shared/complement-frame/complement-frame';
import { ExportDialogComponent, ExportDialogData } from './export-dialog';
import { GoalDialogComponent, GoalDialogData } from './goal-dialog';
import { MgmtNav } from './management';

/** «Mis cuentas» se recuerda por persona (solo en este navegador). */
const SCOPE_KEY = 'bitacora.mgmt.scope';

interface RenewalView {
  date: string;
  days: number;
  tone: '' | 'warn' | 'bad';
  /** Dentro de los 90 días: avance del eje (0 a 100). */
  progress: number | null;
  opens: string;
  steps: { name: string; due: string; state: 'done' | 'next' | 'todo'; closedAt?: string }[];
}

/**
 * Gestión → Clientes (spec/16 §4.4.1–4.4.3, §4.4.7): la cartera con su
 * semáforo (con el motivo bajo el color), «Todas / Mis cuentas», orden por
 * atención o por renovación, y la ficha: salud, renovación con cuenta
 * regresiva, cifras del mes, tickets, acciones, metas, comunicaciones y la
 * línea de tiempo. Sin nada abierto, «Cuenta al día».
 */
@Component({
  selector: 'app-mgmt-clients',
  standalone: true,
  imports: [DatePipe, MatIconModule, RouterLink, MgmtNotesComponent, ComplementFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mgmt-clients.html',
  styleUrl: './mgmt-clients.css',
})
export class MgmtClientsComponent {
  readonly meta = input.required<MgmtMeta>();
  readonly clients = input.required<MgmtClient[]>();
  readonly areas = input.required<{ id: string; name: string; resolves: boolean }[]>();
  readonly selectId = input<string | null>(null);
  readonly refresh = input(0);
  readonly navigate = output<MgmtNav>();
  readonly reload = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly prefs = inject(PreferencesService);
  private readonly dialog = inject(Dialog);
  private readonly features = inject(SystemFeaturesService);

  /** Sin la Ticketera (ni GLPI), la Gestión sigue sin columnas ni cifras de tickets. */
  protected readonly withTickets = computed(() => this.features.isEnabled('native_tickets'));
  protected readonly scope = signal<'all' | 'mine'>(this.readScope());
  protected readonly sort = signal<'attn' | 'renew'>('attn');
  protected readonly query = signal('');
  protected readonly selected = signal<string | null>(null);
  protected readonly detail = signal<MgmtClientDetail | null>(null);
  protected readonly tab = signal<'summary' | 'timeline' | 'notes' | `c:${string}`>('summary');
  private readonly complements = inject(ComplementsService);
  /** Pestañas que suman los complementos aprobados (10i). */
  protected readonly panels = computed(() => this.complements.slots().panels.filter((p) => p.target === 'client'));
  protected readonly currentPanel = computed(() => this.panels().find((p) => this.panelTab(p) === this.tab()) ?? null);

  protected panelTab(p: ComplementSlot): `c:${string}` {
    return `c:${p.slug}|${p.key}`;
  }

  /** Cuántas notas internas tiene el cliente (la pestaña lo muestra). */
  protected readonly notesCount = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly healthIcon = HEALTH_ICON;
  protected readonly healthTone = HEALTH_TONE;
  protected readonly goalTone = GOAL_TONE;
  protected readonly goalStateKey = goalStateKey;
  protected readonly healthKey = healthKey;
  protected readonly kindKey = kindKey;
  protected readonly prioShort = PRIORITY_SHORT;
  protected readonly pct = pct;

  protected readonly mineCount = computed(() => this.clients().filter((c) => c.mine).length);
  protected readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = this.clients().filter((c) => (this.scope() === 'all' || c.mine) && (!q || c.name.toLowerCase().includes(q)));
    return rows.sort(this.sort() === 'renew'
      ? (a, b) => (a.renewalDays ?? 1e6) - (b.renewalDays ?? 1e6) || a.name.localeCompare(b.name)
      : (a, b) => HEALTH_RANK[a.health.state] - HEALTH_RANK[b.health.state] || b.breached + b.lateActions - (a.breached + a.lateActions) || a.name.localeCompare(b.name));
  });

  /** Sin tickets abiertos, acciones pendientes ni metas: «Cuenta al día». */
  protected readonly clear = computed(() => {
    const d = this.detail();
    return !!d && !d.tickets.length && !d.actions.length && !d.goals.length;
  });

  protected readonly renewal = computed<RenewalView | null>(() => {
    const d = this.detail();
    const c = d?.client;
    if (!c?.renewal || c.renewalDays == null) return null;
    const days = c.renewalDays;
    const tone = days <= 30 ? 'bad' : days <= 90 ? 'warn' : '';
    const firstPending = d!.renewal.findIndex((s) => s.status !== 'done' && s.status !== 'skipped');
    return {
      date: c.renewal, days, tone,
      progress: days <= 90 ? Math.max(0, Math.min(100, ((90 - days) / 90) * 100)) : null,
      opens: isoDay(addDays(parseDay(c.renewal), -90)),
      steps: d!.renewal.map((s, i) => ({ name: s.name, due: s.due, closedAt: s.closedAt,
        state: s.status === 'done' || s.status === 'skipped' ? 'done' : i === firstPending ? 'next' : 'todo' })),
    };
  });

  constructor() {
    // Selección: la que pidió otra pestaña, la actual o el primero de la lista.
    effect(() => {
      const list = this.list();
      const want = this.selectId();
      untracked(() => {
        const cur = this.selected();
        const id = (want && list.some((c) => c.id === want) && !cur ? want : null) ?? (cur && list.some((c) => c.id === cur) ? cur : list[0]?.id ?? null);
        if (id !== cur) this.select(id);
      });
    });
    // Recarga silenciosa por SSE; la primera vuelta ya la pidió la selección.
    let lastTick = this.refresh();
    effect(() => {
      const tick = this.refresh();
      if (tick === lastTick) return;
      lastTick = tick;
      const id = untracked(() => this.selected());
      if (id) void this.loadDetail(id, true);
    });
  }

  private readScope(): 'all' | 'mine' {
    try {
      return localStorage.getItem(SCOPE_KEY) === 'mine' ? 'mine' : 'all';
    } catch {
      return 'all';
    }
  }

  protected setScope(s: 'all' | 'mine'): void {
    this.scope.set(s);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      // Sin almacenamiento, vale para esta visita.
    }
  }

  protected select(id: string | null): void {
    this.selected.set(id);
    this.tab.set('summary');
    this.notesCount.set(null);
    if (id) void this.loadDetail(id);
    else this.detail.set(null);
  }

  private async loadDetail(id: string, quiet = false): Promise<void> {
    if (!quiet) this.detail.set(null);
    try {
      const d = await this.api.client(id);
      if (this.selected() === id) this.detail.set(d);
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  private refreshAll(): void {
    this.reload.emit();
    const id = this.selected();
    if (id) void this.loadDetail(id, true);
  }

  // ===== Textos =====

  protected lang(): string {
    return this.prefs.language();
  }

  protected date(iso: string, withYear = false): string {
    return day(iso, this.lang(), withYear);
  }

  protected reason(c: MgmtClient): string {
    if (c.health.state === 'green') {
      return c.nextAction ? this.i18n.tf('mg.next', `${c.nextAction.name}, ${this.date(c.nextAction.due)}`) : this.i18n.t('mg.nothingNext');
    }
    return c.health.reasons[0] ? reasonText(c.health.reasons[0], this.i18n) : '';
  }

  protected allReasons(c: MgmtClient): string {
    return c.health.reasons.map((r) => reasonText(r, this.i18n)).join(' · ');
  }

  protected contact(c: MgmtClient): string {
    return contactText(c.health, this.i18n);
  }

  protected ticketsText(c: MgmtClient): string {
    const t = c.health.tickets;
    if (t.breached) return `${this.i18n.tf('mg.c.breached', t.breached)}${t.first ? `: ${t.first}` : ''}`;
    return this.i18n.t(t.open ? 'mg.c.allInSla' : 'mg.c.noTickets');
  }

  protected keyText(c: MgmtClient): string {
    const k = c.health.keyTasks;
    return k.late ? `${this.i18n.tf('mg.c.keyLate', k.late)}: ${k.first ?? ''}` : this.i18n.t('mg.c.keyOk');
  }

  protected slaText(t: MgmtTicket): string {
    if (!t.resolution) return '—';
    const x = clockText(t.resolution);
    return this.i18n.tf(x.key, x.value);
  }

  protected slaTone(t: MgmtTicket): string {
    return t.resolution ? CLOCK_TONE[t.resolution.state] : 'neutral';
  }

  /** «Lucía Vera» / «SOC N2 · sin tomar» / «Guardia SOC». */
  protected who(a: MgmtAction): string {
    if (a.holder) return a.holder;
    if (a.assigneeKind === 'person') return a.person ?? '';
    if (a.assigneeKind === 'guard') return a.team ?? '';
    return `${a.area} ${a.level ?? ''} · ${this.i18n.t('mg.a.untaken')}`;
  }

  protected dur(secs: number): string {
    return durationText(secs, this.lang());
  }

  protected tlIcon(e: MgmtTimelineEvent): string {
    return ({ ticket_open: 'confirmation_number', ticket_resolved: 'task_alt', action_done: 'check_circle', action_skipped: 'redo',
      report_incident: 'mail', report_bulletin: 'campaign', goal: 'flag', playbook: 'library_add_check' } as Record<string, string>)[e.kind] ?? 'circle';
  }

  protected tlText(e: MgmtTimelineEvent): string {
    const key = `mg.tl.${e.kind}` as MessageKey;
    const title = this.i18n.tf(key, e.title);
    if (e.kind === 'goal') return `${title}: ${e.detail ?? ''}`;
    if (e.kind.startsWith('action_') && e.detail) {
      const [who, kind] = e.detail.split('|');
      return `${title}${kind ? ` (${this.i18n.t(kindKey(kind as never))})` : ''}${who ? ` · ${who}` : ''}`;
    }
    return e.detail && e.kind !== 'ticket_open' ? `${title} · ${e.detail}` : e.detail ? `${title} (${e.detail})` : title;
  }

  protected commKey(kind: string): MessageKey {
    return kind === 'bulletin' ? 'mg.comm.bulletin' : 'mg.comm.incident';
  }

  // ===== Acciones =====

  private clientRef(): { id: string; name: string } | null {
    const c = this.detail()?.client;
    return c ? { id: c.id, name: c.name } : null;
  }

  protected newAction(ticket?: MgmtTicket, meeting = false, name?: string): void {
    const client = this.clientRef();
    if (!client) return;
    const data: ActionDialogData = { client, ticket: ticket ? { id: ticket.id, number: ticket.number } : undefined, meeting, name };
    this.dialog.open<boolean>(ActionDialogComponent, { data, ariaLabel: this.i18n.t(ticket ? 'mg.act.follow' : 'mg.act.new') })
      .closed.subscribe((ok) => ok && this.refreshAll());
  }

  protected newGoal(): void {
    const client = this.clientRef();
    if (!client) return;
    const data: GoalDialogData = { meta: this.meta(), clients: this.clients().map((c) => ({ id: c.id, name: c.name })),
      areas: this.areas(), preset: { scope: 'client', clientId: client.id } };
    this.dialog.open(GoalDialogComponent, { data, ariaLabel: this.i18n.t('mg.gf.new') }).closed.subscribe((g) => g && this.refreshAll());
  }

  protected editAccount(): void {
    const c = this.detail()?.client;
    if (!c) return;
    const data: AccountDialogData = { client: c, meta: this.meta() };
    this.dialog.open<boolean>(AccountDialogComponent, { data, ariaLabel: this.i18n.tf('mg.acc.title', c.name) })
      .closed.subscribe((ok) => ok && this.refreshAll());
  }

  protected exportSummary(): void {
    const c = this.detail()?.client;
    if (!c) return;
    const data: ExportDialogData = { clientId: c.id, period: 'month' };
    this.dialog.open(ExportDialogComponent, { data, ariaLabel: this.i18n.t('mg.exp.title') });
  }

  protected goPlaybook(key: string): void {
    this.navigate.emit({ tab: 'pb', clientId: this.selected() ?? undefined, playbook: key });
  }

  /** Aplica la plantilla de renovación desde la cuenta regresiva. */
  protected async applyRenewal(): Promise<void> {
    const c = this.detail()?.client;
    if (!c || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const pb = (await this.api.playbooks()).find((p) => p.systemKey === 'renewal');
      if (!pb) return;
      await this.api.applyPlaybook(pb.id, c.id);
      this.refreshAll();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
