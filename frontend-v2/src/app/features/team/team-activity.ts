import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivityKind, ActivityView, TeamService } from '../../core/team/team.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/team';

const PERIODS = [7, 30, 90];
const MONTHS_BACK = 12;
const DAYS = [1, 2, 3, 4, 5, 6, 7];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Pasos de la escala (sin contar el 0). */
const STEPS = 5;

/** La noche: de 22:00 a 06:59. */
function isNight(hour: number): boolean {
  return hour >= 22 || hour < 7;
}

function isWeekend(day: number): boolean {
  return day >= 6;
}

function hh(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

interface PersonRow { id: string; name: string; level: string; total: number; night: number; weekend: number }

/**
 * Mi equipo → Actividad (10f; decisión del dueño 2026-10-28): el mapa de
 * calor día × hora del legacy (Reportes → Mapa de calor) con todo el trabajo
 * de la gente del área, no solo las entradas, para ver cuánto se trabaja de
 * noche y ajustar la dotación. Los datos salen de la Auditoría, a la hora real
 * de cada acción; los filtros por tipo y persona se aplican acá.
 */
@Component({
  selector: 'app-team-activity',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h2 class="adm-card__title"><mat-icon>local_fire_department</mat-icon>{{ i18n.tf('team.ac.title', areaName()) }}</h2>
        <span class="ac__tools adm-push">
          @if (data(); as d) { <span class="adm-small adm-muted">{{ range(d) }}</span> }
          @for (n of periods; track n) {
            <button type="button" class="seg" [attr.aria-pressed]="monthOffset() === null && days() === n" (click)="pickDays(n)">{{ i18n.tf('team.q.days', n) }}</button>
          }
          <span class="ac__month">
            <button type="button" class="adm-icon-btn" [disabled]="shownOffset() >= monthsBack" [attr.aria-label]="i18n.t('team.mo.prev')" (click)="moveMonth(1)"><mat-icon>chevron_left</mat-icon></button>
            <button type="button" class="seg ac__month-label" [attr.aria-pressed]="monthOffset() !== null" (click)="moveMonth(0)">{{ monthLabel() }}</button>
            <button type="button" class="adm-icon-btn" [disabled]="shownOffset() <= 0" [attr.aria-label]="i18n.t('team.mo.next')" (click)="moveMonth(-1)"><mat-icon>chevron_right</mat-icon></button>
          </span>
        </span>
      </div>

      @if (data(); as d) {
        <div class="ac__filters">
          <div class="ac__chips" role="group" [attr.aria-label]="i18n.t('team.ac.kinds')">
            @for (k of d.kinds; track k) {
              <button type="button" class="seg" [attr.aria-pressed]="kinds().has(k)" (click)="toggleKind(k)">{{ i18n.t(kindKey(k)) }}</button>
            }
          </div>
          <label class="ac__person">
            <span class="adm-label">{{ i18n.t('team.ac.person') }}</span>
            <select class="adm-input" [value]="person()" (change)="person.set($any($event.target).value)">
              <option value="">{{ i18n.t('team.ac.everyone') }}</option>
              @for (p of d.people; track p.id) { <option [value]="p.id" [selected]="person() === p.id">{{ p.name }}</option> }
            </select>
          </label>
        </div>

        <div class="ac__figs">
          <div class="ac__fig"><b class="mono">{{ grid().total }}</b><span class="adm-small adm-muted">{{ i18n.t('team.ac.fig.total') }}</span></div>
          <div class="ac__fig"><b class="mono">{{ grid().night }} <small class="adm-muted">{{ pct(grid().night, grid().total) }}</small></b><span class="adm-small adm-muted">{{ i18n.t('team.ac.fig.night') }}</span></div>
          <div class="ac__fig"><b class="mono">{{ grid().weekend }} <small class="adm-muted">{{ pct(grid().weekend, grid().total) }}</small></b><span class="adm-small adm-muted">{{ i18n.t('team.ac.fig.weekend') }}</span></div>
          <div class="ac__fig"><b class="mono">{{ peak() }}</b><span class="adm-small adm-muted">{{ i18n.t('team.ac.fig.peak') }}</span></div>
        </div>
        @if (reading()) { <p class="ac__reading">{{ reading() }}</p> }

        @if (!grid().total) {
          <p class="adm-empty">{{ i18n.t('team.ac.empty') }}</p>
        } @else {
          <div class="ac__wrap">
            <table class="ac__map" [attr.aria-label]="i18n.t('team.ac.grid')">
              <thead><tr>
                <th scope="col"></th>
                @for (h of hours; track h) { <th scope="col" class="mono" [class.ac__nh]="night(h)">{{ h }}</th> }
                <th scope="col" class="ac__tot">{{ i18n.t('team.ac.total') }}</th>
              </tr></thead>
              <tbody>
                @for (day of days7; track day) {
                  <tr>
                    <th scope="row" [class.ac__we]="weekend(day)">{{ i18n.t(dayKey(day)) }}</th>
                    @for (h of hours; track h) {
                      @let n = grid().counts[day - 1][h];
                      <td [class]="'mono ac__c ac__c--' + step(n)" [class.ac__n]="night(h)" [attr.title]="cellLabel(day, h, n)" [attr.aria-label]="cellLabel(day, h, n)">{{ n || '' }}</td>
                    }
                    <td class="mono ac__tot">{{ grid().rows[day - 1] }}</td>
                  </tr>
                }
              </tbody>
              <tfoot><tr>
                <th scope="row">{{ i18n.t('team.ac.total') }}</th>
                @for (h of hours; track h) { <td class="mono ac__tot">{{ grid().cols[h] || '' }}</td> }
                <td class="mono ac__tot"><b>{{ grid().total }}</b></td>
              </tr></tfoot>
            </table>
          </div>
          <div class="ac__legend adm-small adm-muted">
            <span class="ac__band"></span>{{ i18n.t('team.ac.night') }}
            <span class="ac__scale">{{ i18n.t('team.ac.less') }}
              @for (s of scale; track s) { <span [class]="'ac__sw ac__c--' + s"></span> }
              {{ i18n.t('team.ac.more') }}</span>
          </div>
        }
      }
      @if (error(); as e) { <p class="adm-error ac__pad" role="alert">{{ e }}</p> }
    </section>

    @if (data(); as d) {
      @if (d.people.length) {
        <section class="adm-card">
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead><tr>
                <th>{{ i18n.t('team.ac.col.person') }}</th><th>{{ i18n.t('team.ac.col.level') }}</th>
                <th class="adm-num">{{ i18n.t('team.ac.col.total') }}</th><th class="adm-num">{{ i18n.t('team.ac.col.night') }}</th>
                <th class="adm-num">{{ i18n.t('team.ac.col.weekend') }}</th>
              </tr></thead>
              <tbody>
                @for (p of people(); track p.id) {
                  <tr class="adm-row-click" tabindex="0" [class.adm-row--active]="person() === p.id" [attr.title]="i18n.tf('team.ac.pickPerson', p.name)"
                      (click)="togglePerson(p.id)" (keydown.enter)="togglePerson(p.id)">
                    <td><strong>{{ p.name }}</strong></td>
                    <td>@if (p.level) { <span class="pill tone-neutral">{{ p.level }}</span> }</td>
                    <td class="adm-num mono">{{ p.total }}</td>
                    <td class="adm-num mono">{{ p.night }} <span class="adm-muted">{{ pct(p.night, p.total) }}</span></td>
                    <td class="adm-num mono">{{ p.weekend }} <span class="adm-muted">{{ pct(p.weekend, p.total) }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ac__tools { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ac__month { display: inline-flex; align-items: center; gap: 2px; }
    .ac__month-label { min-width: 130px; text-transform: capitalize; }
    .ac__filters { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px 0; }
    .ac__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .ac__person { display: inline-flex; align-items: center; gap: 8px; }
    .ac__person select { min-width: 200px; }
    .ac__figs { display: flex; flex-wrap: wrap; gap: 28px; padding: 12px 14px 4px; }
    .ac__fig { display: flex; flex-direction: column; gap: 1px; }
    .ac__fig b { font-size: 17px; font-variant-numeric: tabular-nums; }
    .ac__fig small { font-size: 12px; font-weight: 400; }
    .ac__reading { max-width: 860px; margin: 6px 14px 4px; color: var(--text-secondary); line-height: 1.55; }
    .ac__pad { margin: 10px 14px; }
    .ac__wrap { overflow-x: auto; padding: 10px 14px 4px; }
    .ac__map { width: 100%; min-width: 760px; border-collapse: separate; border-spacing: 2px; table-layout: fixed; }
    .ac__map th { padding: 2px 0; color: var(--text-muted); font-size: 11px; font-weight: 500; text-align: center; }
    .ac__map th[scope="row"] { width: 44px; padding-right: 6px; color: var(--text-secondary); text-align: right; }
    .ac__map thead th.ac__nh { box-shadow: inset 0 -2px 0 var(--accent); color: var(--text-secondary); }
    .ac__map .ac__we { font-weight: 600; }
    .ac__c { height: 28px; border-radius: 3px; font-size: 11px; text-align: center; color: var(--text-primary); }
    .ac__c--0 { background: var(--bg-surface-hover); }
    .ac__c--0.ac__n { background: color-mix(in srgb, var(--accent) 6%, var(--bg-surface-hover)); }
    .ac__c--1 { background: color-mix(in srgb, var(--accent) 18%, var(--bg-surface)); }
    .ac__c--2 { background: color-mix(in srgb, var(--accent) 34%, var(--bg-surface)); }
    .ac__c--3 { background: color-mix(in srgb, var(--accent) 52%, var(--bg-surface)); }
    .ac__c--4 { background: color-mix(in srgb, var(--accent) 72%, var(--bg-surface)); color: var(--accent-contrast); }
    .ac__c--5 { background: var(--accent); color: var(--accent-contrast); }
    .ac__tot { width: 48px; color: var(--text-secondary); font-size: 11px; text-align: center; }
    .ac__map th.ac__tot { width: 48px; }
    .ac__legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 14px 12px; }
    .ac__band { display: inline-block; width: 16px; height: 2px; background: var(--accent); }
    .ac__scale { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; }
    .ac__sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; }
  `,
})
export class TeamActivityComponent {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(TeamService);

  readonly area = input.required<string>();
  readonly areaName = input('');

  protected readonly periods = PERIODS;
  protected readonly monthsBack = MONTHS_BACK;
  protected readonly days7 = DAYS;
  protected readonly hours = HOURS;
  protected readonly scale = [0, 1, 2, 3, 4, 5];
  protected readonly days = signal(30);
  /** null = los últimos días; 0 = este mes, 1 = el anterior… */
  protected readonly monthOffset = signal<number | null>(null);
  protected readonly shownOffset = computed(() => this.monthOffset() ?? 1);
  protected readonly month = computed(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - this.shownOffset(), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  protected readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Intl.DateTimeFormat(this.locale(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  });
  protected readonly data = signal<ActivityView | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Los tipos que cuentan (todos al empezar) y la persona elegida ('' = todo el equipo). */
  protected readonly kinds = signal(new Set<ActivityKind>(['entries', 'mail', 'escalation', 'tickets', 'shift']));
  protected readonly person = signal('');

  /** Las celdas que pasan el filtro de tipos (todas las personas). */
  private readonly byKind = computed(() => {
    const kinds = this.kinds();
    return (this.data()?.cells ?? []).filter((c) => kinds.has(c.kind));
  });

  protected readonly grid = computed(() => {
    const person = this.person();
    const counts = DAYS.map(() => HOURS.map(() => 0));
    for (const c of this.byKind()) {
      if (!person || c.userId === person) counts[c.day - 1][c.hour] += c.count;
    }
    const rows = counts.map((r) => r.reduce((a, b) => a + b, 0));
    const cols = HOURS.map((h) => counts.reduce((a, r) => a + r[h], 0));
    const max = Math.max(1, ...counts.flat());
    let night = 0;
    let weekend = 0;
    counts.forEach((r, i) => r.forEach((n, h) => {
      if (isNight(h)) night += n;
      if (isWeekend(i + 1)) weekend += n;
    }));
    return { counts, rows, cols, max, night, weekend, total: rows.reduce((a, b) => a + b, 0) };
  });

  /** La celda más activa: «Mié 09:00». */
  protected readonly peak = computed(() => {
    const top = this.top(() => true);
    return top ? `${this.i18n.t(this.dayKey(top.day))} ${hh(top.hour)}` : '—';
  });

  protected readonly people = computed<PersonRow[]>(() => {
    const d = this.data();
    if (!d) return [];
    const rows = new Map(d.people.map((p) => [p.id, { ...p, total: 0, night: 0, weekend: 0 }]));
    for (const c of this.byKind()) {
      const r = rows.get(c.userId);
      if (!r) continue;
      r.total += c.count;
      if (isNight(c.hour)) r.night += c.count;
      if (isWeekend(c.day)) r.weekend += c.count;
    }
    // Primero quien más trabaja de noche: es lo que se mira para la dotación.
    return [...rows.values()].sort((a, b) => b.night - a.night || b.total - a.total || a.name.localeCompare(b.name));
  });

  /** La lectura, con reglas fijas (sin IA): cuánto es de noche, cuándo y quién. */
  protected readonly reading = computed(() => {
    const g = this.grid();
    if (!g.total) return '';
    if (!g.night) return this.i18n.t('team.ac.read.noNight');
    const top = this.top((h) => isNight(h));
    const parts: string[] = [];
    if (top) {
      parts.push(this.fill('team.ac.read.night', {
        pct: this.pct(g.night, g.total), day: this.i18n.t(`team.g.day.${top.day % 7}` as MessageKey), from: hh(top.hour), to: hh(top.hour + 1),
      }));
    }
    const nightOwl = this.people()[0];
    if (!this.person() && nightOwl?.night && this.people().filter((p) => p.night).length > 1) {
      parts.push(this.fill('team.ac.read.top', { name: nightOwl.name, pct: this.pct(nightOwl.night, g.night) }));
    }
    return parts.join(' ');
  });

  constructor() {
    effect(() => {
      this.area();
      this.days();
      this.monthOffset();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    try {
      const d = await this.api.activity(this.area(), this.monthOffset() === null ? { days: this.days() } : { month: this.month() });
      this.data.set(d);
      this.error.set(null);
      if (!d.people.some((p) => p.id === this.person())) this.person.set('');
    } catch (e) {
      this.data.set(null);
      this.error.set(problemDetail(e, this.i18n.t('team.error')));
    }
  }

  /** La celda con más acciones entre las horas que pasan el filtro. */
  private top(hourFilter: (h: number) => boolean): { day: number; hour: number } | null {
    const { counts } = this.grid();
    let best: { day: number; hour: number; n: number } | null = null;
    counts.forEach((r, i) => r.forEach((n, h) => {
      if (n > 0 && hourFilter(h) && (!best || n > best.n)) best = { day: i + 1, hour: h, n };
    }));
    return best;
  }

  protected pickDays(n: number): void {
    this.monthOffset.set(null);
    this.days.set(n);
  }

  /** 0 elige el mes que se ve; 1 va al anterior y -1 al siguiente. */
  protected moveMonth(dir: 1 | 0 | -1): void {
    this.monthOffset.set(Math.min(MONTHS_BACK, Math.max(0, this.shownOffset() + dir)));
  }

  /** Siempre queda al menos un tipo encendido. */
  protected toggleKind(k: ActivityKind): void {
    const next = new Set(this.kinds());
    if (next.has(k) && next.size > 1) next.delete(k);
    else next.add(k);
    this.kinds.set(next);
  }

  protected togglePerson(id: string): void {
    this.person.set(this.person() === id ? '' : id);
  }

  /** 0 = sin acciones; 1 a 5, en proporción a la celda más activa. */
  protected step(n: number): number {
    return n ? Math.max(1, Math.ceil((STEPS * n) / this.grid().max)) : 0;
  }

  protected night(h: number): boolean {
    return isNight(h);
  }

  protected weekend(day: number): boolean {
    return isWeekend(day);
  }

  protected cellLabel(day: number, hour: number, n: number): string {
    return this.fill('team.ac.cell', { day: this.i18n.t(`team.g.day.${day % 7}` as MessageKey), from: hh(hour), to: hh(hour + 1), n });
  }

  protected pct(part: number, total: number): string {
    return total ? `${Math.round((100 * part) / total)} %` : '';
  }

  protected kindKey(k: ActivityKind): MessageKey {
    return `team.ac.kind.${k}` as MessageKey;
  }

  protected dayKey(day: number): MessageKey {
    return `team.ac.day.${day}` as MessageKey;
  }

  protected range(d: ActivityView): string {
    const fmt = new Intl.DateTimeFormat(this.locale(), { day: 'numeric', month: 'long' });
    const at = (s: string) => fmt.format(new Date(`${s}T12:00:00`));
    return this.fill('team.q.range', { a: at(d.from), b: at(d.to) });
  }

  private locale(): string {
    return this.prefs.language() === 'en' ? 'en-US' : 'es-CL';
  }

  /** Rellena {a}, {b}… de un texto. */
  private fill(key: MessageKey, vars: Record<string, string | number>): string {
    return this.i18n.t(key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
  }
}
