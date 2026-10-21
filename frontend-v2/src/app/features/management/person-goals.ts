import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Goal, ManagementService } from '../../core/management/management.service';
import { OrganizationsService } from '../../core/organizations/organizations.service';
import { TicketsService } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { GOAL_ICON, GOAL_TONE, goalStateKey } from './mgmt-format';
import { GoalDetailComponent } from './goal-detail';
import { GoalDialogComponent, GoalDialogData } from './goal-dialog';

import '../../core/i18n/packs/management';

/**
 * Metas de una persona en Mi equipo (spec/16 §4.4.5): la jefatura las ve en
 * la ficha de la persona, las crea y confirma las que cuentan para el bono.
 */
@Component({
  selector: 'app-person-goals',
  standalone: true,
  imports: [MatIconModule, GoalDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pg">
      <div class="pg__head"><span class="adm-label">{{ i18n.t('mg.team.goals') }}</span>
        <button type="button" class="adm-btn pg__push" (click)="create()"><mat-icon>flag</mat-icon>{{ i18n.t('mg.team.new') }}</button></div>
      @for (g of goals(); track g.id) {
        <button type="button" class="pg__row" [attr.aria-expanded]="open() === g.id" (click)="open.set(open() === g.id ? null : g.id)">
          <span>{{ g.name }}@if (g.bonus) { <span class="pg__bono"> · {{ i18n.t(bonusKey(g.bonus)) }}</span> }</span>
          <span class="pg__state text-{{ tone[g.state] }}"><mat-icon>{{ icon[g.state] }}</mat-icon>{{ i18n.t(stateKey(g.state)) }}</span>
        </button>
        @if (open() === g.id) { <div class="pg__detail"><app-goal-detail [goalId]="g.id" (changed)="load()" (deleted)="load()" /></div> }
      } @empty {
        <p class="adm-small adm-muted">{{ i18n.t('mg.team.none') }}</p>
      }
      @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
    </div>
  `,
  styles: `
    .pg { display: flex; flex-direction: column; gap: 4px; }
    .pg__head { display: flex; align-items: center; gap: 8px; }
    .pg__push { margin-left: auto; }
    .pg__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .pg__bono { color: var(--status-system); font-weight: 600; }
    .pg__state { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .pg__detail { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    mat-icon { width: 15px; height: 15px; font-size: 15px; }
  `,
})
export class PersonGoalsComponent {
  readonly personId = input.required<string>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly orgs = inject(OrganizationsService);
  private readonly tickets = inject(TicketsService);
  private readonly dialog = inject(Dialog);

  protected readonly tone = GOAL_TONE;
  protected readonly icon = GOAL_ICON;
  protected readonly stateKey = goalStateKey;
  protected readonly goals = signal<Goal[]>([]);
  protected readonly open = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.personId();
      this.open.set(null);
      void this.load();
    });
  }

  protected async load(): Promise<void> {
    try {
      this.goals.set(await this.api.goals({ person: this.personId() }));
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected bonusKey(b: string): MessageKey {
    return `mg.g.bonus.${b}` as MessageKey;
  }

  protected async create(): Promise<void> {
    try {
      const [meta, clients, scope] = await Promise.all([this.api.meta(), this.orgs.list({ clients: true, active: true }), this.tickets.scope()]);
      const data: GoalDialogData = { meta, clients: clients.map((c) => ({ id: c.id, name: c.name })), areas: scope.areas.map((a) => ({ id: a.id, name: a.name })),
        preset: { scope: 'person', personId: this.personId() } };
      this.dialog.open<Goal>(GoalDialogComponent, { data, ariaLabel: this.i18n.t('mg.gf.new') }).closed.subscribe((g) => {
        if (!g) return;
        void this.load();
        this.open.set(g.id);
      });
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }
}
