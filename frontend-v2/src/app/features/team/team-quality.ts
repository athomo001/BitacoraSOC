import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { QualityPerson, QualityRule, QualityRuleKey, QualityStatus, QualityView, TeamService } from '../../core/team/team.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/team';

const PERIODS = [7, 15, 30];
/** Cuántos meses hacia atrás se puede mirar (como el Resumen mensual). */
const MONTHS_BACK = 12;
const RULES: QualityRuleKey[] = ['copy', 'burst', 'batch', 'gaps', 'short', 'routine', 'vocabulary'];
/** Las reglas que se miden sobre turnos (el resto, sobre entradas). */
const BY_SHIFT = new Set<QualityRuleKey>(['gaps', 'routine']);
/** Desde cuántos puntos un descuento se nombra en «Lo que más baja» y se explica con ejemplos. */
const NOTABLE = 10;

const STATUS_STYLE: Record<QualityStatus, { icon: string; tone: string }> = {
  excelente: { icon: 'verified', tone: 'text-ok' },
  estable: { icon: 'check_circle', tone: 'text-ok' },
  simplificado: { icon: 'warning', tone: 'text-warn' },
  relleno: { icon: 'error', tone: 'text-bad' },
  sin_evaluar: { icon: 'remove_circle_outline', tone: 'adm-muted' },
};

interface Evidence { title: string; text: string; items: string[] }

/**
 * Mi equipo → Calidad (10f, spec/08 §7; diseño aprobado por el dueño
 * 2026-10-22). El puntaje de calidad de registro de cada persona, como en el
 * legacy, con el desglose de 100 a su puntaje y ejemplos de sus entradas
 * para conversarlo con datos. La lectura del equipo se arma con reglas fijas,
 * sin IA.
 */
