import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TeamArea, TeamCondition, TeamPerson, TeamService, TeamTicket, TeamView } from '../../core/team/team.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { AdminGuardsComponent } from '../admin/admin-guards';
import { AdminEscalationComponent } from '../admin/admin-escalation';
import { TeamGuardsComponent } from './team-guards';
import { TeamMonthlyComponent } from './team-monthly';
import { PersonGoalsComponent } from '../management/person-goals';

import '../../core/i18n/packs/team';

const CONDITION_STYLE: Record<TeamCondition, { icon: string; tone: string }> = {
  office: { icon: 'apartment', tone: 'tone-neutral' },
  telework: { icon: 'home', tone: 'tone-ok' },
  guardia: { icon: 'shield', tone: 'tone-info' },
  vacation: { icon: 'beach_access', tone: 'tone-bad' },
  medical_leave: { icon: 'healing', tone: 'tone-bad' },
  medical_appointment: { icon: 'medical_services', tone: 'tone-warn' },
  training: { icon: 'school', tone: 'tone-accent' },
};

/**
 * Mi equipo: la jefatura de área (spec/16 §3.5, 9d; canvas "Jefatura de
 * área: Mi equipo", aprobado por el dueño 2026-10-13). La gente de sus
 * áreas, cómo está hoy (Dotación y guardias) y su carga de tickets; agregar
 * personas, cambiarles el grupo y darlas de baja. El backend aplica los
 * límites (solo sus áreas, nunca admin) y lo deja en Auditoría.
 */
