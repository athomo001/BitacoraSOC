import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Goal, GoalScope, ManagementService, MgmtClient, MgmtMeta } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { GOAL_ICON, GOAL_TONE, goalStateKey } from './mgmt-format';
import { GoalDetailComponent } from './goal-detail';
import { GoalDialogComponent, GoalDialogData } from './goal-dialog';

type Filter = 'open' | 'risk' | 'closed' | 'all';
const SCOPES: ('all' | GoalScope)[] = ['all', 'client', 'area', 'person'];
const FILTERS: Filter[] = ['open', 'risk', 'closed', 'all'];

/**
 * Gestión → Metas (spec/16 §4.4.5): pestañas Todas, Clientes, Áreas y
 * Personas; filtro por estado y el detalle a la derecha. Las de una persona
 * solo aparecen a quien las puede ver (la persona, su jefatura, quien la
 * creó y el admin).
 */
@Component({
  selector: 'app-mgmt-goals',
  standalone: true,
  imports: [MatIconModule, GoalDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mgo">
      <section class="adm-card">
        <div class="adm-tabs" role="tablist">
          @for (s of scopes; track s) {
            <button type="button" role="tab" class="adm-tab" [attr.aria-selected]="scope() === s" (click)="scope.set(s)">{{ i18n.t(scopeKey(s)) }} <span class="adm-cnt">{{ count(s) }}</span></button>
          }
        </div>
        <div class="mgo__bar">
          <span class="adm-hint">{{ i18n.t('mg.g.state') }}</span>
          @for (f of filters; track f) { <button type="button" class="seg" [attr.aria-pressed]="filter() === f" (click)="filter.set(f)">{{ i18n.t(filterKey(f)) }}</button> }
          <button type="button" class="adm-btn adm-btn--primary mgo__push" (click)="create()"><mat-icon>add</mat-icon>{{ i18n.t('mg.newGoal') }}</button>
        </div>
        @if (error(); as e) { <p class="adm-error mgo__pad" role="alert">{{ e }}</p> }
        @for (g of list(); track g.id) {
          <button type="button" class="mgo__row" [attr.aria-current]="selected() === g.id" (click)="selected.set(g.id)">
            <span class="mgo__cell"><b>{{ g.name }}</b>
              <span class="mgo__who"><mat-icon>{{ g.personId ? 'person' : g.clientId ? 'business' : 'groups' }}</mat-icon>{{ who(g) }}
                @if (g.bonus) { <span class="mgo__bono">{{ i18n.t(bonusKey(g.bonus)) }}</span> }</span></span>
            <span class="mgo__prog"><span class="meter"><span [style.width.%]="progress(g)"></span></span>
              <span class="adm-hint">{{ g.milestones ? i18n.tf('mg.g.progress', g.milestonesDone + ' ' + i18n.t('mg.g.of') + ' ' + g.milestones) : i18n.t('mg.g.noSteps') }}</span></span>
            <span class="mgo__state text-{{ goalTone[g.state] }}"><mat-icon>{{ goalIcon[g.state] }}</mat-icon>{{ i18n.t(goalStateKey(g.state)) }}</span>
          </button>
        } @empty {
          <p class="adm-empty">{{ i18n.t('mg.g.empty') }}</p>
        }
      </section>
      <section class="adm-card">
        @if (selected(); as id) {
          <app-goal-detail [goalId]="id" (changed)="onChanged($event)" (deleted)="onDeleted($event)" />
        } @else {
          <p class="adm-empty">{{ i18n.t('mg.g.pick') }}</p>
        }
      </section>
    </div>
  `,
  styles: `
    .mgo { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .mgo__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); }
    .mgo__push { margin-left: auto; }
    .mgo__row { display: grid; grid-template-columns: minmax(0, 1fr) 150px 120px; gap: 12px; align-items: center; width: 100%; padding: 10px 14px; border: none; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .mgo__row:hover { background: var(--bg-surface-hover); }
    .mgo__row[aria-current="true"] { background: var(--accent-soft); }
    .mgo__cell { display: flex; flex-direction: column; min-width: 0; }
    .mgo__who { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; margin-top: 2px; color: var(--text-muted); font-size: 11.5px; }
    .mgo__bono { color: var(--status-system); font-weight: 600; }
    .mgo__prog { display: flex; flex-direction: column; gap: 3px; }
    .mgo__state { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .mgo__pad { padding: 10px 14px; }
    @media (width <= 900px) {
      .mgo { grid-template-columns: minmax(0, 1fr); }
      .mgo__row { grid-template-columns: minmax(0, 1fr) auto; }
      .mgo__prog { display: none; }
    }
  `,
})
export class MgmtGoalsComponent {
  readonly meta = input.required<MgmtMeta>();
  readonly clients = input.required<MgmtClient[]>();
  readonly areas = input.required<{ id: string; name: string; resolves: boolean }[]>();
  readonly refresh = input(0);

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly dialog = inject(Dialog);

  protected readonly scopes = SCOPES;
  protected readonly filters = FILTERS;
  protected readonly goalTone = GOAL_TONE;
  protected readonly goalIcon = GOAL_ICON;
  protected readonly goalStateKey = goalStateKey;
  protected readonly goals = signal<Goal[]>([]);
  protected readonly scope = signal<'all' | GoalScope>('all');
  protected readonly filter = signal<Filter>('open');
  protected readonly selected = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly list = computed(() => this.goals().filter((g) => (this.scope() === 'all' || g.scope === this.scope()) && this.matches(g)));

  constructor() {
    effect(() => {
      this.refresh();
      untracked(() => void this.load());
    });
    effect(() => {
      const list = this.list();
      untracked(() => {
        if (!list.some((g) => g.id === this.selected())) this.selected.set(list[0]?.id ?? null);
      });
    });
  }

  private matches(g: Goal): boolean {
    switch (this.filter()) {
      case 'open': return ['open', 'risk', 'confirm'].includes(g.state);
      case 'risk': return g.state === 'risk';
      case 'closed': return g.state === 'done' || g.state === 'failed';
      default: return true;
    }
  }

  private async load(): Promise<void> {
    try {
      this.goals.set(await this.api.goals());
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected count(s: 'all' | GoalScope): number {
    return this.goals().filter((g) => s === 'all' || g.scope === s).length;
  }

  protected scopeKey(s: string): MessageKey {
    return `mg.g.scope.${s}` as MessageKey;
  }

  protected filterKey(f: Filter): MessageKey {
    return `mg.g.f.${f}` as MessageKey;
  }

  protected bonusKey(b: string): MessageKey {
    return `mg.g.bonus.${b}` as MessageKey;
  }

  protected who(g: Goal): string {
    if (g.personId) return g.personName ?? '';
    return [g.clientName, g.areaName].filter(Boolean).join(', ') || this.i18n.t('mg.g.general');
  }

  protected progress(g: Goal): number {
    if (!g.milestones) return g.state === 'done' ? 100 : 0;
    return (g.milestonesDone / g.milestones) * 100;
  }

  protected create(): void {
    const s = this.scope();
    const data: GoalDialogData = {
      meta: this.meta(), clients: this.clients().map((c) => ({ id: c.id, name: c.name })), areas: this.areas(),
      preset: s === 'all' ? undefined : { scope: s },
    };
    this.dialog.open<Goal>(GoalDialogComponent, { data, ariaLabel: this.i18n.t('mg.gf.new') }).closed.subscribe((g) => {
      if (!g) return;
      this.filter.set('open');
      void this.load().then(() => this.selected.set(g.id));
    });
  }

  protected onChanged(g: Goal): void {
    this.goals.update((list) => list.map((x) => (x.id === g.id ? { ...x, ...g } : x)));
  }

  protected onDeleted(id: string): void {
    this.goals.update((list) => list.filter((x) => x.id !== id));
  }
}