@Component({
  selector: 'app-team-quality',
  standalone: true,
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h2 class="adm-card__title"><mat-icon>fact_check</mat-icon>{{ i18n.tf('team.q.title', areaName()) }}</h2>
        <span class="qa__tools adm-push">
          @if (data(); as d) { <span class="adm-small adm-muted">{{ range(d) }}</span> }
          @for (n of periods; track n) {
            <button type="button" class="seg no-print" [attr.aria-pressed]="monthOffset() === null && days() === n" (click)="pickDays(n)">{{ i18n.tf('team.q.days', n) }}</button>
          }
          <span class="qa__month no-print">
            <button type="button" class="adm-icon-btn" [disabled]="shownOffset() >= monthsBack" [attr.aria-label]="i18n.t('team.mo.prev')" (click)="moveMonth(1)"><mat-icon>chevron_left</mat-icon></button>
            <button type="button" class="seg qa__month-label" [attr.aria-pressed]="monthOffset() !== null" (click)="moveMonth(0)">{{ monthLabel() }}</button>
            <button type="button" class="adm-icon-btn" [disabled]="shownOffset() <= 0" [attr.aria-label]="i18n.t('team.mo.next')" (click)="moveMonth(-1)"><mat-icon>chevron_right</mat-icon></button>
          </span>
          <button type="button" class="adm-btn no-print" (click)="print()"><mat-icon>picture_as_pdf</mat-icon>{{ i18n.t('team.mo.pdf') }}</button>
        </span>
      </div>
      @if (data(); as d) {
        <div class="qa__figs">
          @for (f of figures(); track f.label) {
            <div class="qa__fig"><b [class]="f.tone">{{ f.value }}</b><span class="adm-small adm-muted">{{ f.label }}</span></div>
          }
        </div>
        @if (reading()) { <p class="qa__reading">{{ reading() }}</p> }
      }
      @if (error(); as e) { <p class="adm-error qa__pad" role="alert">{{ e }}</p> }
    </section>

    @if (data(); as d) {
      @if (!d.people.length) {
        <p class="adm-empty">{{ i18n.t('team.q.empty') }}</p>
      } @else {
        <div class="qa__grid">
          <section class="adm-card">
            <div class="adm-table-wrap">
              <table class="adm-table">
                <thead><tr>
                  <th>{{ i18n.t('team.q.col.person') }}</th><th>{{ i18n.t('team.q.col.level') }}</th>
                  <th class="adm-num">{{ i18n.t('team.q.col.entries') }}</th><th class="adm-num">{{ i18n.t('team.q.col.shifts') }}</th>
                  <th class="adm-num">{{ i18n.t('team.q.col.score') }}</th><th>{{ i18n.t('team.q.col.status') }}</th><th>{{ i18n.t('team.q.col.worst') }}</th>
                </tr></thead>
                <tbody>
                  @for (p of d.people; track p.id) {
                    <tr class="adm-row-click" tabindex="0" [class.adm-row--active]="selected()?.id === p.id" (click)="selectedId.set(p.id)" (keydown.enter)="selectedId.set(p.id)">
                      <td><strong>{{ p.name }}</strong></td>
                      <td>@if (p.level) { <span class="pill tone-neutral">{{ p.level }}</span> }</td>
                      <td class="adm-num mono">{{ p.entries }}</td>
                      <td class="adm-num mono">{{ p.shifts }}</td>
                      <td class="adm-num mono qa__score">{{ p.evaluated ? p.score : '—' }}</td>
                      <td><span class="qa__state" [class]="'qa__state ' + style(p.status).tone"><mat-icon>{{ style(p.status).icon }}</mat-icon>{{ i18n.t(statusKey(p.status)) }}</span></td>
                      <td class="adm-muted">{{ worst(p) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="qa__foot no-print">
              <button type="button" class="adm-btn" [attr.aria-expanded]="how()" (click)="how.set(!how())"><mat-icon>{{ how() ? 'expand_less' : 'expand_more' }}</mat-icon>{{ i18n.t('team.q.how') }}</button>
            </div>
            @if (how()) {
              <div class="qa__how">
                <table class="adm-table">
                  <thead><tr><th>{{ i18n.t('team.q.howCol.what') }}</th><th>{{ i18n.t('team.q.howCol.cost') }}</th><th>{{ i18n.t('team.q.howCol.flag') }}</th></tr></thead>
                  <tbody>
                    @for (k of rules; track k) {
                      <tr>
                        <td><strong>{{ i18n.t(ruleKey(k)) }}</strong><div class="adm-small adm-muted">{{ i18n.t(textKey('what', k)) }}</div></td>
                        <td class="adm-small">{{ i18n.t(textKey('cost', k)) }}</td>
                        <td class="adm-small">{{ i18n.t(textKey('flag', k)) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                <p class="adm-small">{{ i18n.tf('team.q.howText', d.minEntries) }}</p>
              </div>
            }
          </section>

          <aside class="adm-card">
            @if (selected(); as p) {
              <div class="adm-card__head qa__who">
                <div>
                  <h3 class="adm-card__title">{{ p.name }}</h3>
                  <span class="adm-small adm-muted">{{ meta(p) }}</span>
                </div>
                <div class="adm-push qa__big">
                  <b [class]="style(p.status).tone">{{ p.evaluated ? p.score : '—' }}</b>
                  <span class="qa__state" [class]="'qa__state adm-small ' + style(p.status).tone"><mat-icon>{{ style(p.status).icon }}</mat-icon>{{ i18n.t(statusKey(p.status)) }}</span>
                </div>
              </div>
              @if (p.evaluated) {
                <div class="qa__body">
                  <span class="adm-small adm-muted">{{ i18n.tf('team.q.path', p.score) }}</span>
                  @for (r of p.rules; track r.key) {
                    <div class="qa__rule">
                      <span>
                        <span [class.qa__flag]="r.flagged">{{ i18n.t(ruleKey(r.key)) }}</span>
                        <span class="adm-small adm-muted qa__block">{{ ruleDetail(r) }}</span>
                      </span>
                      <span class="qa__track"><span class="qa__fill" [class.qa__fill--bonus]="r.points > 0" [class.qa__fill--flag]="r.flagged" [style.width.%]="barWidth(r)"></span></span>
                      <span class="mono adm-num" [class.text-ok]="r.points > 0" [class.text-bad]="r.flagged">{{ points(r) }}</span>
                    </div>
                  }
                  @for (e of evidence(p); track e.title) {
                    <div class="qa__ev">
                      <strong>{{ e.title }}</strong>
                      <span class="adm-small">{{ e.text }}</span>
                      @for (item of e.items; track $index) { <p class="qa__quote">{{ item }}</p> }
                    </div>
                  }
                </div>
              } @else {
                <p class="qa__body">{{ notEvaluated(p, d.minEntries) }}</p>
              }
              <div class="qa__foot no-print">
                <a class="adm-btn" routerLink="/entries" [queryParams]="{ author: p.id, from: d.from, to: d.to }"><mat-icon>menu_book</mat-icon>{{ i18n.t('team.q.openEntries') }}</a>
              </div>
            } @else {
              <p class="adm-empty">{{ i18n.t('team.q.pick') }}</p>
            }
          </aside>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .qa__tools { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .qa__month { display: inline-flex; align-items: center; gap: 2px; }
    .qa__month-label { min-width: 130px; text-transform: capitalize; }
    .qa__figs { display: flex; flex-wrap: wrap; gap: 28px; padding: 12px 14px 4px; }
    .qa__fig { display: flex; flex-direction: column; gap: 1px; }
    .qa__fig b { font-size: 17px; font-variant-numeric: tabular-nums; }
    .qa__reading { max-width: 860px; margin: 6px 14px 12px; color: var(--text-secondary); line-height: 1.55; }
    .qa__pad { margin: 10px 14px; }
    .qa__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 430px); gap: 14px; align-items: start; }
    .qa__score { font-weight: 600; }
    .qa__state { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
    .qa__foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border-subtle); }
    .qa__how { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 14px; }
    .qa__how p { margin: 0; color: var(--text-secondary); line-height: 1.55; }
    .qa__who { align-items: flex-start; }
    .qa__big { display: flex; flex-direction: column; align-items: flex-end; }
    .qa__big b { font-size: 40px; line-height: 1; font-variant-numeric: tabular-nums; }
    .qa__body { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 10px 14px; }
    .qa__rule { display: grid; grid-template-columns: minmax(0, 1fr) 90px 44px; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); }
    .qa__block { display: block; }
    .qa__flag { font-weight: 600; }
    .qa__track { position: relative; height: 6px; overflow: hidden; border-radius: 3px; background: var(--bg-surface-hover); }
    .qa__fill { position: absolute; top: 0; right: 0; bottom: 0; border-radius: 3px; background: var(--text-muted); }
    .qa__fill--flag { background: var(--status-critical); }
    .qa__fill--bonus { right: auto; left: 0; background: var(--status-ok); }
    .qa__ev { display: flex; flex-direction: column; gap: 4px; padding-top: 10px; }
    .qa__quote { margin: 0; padding: 4px 10px; border-left: 2px solid var(--border-subtle); color: var(--text-secondary); font-size: 12px; }
    .text-ok { color: var(--status-ok); }
    .text-warn { color: var(--status-warning); }
    .text-bad { color: var(--status-critical); }
    @media (width <= 1100px) { .qa__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class TeamQualityComponent {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(TeamService);

  readonly area = input.required<string>();
  readonly areaName = input('');

  protected readonly periods = PERIODS;
  protected readonly rules = RULES;
  protected readonly monthsBack = MONTHS_BACK;
  protected readonly days = signal(30);
  /** null = los últimos días; 0 = este mes, 1 = el anterior… */
  protected readonly monthOffset = signal<number | null>(null);
  /** El mes que muestra el selector (el anterior mientras no se elige uno). */
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
  protected readonly data = signal<QualityView | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly how = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selected = computed(() => {
    const people = this.data()?.people ?? [];
    return people.find((p) => p.id === this.selectedId()) ?? null;
  });

  protected readonly figures = computed(() => {
    const people = this.data()?.people ?? [];
    const evaluated = people.filter((p) => p.evaluated);
    const low = evaluated.filter((p) => p.score < 75).length;
    return [
      { value: this.fill('team.q.of', { a: evaluated.length, b: people.length }), label: this.i18n.t('team.q.fig.evaluated'), tone: '' },
      { value: String(evaluated.filter((p) => p.score >= 75).length), label: this.i18n.t('team.q.fig.stable'), tone: 'text-ok' },
      { value: String(low), label: this.i18n.t('team.q.fig.review'), tone: low ? 'text-warn' : '' },
      { value: String(evaluated.reduce((sum, p) => sum + p.entries, 0)), label: this.i18n.t('team.q.fig.entries'), tone: '' },
    ];
  });

  /** La lectura del equipo, como el análisis narrativo del legacy (sin IA). */
  protected readonly reading = computed(() => {
    const people = this.data()?.people ?? [];
    if (!people.length) return '';
    const low = people.filter((p) => p.evaluated && p.score < 75);
    const parts: string[] = [];
    if (low.length) {
      parts.push(this.i18n.tf(low.length === 1 ? 'team.q.read.lowOne' : 'team.q.read.lowMany', this.join(low.map((p) => p.name))));
      for (const p of low) {
        const top = this.notable(p).slice(0, 2).map((r) => this.i18n.tf('team.q.quote', this.i18n.t(this.ruleKey(r.key))));
        if (top.length) parts.push(this.fill(top.length === 1 ? 'team.q.read.weighsOne' : 'team.q.read.weighsMany', { name: p.name, rules: this.join(top) }));
      }
    } else if (people.some((p) => p.evaluated)) {
      parts.push(this.i18n.t('team.q.read.allGood'));
    }
    const out = people.filter((p) => !p.evaluated).map((p) => p.name);
    if (out.length) parts.push(this.i18n.tf(out.length === 1 ? 'team.q.read.notEvalOne' : 'team.q.read.notEvalMany', this.join(out)));
    if (low.length) parts.push(this.i18n.t('team.q.read.note'));
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
      const d = await this.api.quality(this.area(), this.monthOffset() === null ? { days: this.days() } : { month: this.month() });
      this.data.set(d);
      this.error.set(null);
      // Se queda en la misma persona; si no, la primera con algo para revisar.
      if (!d.people.some((p) => p.id === this.selectedId())) {
        const first = [...d.people].filter((p) => p.evaluated).sort((a, b) => a.score - b.score)[0] ?? d.people[0];
        this.selectedId.set(first?.id ?? null);
      }
    } catch (e) {
      this.data.set(null);
      this.error.set(problemDetail(e, this.i18n.t('team.error')));
    }
  }

  protected pickDays(n: number): void {
    this.monthOffset.set(null);
    this.days.set(n);
  }

  /** 0 elige el mes que se ve; 1 va al anterior y -1 al siguiente. */
  protected moveMonth(dir: 1 | 0 | -1): void {
    this.monthOffset.set(Math.min(MONTHS_BACK, Math.max(0, this.shownOffset() + dir)));
  }

  private locale(): string {
    return this.prefs.language() === 'en' ? 'en-US' : 'es-CL';
  }

  /** Rellena {a}, {b}… de un texto. */
  private fill(key: MessageKey, vars: Record<string, string | number>): string {
    return this.i18n.t(key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
  }

  private join(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + this.i18n.t('team.q.and') + items[items.length - 1];
  }

  /** Los descuentos que pesan (marcados o de 10 puntos o más), del mayor al menor. */
  private notable(p: QualityPerson): QualityRule[] {
    return p.rules.filter((r) => r.points < 0 && (r.flagged || -r.points >= NOTABLE)).sort((a, b) => a.points - b.points);
  }

  private day(iso: string): string {
    return new Intl.DateTimeFormat(this.locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
  }

  private hour(iso: string): string {
    return new Intl.DateTimeFormat(this.locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  protected range(d: QualityView): string {
    const fmt = new Intl.DateTimeFormat(this.locale(), { day: 'numeric', month: 'long' });
    const at = (s: string) => fmt.format(new Date(`${s}T12:00:00`));
    return this.fill('team.q.range', { a: at(d.from), b: at(d.to) });
  }

  protected style(s: QualityStatus) {
    return STATUS_STYLE[s] ?? STATUS_STYLE.sin_evaluar;
  }

  protected statusKey(s: QualityStatus): MessageKey {
    return `team.q.status.${s}` as MessageKey;
  }

  protected ruleKey(k: QualityRuleKey): MessageKey {
    return `team.q.rule.${k}` as MessageKey;
  }

  protected textKey(kind: 'what' | 'cost' | 'flag', k: QualityRuleKey): MessageKey {
    return `team.q.${kind}.${k}` as MessageKey;
  }

  protected worst(p: QualityPerson): string {
    if (!p.evaluated) {
      return p.absence ? this.i18n.tf(`team.q.away.${p.absence.kind}` as MessageKey, p.absence.days) : this.i18n.tf('team.q.few', this.data()?.minEntries ?? 10);
    }
    const top = this.notable(p).slice(0, 2).map((r, i) => {
      const name = this.i18n.t(this.ruleKey(r.key));
      return i ? name.toLocaleLowerCase(this.locale()) : name;
    });
    return top.length ? top.join(', ') : this.i18n.t('team.q.nothing');
  }

  protected meta(p: QualityPerson): string {
    return this.fill('team.q.meta', { level: p.level ? `${p.level}, ` : '', entries: p.entries, shifts: p.shifts });
  }

  protected ruleDetail(r: QualityRule): string {
    const pct = new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 1 }).format(r.pct);
    return this.i18n.tf(BY_SHIFT.has(r.key) ? 'team.q.ofShifts' : 'team.q.ofEntries', pct) + (r.flagged ? this.i18n.t('team.q.overLimit') : '');
  }

  protected barWidth(r: QualityRule): number {
    return Math.min(100, Math.round((Math.abs(r.points) / 40) * 100));
  }

  protected points(r: QualityRule): string {
    if (!r.points) return '0';
    const v = new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 1 }).format(Math.abs(r.points));
    return (r.points > 0 ? '+' : '−') + v;
  }

  /** Ejemplos de sus entradas para lo que pesa en el puntaje. */
  protected evidence(p: QualityPerson): Evidence[] {
    return this.notable(p).map((r) => {
      const ex = r.examples ?? [];
      const title = this.i18n.t(this.ruleKey(r.key));
      switch (r.key) {
        case 'copy':
          return { title, text: this.i18n.tf('team.q.ev.copy', r.count), items: ex.map((e) => this.fill('team.q.ev.copyItem', { text: e.text ?? '', n: e.times ?? 0 })) };
        case 'burst':
          return { title, text: this.i18n.tf('team.q.ev.burst', r.count),
            items: ex.filter((e) => e.at && e.until).map((e) => this.fill('team.q.ev.burstItem', { day: this.day(e.at!), n: e.count ?? 0, from: this.hour(e.at!), until: this.hour(e.until!) })) };
        case 'gaps':
          return { title, text: this.fill('team.q.ev.gaps', { n: r.count, of: r.of }),
            items: ex.filter((e) => e.at && e.until).map((e) => this.fill('team.q.ev.gapItem', { day: this.day(e.at!), shift: e.shift ? ` (${e.shift})` : '', from: this.hour(e.at!), until: this.hour(e.until!) })) };
        case 'routine':
          return { title, text: this.fill('team.q.ev.routine', { n: r.count, of: r.of }),
            items: ex.length ? [ex.filter((e) => e.at).map((e) => this.day(e.at!) + (e.shift ? ` (${e.shift})` : '')).join(', ')] : [] };
        case 'short':
          return { title, text: this.fill('team.q.ev.short', { n: r.count, of: r.of }), items: ex.map((e) => this.i18n.tf('team.q.quote', e.text ?? '')) };
        default:
          return { title, text: this.i18n.tf('team.q.ev.batch', r.count), items: ex.map((e) => this.i18n.tf('team.q.quote', e.text ?? '')) };
      }
    });
  }

  protected notEvaluated(p: QualityPerson, min: number): string {
    const few = this.fill('team.q.few.detail', { n: p.entries, min });
    if (!p.absence) return few;
    const kind = this.i18n.t(p.absence.kind === 'vacation' ? 'team.cond.vacation' : 'team.cond.medical_leave');
    return `${this.fill('team.q.away.detail', { kind, days: p.absence.days })} ${few}`;
  }

  protected print(): void {
    window.print();
  }
}