@Component({
  selector: 'app-team',
  standalone: true,
  imports: [FormsModule, RouterLink, MatIconModule, AdminGuardsComponent, AdminEscalationComponent, TeamGuardsComponent, TeamMonthlyComponent, PersonGoalsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="tm__head no-print">
      <div>
        <h1 class="tm__title">{{ i18n.t('nav.team') }}</h1>
        <p class="adm-muted tm__lead">{{ i18n.t('team.lead') }}</p>
      </div>
      @if (areas().length > 1) {
        <div class="tm__areas" role="group" [attr.aria-label]="i18n.t('team.area')">
          <span class="adm-label">{{ i18n.t('team.area') }}</span>
          @for (a of areas(); track a.code) {
            <button type="button" class="seg" [attr.aria-pressed]="area() === a.code" (click)="pickArea(a.code)">{{ a.name }}</button>
          }
        </div>
      }
    </header>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    @if (view(); as v) {
      <div class="tm__tabs no-print" role="tablist">
        <button type="button" role="tab" class="seg" [attr.aria-pressed]="tab() === 'people'" [attr.aria-selected]="tab() === 'people'" (click)="tab.set('people')"><mat-icon>badge</mat-icon>{{ i18n.t('team.tab.people') }}</button>
        <button type="button" role="tab" class="seg" [attr.aria-pressed]="tab() === 'guards'" [attr.aria-selected]="tab() === 'guards'" (click)="tab.set('guards')"><mat-icon>shield</mat-icon>{{ i18n.t('team.tab.guards') }}</button>
        <button type="button" role="tab" class="seg" [attr.aria-pressed]="tab() === 'escalation'" [attr.aria-selected]="tab() === 'escalation'" (click)="tab.set('escalation')"><mat-icon>call_split</mat-icon>{{ i18n.t('team.tab.escalation') }}</button>
        <button type="button" role="tab" class="seg" [attr.aria-pressed]="tab() === 'monthly'" [attr.aria-selected]="tab() === 'monthly'" (click)="tab.set('monthly')"><mat-icon>insights</mat-icon>{{ i18n.t('team.tab.monthly') }}</button>
      </div>
      <!-- Cada área monta sus propias guardias y políticas (el @for las recrea al cambiar de área). -->
      @if (tab() === 'guards') {
        @for (code of [v.area.code]; track code) {
          <app-team-guards [area]="code" [areaName]="v.area.name" [people]="v.people" (changed)="guardsTimeline()?.reload()" />
          <app-admin-guards [area]="code" />
        }
      }
      @if (tab() === 'escalation') {
        @for (code of [v.area.code]; track code) { <app-admin-escalation [area]="code" /> }
      }
      @if (tab() === 'monthly') {
        <app-team-monthly [area]="v.area.code" [areaName]="v.area.name" />
      }
    }

    @if (loaded() && !areas().length) {
      <p class="adm-empty">{{ i18n.t('team.noAreas') }}</p>
    } @else if (tab() === 'people' && view(); as v) {
      <div class="tm__stats">
        <div class="adm-card tm__stat"><span class="adm-label">{{ i18n.t('team.stat.people') }}</span><strong class="mono">{{ v.stats.people }}</strong><span class="adm-small adm-muted">{{ i18n.t('team.stat.peopleHint') }}</span></div>
        <div class="adm-card tm__stat"><span class="adm-label">{{ i18n.t('team.stat.tickets') }}</span><strong class="mono">{{ v.stats.tickets }}</strong><span class="adm-small adm-muted">{{ i18n.t('team.stat.ticketsHint') }}</span></div>
        <div class="adm-card tm__stat"><span class="adm-label">{{ i18n.t('team.stat.breached') }}</span><strong class="mono text-bad">{{ v.stats.breached }}</strong><span class="adm-small adm-muted">{{ i18n.t('team.stat.breachedHint') }}</span></div>
        <div class="adm-card tm__stat"><span class="adm-label">{{ i18n.t('team.stat.away') }}</span><strong class="mono text-warn">{{ v.stats.away }}</strong><span class="adm-small adm-muted">{{ i18n.t('team.stat.awayHint') }}</span></div>
      </div>

      <div class="tm__grid">
        <section class="adm-card">
          <div class="adm-card__head">
            <h2 class="adm-card__title"><mat-icon>badge</mat-icon>{{ i18n.tf('team.people', v.area.name) }}</h2>
            <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="openAdd()"><mat-icon>person_add</mat-icon>{{ i18n.t('team.add') }}</button>
          </div>
          @if (!v.people.length) {
            <p class="adm-empty">{{ i18n.t('team.empty') }}</p>
          } @else {
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr>
                  <th>{{ i18n.t('team.col.person') }}</th><th>{{ i18n.t('team.col.group') }}</th><th>{{ i18n.t('team.col.today') }}</th>
                  <th class="adm-num">{{ i18n.t('team.col.tickets') }}</th><th class="adm-num">{{ i18n.t('team.col.breached') }}</th>
                </tr></thead>
                <tbody>
                  @for (p of v.people; track p.id) {
                    <tr class="adm-row-click" tabindex="0" [class.adm-row--active]="mode() === 'person' && selectedId() === p.id" [class.tm__off]="!p.active"
                        (click)="pick(p)" (keydown.enter)="pick(p)">
                      <td><strong>{{ p.fullName || p.username }}</strong><div class="adm-small adm-muted mono">{{ p.username }}</div></td>
                      <td>
                        @for (g of p.groups; track g.id) { <span class="pill tone-accent tm__gap">{{ g.name }}</span> }
                        @if (!p.active) { <span class="pill tone-neutral">{{ i18n.t('team.inactive') }}</span> }
                      </td>
                      <td><span class="pill" [class]="'pill ' + cond(p.today).tone"><mat-icon>{{ cond(p.today).icon }}</mat-icon>{{ i18n.t(condKey(p.today)) }}</span></td>
                      <td class="adm-num mono">{{ p.tickets }}</td>
                      <td class="adm-num mono" [class.text-bad]="p.breached > 0" [class.adm-muted]="!p.breached">{{ p.breached }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="adm-card">
          @if (created(); as c) {
            <div class="adm-card__head"><h2 class="adm-card__title"><mat-icon>key</mat-icon>{{ c.username }}</h2></div>
            <div class="tm__body">
              <p>{{ i18n.tf('team.created', c.username) }}</p>
              <div class="tm__pwd"><code class="mono">{{ c.tempPassword }}</code>
                <button type="button" class="adm-btn" (click)="copy(c.tempPassword)"><mat-icon>content_copy</mat-icon>{{ i18n.t(copied() ? 'team.copied' : 'team.copy') }}</button>
              </div>
              <p class="adm-small adm-muted">{{ i18n.t('team.createdHint') }}</p>
              <div class="tm__actions"><button type="button" class="adm-btn adm-btn--primary" (click)="closeCreated()">{{ i18n.t('team.close') }}</button></div>
            </div>
          } @else if (mode() === 'add') {
            <div class="adm-card__head"><h2 class="adm-card__title"><mat-icon>person_add</mat-icon>{{ i18n.tf('team.addTo', v.area.name) }}</h2></div>
            <form class="tm__body" (submit)="$event.preventDefault(); create()">
              <div class="tm__two">
                <label class="adm-field"><span class="adm-label">{{ i18n.t('team.f.name') }}</span>
                  <input class="adm-input" name="fullName" maxlength="120" autocomplete="off" [ngModel]="draft().fullName" (ngModelChange)="setDraft('fullName', $event)" /></label>
                <label class="adm-field"><span class="adm-label">{{ i18n.t('team.f.username') }}</span>
                  <input class="adm-input mono" name="username" maxlength="40" autocomplete="off" [ngModel]="draft().username" (ngModelChange)="setDraft('username', $event)" /></label>
              </div>
              <label class="adm-field"><span class="adm-label">{{ i18n.t('team.f.email') }}</span>
                <input class="adm-input mono" name="email" type="email" maxlength="160" autocomplete="off" [ngModel]="draft().email" (ngModelChange)="setDraft('email', $event)" /></label>
              <div class="adm-field">
                <span class="adm-label">{{ i18n.t('team.f.group') }}</span>
                @if (v.groups.length) {
                  <div class="tm__chips">
                    @for (g of v.groups; track g.id) {
                      <button type="button" class="seg" [attr.aria-pressed]="draft().groupId === g.id" (click)="setDraft('groupId', g.id)">{{ g.name }}</button>
                    }
                  </div>
                } @else {
                  <p class="adm-small text-warn">{{ i18n.t('team.noGroups') }}</p>
                }
              </div>
              <p class="adm-small adm-muted">{{ i18n.t('team.addHint') }}</p>
              <div class="tm__actions">
                <button type="button" class="adm-btn" (click)="mode.set('person')">{{ i18n.t('team.cancel') }}</button>
                <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !canCreate()"><mat-icon>person_add</mat-icon>{{ i18n.t('team.create') }}</button>
              </div>
            </form>
          } @else if (selected(); as p) {
            <div class="adm-card__head">
              <h2 class="adm-card__title"><mat-icon>person</mat-icon>{{ p.fullName || p.username }}</h2>
              <span class="adm-small adm-muted mono">{{ p.username }}</span>
            </div>
            <div class="tm__body">
              <div class="adm-field">
                <span class="adm-label">{{ i18n.t('team.groupLevel') }}</span>
                @if (p.editable) {
                  <div class="tm__chips">
                    @for (g of v.groups; track g.id) {
                      <button type="button" class="seg" [disabled]="busy()" [attr.aria-pressed]="hasGroup(p, g.id)" (click)="setGroup(p, g.id)">{{ g.name }}</button>
                    }
                  </div>
                } @else {
                  <div class="tm__chips">@for (g of p.groups; track g.id) { <span class="pill tone-accent">{{ g.name }}</span> }</div>
                  <p class="adm-small adm-muted">{{ i18n.t('team.notEditable') }}</p>
                }
              </div>
              <div class="adm-field">
                <span class="adm-label">{{ i18n.t('team.week') }}</span>
                <div class="tm__week">
                  @for (d of p.week; track d.date; let i = $index) {
                    <span class="tm__day" [class]="'tm__day ' + cond(d.condition).tone" [title]="i18n.t(condKey(d.condition))">
                      <span class="adm-small">{{ i18n.t(dayKey(i)) }}</span>
                      <mat-icon [attr.aria-label]="i18n.t(condKey(d.condition))">{{ cond(d.condition).icon }}</mat-icon>
                    </span>
                  }
                </div>
              </div>
              <div class="adm-field">
                <span class="adm-label">{{ i18n.t('team.openTickets') }}</span>
                @for (t of tickets(); track t.id) {
                  <a class="tm__ticket" [routerLink]="['/tickets']" [queryParams]="{ id: t.id }">
                    <span class="mono adm-small adm-muted">{{ t.number }}</span>
                    <span class="tm__grow">{{ t.title }}</span>
                    <span class="pill" [class.tone-bad]="t.breached" [class.tone-ok]="!t.breached">{{ i18n.t(t.breached ? 'team.late' : 'team.onTime') }}</span>
                  </a>
                } @empty {
                  <p class="adm-small adm-muted">{{ i18n.t('team.noTickets') }}</p>
                }
              </div>
              <!-- Metas de la persona (Gestión CSM, 9.4): las pone y confirma la jefatura. -->
              <app-person-goals [personId]="p.id" />
              @if (p.editable) {
                @if (confirming()) {
                  <div class="tm__confirm" role="alert">
                    <span>{{ i18n.tf('team.confirmDeactivate', p.fullName || p.username) }}</span>
                    <button type="button" class="adm-btn" (click)="confirming.set(false)">{{ i18n.t('team.cancel') }}</button>
                    <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="setActive(p, false)">{{ i18n.t('team.deactivate') }}</button>
                  </div>
                } @else {
                  <div class="tm__actions tm__between">
                    <span class="adm-small adm-muted">{{ i18n.t('team.audited') }}</span>
                    @if (p.active) {
                      <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="confirming.set(true)"><mat-icon>person_off</mat-icon>{{ i18n.t('team.deactivate') }}</button>
                    } @else {
                      <button type="button" class="adm-btn" [disabled]="busy()" (click)="setActive(p, true)"><mat-icon>person</mat-icon>{{ i18n.t('team.reactivate') }}</button>
                    }
                  </div>
                }
              }
            </div>
          } @else {
            <p class="adm-empty">{{ i18n.t('team.pick') }}</p>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tm__head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .tm__title { margin: 0; font-size: 18px; font-weight: 600; }
    .tm__lead { margin: 2px 0 0; }
    .tm__areas { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
    .tm__tabs { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle); }
    .tm__tabs mat-icon { width: 14px; height: 14px; font-size: 14px; vertical-align: -2px; margin-right: 4px; }
    .tm__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .tm__stat { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; }
    .tm__stat strong { font-size: 22px; }
    .tm__grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .tm__off { opacity: 0.55; }
    .tm__gap { margin-right: 4px; }
    .tm__body { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; }
    .tm__body p { margin: 0; }
    .tm__two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tm__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .tm__actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .tm__between { justify-content: space-between; }
    .tm__week { display: flex; gap: 4px; }
    .tm__day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 0; border-radius: var(--radius-sm, 6px); }
    .tm__ticket { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); color: inherit; text-decoration: none; }
    .tm__ticket:hover .tm__grow { text-decoration: underline; }
    .tm__grow { flex: 1; min-width: 0; }
    .tm__pwd { display: flex; align-items: center; gap: 8px; }
    .tm__pwd code { font-size: 16px; padding: 6px 10px; border-radius: 6px; background: var(--bg-surface-hover); user-select: all; }
    .tm__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--status-critical-bg); }
    .tm__confirm span { flex: 1; min-width: 180px; }
    .text-bad { color: var(--status-critical); }
    .text-warn { color: var(--status-warning); }
    @media (width <= 1100px) { .tm__grid { grid-template-columns: minmax(0, 1fr); } }
    @media (width <= 700px) { .tm__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tm__two { grid-template-columns: 1fr; } }
  `,
})
export class TeamComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TeamService);

  protected readonly tab = signal<'people' | 'guards' | 'escalation' | 'monthly'>('people');
  protected readonly guardsTimeline = viewChild(AdminGuardsComponent);
  protected readonly areas = signal<TeamArea[]>([]);
  protected readonly area = signal('');
  protected readonly view = signal<TeamView | null>(null);
  protected readonly loaded = signal(false);
  protected readonly mode = signal<'person' | 'add'>('person');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly tickets = signal<TeamTicket[]>([]);
  protected readonly draft = signal({ fullName: '', username: '', email: '', groupId: '' });
  protected readonly created = signal<{ username: string; tempPassword: string } | null>(null);
  protected readonly copied = signal(false);
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selected = computed(() => {
    const people = this.view()?.people ?? [];
    return people.find((p) => p.id === this.selectedId()) ?? null;
  });
  protected readonly canCreate = computed(() => {
    const d = this.draft();
    return !!d.fullName.trim() && !!d.username.trim() && d.email.includes('@') && !!d.groupId;
  });

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      const areas = await this.api.areas();
      this.areas.set(areas);
      if (areas.length) await this.pickArea(areas[0].code);
    });
    this.loaded.set(true);
  }

  protected cond(c: TeamCondition) {
    return CONDITION_STYLE[c] ?? CONDITION_STYLE.office;
  }

  protected condKey(c: TeamCondition): MessageKey {
    return `team.cond.${c in CONDITION_STYLE ? c : 'office'}` as MessageKey;
  }

  protected dayKey(i: number): MessageKey {
    return `team.day.${i}` as MessageKey;
  }

  protected hasGroup(p: TeamPerson, groupId: string): boolean {
    return p.groups.some((g) => g.id === groupId);
  }

  protected async pickArea(code: string): Promise<void> {
    this.area.set(code);
    this.mode.set('person');
    this.created.set(null);
    this.selectedId.set(null);
    await this.run(() => this.load());
  }

  private async load(): Promise<void> {
    const view = await this.api.team(this.area());
    this.view.set(view);
    const keep = view.people.find((p) => p.id === this.selectedId()) ?? view.people[0];
    if (keep) await this.select(keep);
  }

  private async select(p: TeamPerson): Promise<void> {
    this.selectedId.set(p.id);
    this.confirming.set(false);
    this.tickets.set(p.tickets ? await this.api.tickets(this.area(), p.id) : []);
  }

  protected async pick(p: TeamPerson): Promise<void> {
    this.mode.set('person');
    this.created.set(null);
    await this.run(() => this.select(p));
  }

  protected openAdd(): void {
    this.created.set(null);
    this.draft.set({ fullName: '', username: '', email: '', groupId: this.view()?.groups[0]?.id ?? '' });
    this.mode.set('add');
  }

  protected setDraft(field: 'fullName' | 'username' | 'email' | 'groupId', value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  protected async create(): Promise<void> {
    if (!this.canCreate()) return;
    await this.run(async () => {
      const result = await this.api.create({ area: this.area(), ...this.draft() });
      this.copied.set(false);
      this.created.set({ username: result.username, tempPassword: result.tempPassword });
      this.selectedId.set(result.id);
      this.mode.set('person');
      await this.load();
    });
  }

  protected closeCreated(): void {
    this.created.set(null);
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      // Sin portapapeles (http o permiso negado): la contraseña queda a la vista para copiarla a mano.
    }
  }

  protected async setGroup(p: TeamPerson, groupId: string): Promise<void> {
    if (this.hasGroup(p, groupId) && p.groups.length === 1) return;
    await this.run(async () => {
      await this.api.setGroup(this.area(), p.id, groupId);
      await this.load();
    });
  }

  protected async setActive(p: TeamPerson, active: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.setActive(this.area(), p.id, active);
      this.confirming.set(false);
      await this.load();
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('team.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
