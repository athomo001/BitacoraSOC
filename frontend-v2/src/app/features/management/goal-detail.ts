import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Goal, GoalStep, ManagementService } from '../../core/management/management.service';
import { AgendaService } from '../../core/agenda/agenda.service';
import { TicketsService } from '../../core/tickets/tickets.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { addDays, isoDay, parseDay } from '../agenda/agenda-format';
import { GOAL_ICON, GOAL_TONE, day, goalStateKey } from './mgmt-format';
import { GoalDialogComponent, GoalDialogData } from './goal-dialog';

import '../../core/i18n/packs/management';

type LinkKind = 'none' | 'ticket' | 'task';

/**
 * Detalle de una meta (spec/16 §4.4.5, diseño aprobado): datos, avance,
 * hitos (a mano o enlazados a un ticket o una tarea, que se marcan solos),
 * validación de la CSM en las certificaciones, historial y acciones (en
 * riesgo, cumplida, confirmar para el bono, reabrir). Lo usan Gestión → Metas, Agenda → Mis metas y Mi equipo.
 */
@Component({
  selector: 'app-goal-detail',
  standalone: true,
  imports: [DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './goal-detail.html',
  styleUrl: './goal-detail.css',
})
export class GoalDetailComponent {
  readonly goalId = input.required<string>();
  /** La meta cambió: la lista la refresca. */
  readonly changed = output<Goal>();
  readonly deleted = output<string>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly agenda = inject(AgendaService);
  private readonly tickets = inject(TicketsService);
  private readonly features = inject(SystemFeaturesService);
  private readonly orgs = inject(OrganizationsService);
  private readonly prefs = inject(PreferencesService);
  private readonly dialog = inject(Dialog);

  protected readonly goal = signal<Goal | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly adding = signal(false);
  protected readonly stepName = signal('');
  protected readonly link = signal<LinkKind>('none');
  protected readonly ticketNumber = signal('');
  protected readonly taskId = signal('');
  protected readonly tasks = signal<{ id: string; label: string }[]>([]);
  protected readonly reopening = signal(false);
  protected readonly newDate = signal('');
  protected readonly confirmDelete = signal(false);
  protected readonly failing = signal(false);
  protected readonly failReason = signal('');

  /** Sin la Ticketera, los hitos se enlazan solo a tareas. */
  protected readonly withTickets = computed(() => this.features.isEnabled('native_tickets'));
  protected readonly goalTone = GOAL_TONE;
  protected readonly goalIcon = GOAL_ICON;
  protected readonly goalStateKey = goalStateKey;

  protected readonly pct = computed(() => {
    const g = this.goal();
    if (!g) return 0;
    if (!g.milestones) return g.state === 'done' ? 100 : 0;
    return Math.round((g.milestonesDone / g.milestones) * 100);
  });
  protected readonly validationMissing = computed(() => {
    const g = this.goal();
    return !!g && g.validationRequired && !g.validatedAt;
  });
  protected readonly closed = computed(() => ['done', 'failed', 'not_needed'].includes(this.goal()?.state ?? ''));

  constructor() {
    effect(() => {
      const id = this.goalId();
      void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    this.adding.set(false);
    this.reopening.set(false);
    this.confirmDelete.set(false);
    try {
      this.goal.set(await this.api.goal(id));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  private async run(fn: () => Promise<Goal>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await fn();
      this.goal.set(g);
      this.changed.emit(g);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  /** Rindió y no pasó: queda el dato y sigue la regla de la persona. */
  protected async markNotAchieved(): Promise<void> {
    const g = this.goal();
    const reason = this.failReason().trim();
    if (!g || !reason) return;
    await this.run(() => this.api.notAchieved(g.id, reason));
    this.failing.set(false);
    this.failReason.set('');
  }

  protected date(iso: string): string {
    return day(iso, this.prefs.language(), true);
  }

  protected kindKey(k: string): MessageKey {
    return `mg.gk.${k}` as MessageKey;
  }

  protected bonusKey(b: string): MessageKey {
    return `mg.g.bonusAs.${b}` as MessageKey;
  }

  /** «TKT-2026-00047, Resuelto» / «Revisión de reglas, SOC, vence vie 30 oct». */
  protected linkText(s: GoalStep): string {
    if (s.ticketNumber) {
      const status = s.ticketStatus ? this.i18n.t(`tickets.status.${s.ticketStatus}` as MessageKey) : '';
      return [s.ticketNumber, status, s.ticketArea].filter(Boolean).join(', ');
    }
    if (s.taskName) return [s.taskName, s.taskArea, s.taskNextDue ? day(s.taskNextDue, this.prefs.language()) : ''].filter(Boolean).join(', ');
    return '';
  }

  protected doneText(s: GoalStep): string {
    if (!s.doneAt) return '';
    const when = new Date(s.doneAt).toLocaleDateString(this.prefs.language() === 'en' ? 'en-US' : 'es-CL', { day: 'numeric', month: 'short' });
    return [s.doneByName, when].filter(Boolean).join(', ');
  }

  protected toggle(s: GoalStep): void {
    const g = this.goal();
    if (!g || !g.canMark || s.ticketId || s.taskId) return;
    void this.run(() => this.api.markStep(g.id, s.id, !s.doneAt));
  }

  protected async startAdd(): Promise<void> {
    this.adding.set(!this.adding());
    this.stepName.set('');
    this.link.set('none');
    this.ticketNumber.set('');
    this.taskId.set('');
  }

  /** Las tareas que se pueden enlazar: las de los próximos 60 días (del cliente de la meta, si tiene). */
  protected async setLink(k: LinkKind): Promise<void> {
    this.link.set(k);
    if (k !== 'task' || this.tasks().length) return;
    try {
      const meta = await this.agenda.meta();
      const today = parseDay(meta.today);
      const occ = await this.agenda.calendar(meta.today, isoDay(addDays(today, 60)), { client: this.goal()?.clientId ?? '' });
      const seen = new Map<string, string>();
      for (const o of occ) if (!o.projected && !seen.has(o.task.id)) seen.set(o.task.id, `${o.task.name} · ${o.task.areaName}`);
      this.tasks.set([...seen].map(([id, label]) => ({ id, label })));
    } catch {
      this.tasks.set([]);
    }
  }

  protected async addStep(): Promise<void> {
    const g = this.goal();
    const name = this.stepName().trim();
    if (!g || !name) return;
    let ticketId: string | undefined;
    if (this.link() === 'ticket') {
      const number = this.ticketNumber().trim().toUpperCase();
      try {
        const found = (await this.tickets.list({ q: number })).items.find((t) => t.ticketNumber.toUpperCase() === number);
        if (!found) {
          this.error.set(this.i18n.t('mg.g.ticketNotFound'));
          return;
        }
        ticketId = found.id;
      } catch (e) {
        this.error.set(problemDetail(e, this.i18n.t('mg.g.ticketNotFound')));
        return;
      }
    }
    const taskId = this.link() === 'task' ? this.taskId() || undefined : undefined;
    await this.run(() => this.api.addStep(g.id, { name, ticketId, taskId }));
    if (!this.error()) this.adding.set(false);
  }

  protected removeStep(s: GoalStep): void {
    const g = this.goal();
    if (g) void this.run(() => this.api.deleteStep(g.id, s.id));
  }

  protected setRisk(on: boolean): void {
    const g = this.goal();
    if (g) void this.run(() => this.api.setRisk(g.id, on));
  }

  protected complete(): void {
    const g = this.goal();
    if (g) void this.run(() => this.api.complete(g.id));
  }

  protected confirm(): void {
    const g = this.goal();
    if (g) void this.run(() => this.api.confirm(g.id));
  }

  protected validate(): void {
    const g = this.goal();
    if (g) void this.run(() => this.api.validate(g.id));
  }

  protected reopen(): void {
    const g = this.goal();
    if (g && this.newDate()) void this.run(() => this.api.reopen(g.id, this.newDate()));
  }

  protected async edit(): Promise<void> {
    const g = this.goal();
    if (!g) return;
    try {
      const [meta, clients] = await Promise.all([this.api.meta(), this.orgs.list({ clients: true, active: true })]);
      const data: GoalDialogData = { meta, goal: g, clients: clients.map((c) => ({ id: c.id, name: c.name })), areas: meta.areas.map((a) => ({ id: a.id, name: a.name })) };
      this.dialog.open<Goal>(GoalDialogComponent, { data, ariaLabel: this.i18n.t('mg.gf.edit') }).closed.subscribe((saved) => {
        if (saved) {
          this.goal.set(saved);
          this.changed.emit(saved);
        }
      });
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected async remove(): Promise<void> {
    const g = this.goal();
    if (!g || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.deleteGoal(g.id);
      this.deleted.emit(g.id);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
