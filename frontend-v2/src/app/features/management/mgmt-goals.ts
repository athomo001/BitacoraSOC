import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Goal, GoalRule, GoalScope, GoalState, ManagementService, MgmtClient, MgmtMeta } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { GOAL_ICON, GOAL_TONE, RANK_ORDER, goalStateKey } from './mgmt-format';
import { GoalDetailComponent } from './goal-detail';
import { GoalDialogComponent, GoalDialogData } from './goal-dialog';

type Filter = 'open' | 'risk' | 'closed' | 'all';
const SCOPES: ('all' | GoalScope)[] = ['all', 'client', 'area', 'person'];
const FILTERS: Filter[] = ['open', 'risk', 'closed', 'all'];
const RULES: GoalRule[] = ['all', 'any', 'primary', 'secondary'];
const CHIP_ORDER: GoalState[] = ['done', 'confirm', 'open', 'risk', 'failed', 'not_needed'];

/** Una persona con sus metas (una sola fila en la lista; spec/16 §4.4.5). */
interface PersonGroup {
  key: string;
  userId?: string;
  name: string;
  initial: string;
  rule?: GoalRule;
  canRule: boolean;
  goals: Goal[];
  chips: { state: GoalState; n: number }[];
}
type Row = { key: string; goal?: Goal; person?: PersonGroup };

/**
 * Gestión → Metas (spec/16 §4.4.5): pestañas Todas, Clientes, Áreas y
 * Personas; filtro por estado y el detalle a la derecha. Las de una persona
 * solo aparecen a quien las puede ver (la persona, su jefatura, quien la
 * creó y el admin), agrupadas en una fila por persona con su regla
 * (diseño aprobado 2026-10-21).
 */
