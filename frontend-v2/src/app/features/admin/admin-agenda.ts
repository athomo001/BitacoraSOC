import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AgendaService, AgendaSettings } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { fmtDay, parseDay, weekdayNames } from '../agenda/agenda-format';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/agenda';

/**
 * Administración → Agenda (spec/16 §4.3): el horario hábil con que la Agenda
 * calcula vencimientos y avisos (por defecto lunes a viernes, 08:00 a 20:00)
 * y los feriados por año, que se importan desde la lista incluida en la app
 * (decisión del dueño 2026-10-14) y se agregan o quitan a mano.
 */
@Component({
  selector: 'app-admin-agenda',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.agenda') }}</h2>
        <p class="adm-muted">{{ i18n.t('agAdmin.subtitle') }}</p>
      </div>
    </header>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    @if (s(); as st) {
      <div class="aa__grid">
        <section class="adm-card">
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>schedule</mat-icon>{{ i18n.t('agAdmin.hours') }}</h3></div>
          <div class="adm-card__body aa__body">
            <div class="adm-field">
              <span class="adm-label">{{ i18n.t('agAdmin.days') }}</span>
              <div class="aa__days">
                @for (d of weekOrder; track d) {
                  <button type="button" class="seg" [attr.aria-pressed]="days().includes(d)" (click)="toggleDay(d)">{{ dayNames()[d] }}</button>
                }
              </div>
            </div>
            <div class="adm-row">
              <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('agAdmin.from') }}</span>
                <input class="adm-input mono" type="time" name="dayStart" [value]="start()" (change)="start.set(val($event))" /></label>
              <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('agAdmin.to') }}</span>
                <input class="adm-input mono" type="time" name="dayEnd" [value]="end()" (change)="end.set(val($event))" /></label>
            </div>
            <p class="adm-hint">{{ i18n.t('agAdmin.hoursHint') }}</p>
            <div class="aa__actions">
              @if (notice(); as n) { <span class="pill tone-ok" role="status">{{ n }}</span> }
              <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !days().length" (click)="saveHours()"><mat-icon>save</mat-icon>{{ i18n.t('agAdmin.save') }}</button>
            </div>
          </div>
        </section>

        <section class="adm-card">
          <div class="adm-card__head aa__hhead">
            <h3 class="adm-card__title"><mat-icon>event_busy</mat-icon>{{ i18n.t('agAdmin.holidays') }}</h3>
            <span class="aa__year adm-push">
              <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('agAdmin.prevYear')" (click)="load(st.year - 1)"><mat-icon>chevron_left</mat-icon></button>
              <b class="mono">{{ st.year }}</b>
              <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('agAdmin.nextYear')" (click)="load(st.year + 1)"><mat-icon>chevron_right</mat-icon></button>
            </span>
          </div>
          <div class="adm-card__body aa__body">
            @if (canImport()) {
              <div class="aa__actions aa__actions--start">
                <button type="button" class="adm-btn" [disabled]="busy()" (click)="importYear()"><mat-icon>download</mat-icon>{{ i18n.tf('agAdmin.import', countryName() + ' ' + st.year) }}</button>
                <span class="adm-hint">{{ i18n.t('agAdmin.importHint') }}</span>
              </div>
            } @else if (!st.holidays.length) {
              <p class="adm-hint">{{ i18n.t('agAdmin.notAvailable') }}</p>
            }
            @for (h of st.holidays; track h.date) {
              <div class="aa__hol">
                <span class="mono">{{ day(h.date) }}</span>
                <span>{{ h.name }} @if (isWeekend(h.date)) { <span class="adm-hint">{{ i18n.t('agAdmin.weekend') }}</span> }</span>
                <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('agAdmin.remove')" [disabled]="busy()" (click)="remove(h.date)"><mat-icon>close</mat-icon></button>
              </div>
            } @empty {
              <p class="adm-empty">{{ i18n.t('agAdmin.empty') }}</p>
            }
            <form class="aa__add" (submit)="$event.preventDefault(); add()">
              <label class="adm-field"><span class="adm-label">{{ i18n.t('agAdmin.date') }}</span>
                <input class="adm-input" type="date" name="holDate" [value]="newDate()" (change)="newDate.set(val($event))" /></label>
              <label class="adm-field"><span class="adm-label">{{ i18n.t('agAdmin.name') }}</span>
                <input class="adm-input" name="holName" maxlength="120" [value]="newName()" (input)="newName.set(val($event))" /></label>
              <button type="submit" class="adm-btn" [disabled]="busy() || !newDate() || !newName().trim()"><mat-icon>add</mat-icon>{{ i18n.t('agAdmin.add') }}</button>
            </form>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .aa__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; align-items: start; }
    .aa__body { display: flex; flex-direction: column; gap: 12px; }
    .aa__days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .aa__days .seg { justify-content: center; }
    .aa__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
    .aa__actions--start { justify-content: flex-start; }
    .aa__hhead { flex-wrap: wrap; }
    .aa__year { display: inline-flex; align-items: center; gap: 4px; }
    .aa__hol { display: grid; grid-template-columns: 130px minmax(0, 1fr) 28px; gap: 10px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border-subtle); }
    .aa__add { display: grid; grid-template-columns: 160px minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    @media (max-width: 900px) {
      .aa__grid, .aa__add { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class AdminAgendaComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);

  protected readonly weekOrder = [1, 2, 3, 4, 5, 6, 0];
  protected readonly s = signal<AgendaSettings | null>(null);
  protected readonly days = signal<number[]>([]);
  protected readonly start = signal('08:00');
  protected readonly end = signal('20:00');
  protected readonly newDate = signal('');
  protected readonly newName = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly dayNames = computed(() => weekdayNames(this.prefs.language()));
  protected readonly canImport = computed(() => {
    const st = this.s();
    return !!st && st.importableYears.includes(st.year);
  });
  protected readonly countryName = computed(() => {
    const st = this.s();
    return st?.countries.find((c) => c.country === st.holidayCountry)?.name ?? st?.holidayCountry ?? '';
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected day(iso: string): string {
    return fmtDay(iso, this.prefs.language());
  }

  protected isWeekend(iso: string): boolean {
    const wd = parseDay(iso).getUTCDay();
    return !(this.s()?.workDays ?? []).includes(wd);
  }

  private apply(st: AgendaSettings, resetHours: boolean): void {
    this.s.set(st);
    if (resetHours) {
      this.days.set([...st.workDays]);
      this.start.set(st.dayStart);
      this.end.set(st.dayEnd);
    }
  }

  protected async load(year?: number): Promise<void> {
    try {
      this.apply(await this.api.settings(year), !this.s());
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.loadError')));
    }
  }

  protected toggleDay(d: number): void {
    this.days.update((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
    this.notice.set(null);
  }

  private async run(fn: () => Promise<AgendaSettings>, resetHours = false, done?: () => void): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      this.apply(await fn(), resetHours);
      this.error.set(null);
      done?.();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected saveHours(): void {
    void this.run(() => this.api.saveSettings(this.days(), this.start(), this.end()), true, () => this.notice.set(this.i18n.t('agAdmin.saved')));
  }

  protected importYear(): void {
    const st = this.s();
    if (st) void this.run(() => this.api.importHolidays(st.year));
  }

  protected add(): void {
    void this.run(() => this.api.saveHoliday(this.newDate(), this.newName().trim()), false, () => {
      this.newDate.set('');
      this.newName.set('');
    });
  }

  protected remove(date: string): void {
    void this.run(() => this.api.deleteHoliday(date));
  }
}