@Component({
  selector: 'app-mgmt-goals',
  standalone: true,
  imports: [MatIconModule, NgTemplateOutlet, GoalDetailComponent],
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
        <ng-template #goalRow let-g let-inPerson="inPerson">
          <button type="button" class="mgo__row" [class.mgo__row--in]="inPerson" [attr.aria-current]="selected() === g.id" (click)="selected.set(g.id)">
            <span class="mgo__cell"><b [class.mgo__off]="g.state === 'not_needed'">{{ g.name }}</b>
              <span class="mgo__who">
                @if (inPerson) {
                  @if (g.bonus) { <span class="mgo__bono">{{ i18n.t(bonusKey(g.bonus)) }}</span> }
                } @else {
                  <mat-icon>{{ g.clientId ? 'business' : 'groups' }}</mat-icon>{{ who(g) }}
                }
              </span></span>
            <span class="mgo__prog"><span class="meter"><span [style.width.%]="progress(g)"></span></span>
              <span class="adm-hint">{{ g.milestones ? i18n.tf('mg.g.progress', g.milestonesDone + ' ' + i18n.t('mg.g.of') + ' ' + g.milestones) : i18n.t('mg.g.noSteps') }}</span></span>
            <span class="mgo__state text-{{ toneOf(g) }}"><mat-icon>{{ iconOf(g) }}</mat-icon>{{ i18n.t(goalStateKey(g.state)) }}</span>
          </button>
        </ng-template>
        @for (row of rows(); track row.key) {
          @if (row.person; as p) {
            <button type="button" class="mgo__person" [attr.aria-expanded]="!collapsed().has(p.key)" (click)="toggle(p.key)">
              <span class="mgo__av" aria-hidden="true">{{ p.initial }}</span>
              <span class="mgo__cell"><b>{{ p.name }}</b>@if (p.rule) { <span class="mgo__who">{{ i18n.t(ruleKey(p.rule)) }}</span> }</span>
              <span class="mgo__chips">@for (c of p.chips; track c.state) { <span class="mgo__chip text-{{ goalTone[c.state] }}">{{ c.n }} {{ i18n.t(goalStateKey(c.state)).toLowerCase() }}</span> }</span>
              <mat-icon>{{ collapsed().has(p.key) ? 'expand_more' : 'expand_less' }}</mat-icon>
            </button>
            @if (!collapsed().has(p.key)) {
              @if (p.canRule && p.userId) {
                <div class="mgo__rule">
                  <label>{{ i18n.t('mg.rule.label') }}
                    <select name="goalRule" class="adm-input" (change)="setRule(p.userId, val($event))">
                      @for (r of rules; track r) { <option [value]="r" [selected]="p.rule === r">{{ i18n.t(ruleKey(r)) }}</option> }
                    </select></label>
                  <span class="adm-hint">{{ i18n.t(ruleHintKey(p.rule ?? 'all')) }}</span>
                </div>
              }
              @for (g of p.goals; track g.id) { <ng-container *ngTemplateOutlet="goalRow; context: { $implicit: g, inPerson: true }" /> }
            }
          } @else if (row.goal) {
            <ng-container *ngTemplateOutlet="goalRow; context: { $implicit: row.goal, inPerson: false }" />
          }
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
    .mgo__person { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto 18px; gap: 10px; align-items: center; width: 100%; padding: 10px 14px; border: none; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .mgo__person:hover { background: var(--bg-surface-hover); }
    .mgo__av { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 700; }
    .mgo__chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
    .mgo__chip { padding: 1px 7px; border: 1px solid var(--border-subtle); border-radius: 10px; font-size: 11px; font-weight: 600; }
    .mgo__rule { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 14px 8px 54px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-app); }
    .mgo__rule label { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 12px; }
    .mgo__row--in { padding-left: 54px; background: var(--bg-app); }
    .mgo__off { color: var(--text-muted); text-decoration: line-through; }
    @media (width <= 900px) {
      .mgo { grid-template-columns: minmax(0, 1fr); }
      .mgo__row { grid-template-columns: minmax(0, 1fr) auto; }
      .mgo__prog { display: none; }
      .mgo__row--in, .mgo__rule { padding-left: 14px; }
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
  protected readonly rules = RULES;
  /** Personas plegadas (por defecto se ven abiertas). */
  protected readonly collapsed = signal<Set<string>>(new Set());
  protected readonly goalTone = GOAL_TONE;
  protected readonly goalIcon = GOAL_ICON;
  protected readonly goalStateKey = goalStateKey;
  protected readonly goals = signal<Goal[]>([]);
  protected readonly scope = signal<'all' | GoalScope>('all');
  protected readonly filter = signal<Filter>('open');
  protected readonly selected = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly list = computed(() => this.goals().filter((g) => (this.scope() === 'all' || g.scope === this.scope()) && this.matches(g)));

  /** Las metas de cliente o área una por fila; las de una persona, en una fila por persona. */
  protected readonly rows = computed<Row[]>(() => {
    const out: Row[] = [];
    const people = new Map<string, PersonGroup>();
    for (const g of this.list()) {
      if (g.scope !== 'person') {
        out.push({ key: g.id, goal: g });
        continue;
      }
      const key = g.personId ?? `ext:${(g.personEmail ?? g.personName ?? g.id).toLowerCase()}`;
      let p = people.get(key);
      if (!p) {
        const name = g.personName || '—';
        p = { key, userId: g.personId, name, initial: name.charAt(0).toUpperCase(), rule: g.personRule, canRule: !!g.canRule, goals: [], chips: [] };
        people.set(key, p);
      }
      p.canRule ||= !!g.canRule;
      p.goals.push(g);
    }
    const all = this.goals();
    for (const p of [...people.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      p.goals.sort((a, b) => (RANK_ORDER[a.bonus ?? ''] ?? 9) - (RANK_ORDER[b.bonus ?? ''] ?? 9) || a.dueDate.localeCompare(b.dueDate));
      // El resumen cuenta todas sus metas, no solo las del filtro.
      const counts = new Map<GoalState, number>();
      for (const g of all) {
        const key = g.personId ?? `ext:${(g.personEmail ?? g.personName ?? g.id).toLowerCase()}`;
        if (g.scope === 'person' && key === p.key) counts.set(g.state, (counts.get(g.state) ?? 0) + 1);
      }
      p.chips = CHIP_ORDER.filter((s) => counts.has(s)).map((s) => ({ state: s, n: counts.get(s)! }));
      out.push({ key: p.key, person: p });
    }
    return out;
  });

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
      case 'closed': return g.state === 'done' || g.state === 'failed' || g.state === 'not_needed';
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

  /** En Personas cuenta personas; en Todas, cada persona cuenta una vez. */
  protected count(s: 'all' | GoalScope): number {
    const goals = this.goals().filter((g) => s === 'all' || g.scope === s);
    const people = new Set(goals.filter((g) => g.scope === 'person').map((g) => g.personId ?? g.personEmail ?? g.personName));
    return goals.filter((g) => g.scope !== 'person').length + people.size;
  }

  protected toneOf(g: Goal): string {
    return this.goalTone[g.state];
  }

  protected iconOf(g: Goal): string {
    return this.goalIcon[g.state];
  }

  protected toggle(key: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected ruleKey(r: GoalRule): MessageKey {
    return `mg.rule.${r}` as MessageKey;
  }

  protected ruleHintKey(r: GoalRule): MessageKey {
    return `mg.rule.hint.${r}` as MessageKey;
  }

  protected val(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }

  protected async setRule(userId: string, rule: string): Promise<void> {
    try {
      await this.api.setPersonRule(userId, rule as GoalRule);
      await this.load();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    }
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
    if (g.scope === 'person') return g.personName ?? '';
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

  // Una meta lograda o borrada puede cambiar a las demás de la persona (su regla).
  protected onChanged(g: Goal): void {
    this.goals.update((list) => list.map((x) => (x.id === g.id ? { ...x, ...g } : x)));
    if (g.scope === 'person') void this.load();
  }

  protected onDeleted(id: string): void {
    const gone = this.goals().find((x) => x.id === id);
    this.goals.update((list) => list.filter((x) => x.id !== id));
    if (gone?.scope === 'person') void this.load();
  }
}
