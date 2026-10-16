import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  Asset, EscalationService, MaintenanceWindow, SeriesPreviewItem, SeriesWindow, SeriesWindowAction, SocService, WindowRule, WindowSeries, WindowTarget,
} from '../../core/escalation/escalation.service';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { AgendaService } from '../../core/agenda/agenda.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/escalation';
type ScopeKind = 'asset' | 'unit' | 'service' | 'client' | 'area' | 'team';
type Repeat = 'once' | 'weekly' | 'monthly';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Ventanas de mantenimiento: programar y cerrar. La usan Administración →
 * Escalamiento y la pantalla de Escalamiento, porque también las crea el
 * analista (comentario del dueño #16), no solo el admin. Solo ofrece los
 * destinos de los módulos encendidos. Desde la 9.5 también aplican a un
 * cliente, un área o un equipo de la app; la que está en curso se cierra
 * antes de tiempo («Cerrar ahora», queda registrado) y la programada se cancela.
 *
 * Desde la 9.7 una ventana puede repetirse cada semana o cada mes. Sus
 * ventanas se ven en «Ventanas que se repiten» (no en la tabla de sueltas):
 * cada una se salta una vez y la que cae en feriado no se aplica, salvo que
 * la jefatura o el admin la aplique igual (decisión del dueño 2026-10-15).
 */
@Component({
  selector: 'app-maintenance-windows',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>engineering</mat-icon>{{ i18n.t('escAdmin.windows') }}</h3>
      </div>
      <p class="adm-card__note mw__lead">{{ i18n.t('escAdmin.windowsHint') }}</p>
      @if (error(); as e) { <p class="adm-error mw__msg" role="alert">{{ e }}</p> }
      <form class="adm-card__body mw__form" (ngSubmit)="create()">
        <div class="adm-row">
          <label class="adm-field adm-field--narrow">
            <span class="adm-label">{{ i18n.t('escAdmin.appliesTo') }}</span>
            <select class="adm-input" name="winKind" [ngModel]="kind()" (ngModelChange)="kind.set($event); target.set('')">
              @for (k of kinds(); track k) { <option [value]="k">{{ i18n.t(kindKey(k)) }}</option> }
            </select>
          </label>
          <label class="adm-field">
            <span class="adm-label">{{ i18n.t('escAdmin.target') }}</span>
            <select class="adm-input" name="winTarget" [ngModel]="target()" (ngModelChange)="target.set($event)">
              <option value="">{{ i18n.t('teams.pick') }}</option>
              @for (o of options(); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
            </select>
          </label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('escAdmin.windowTitle') }}</span><input class="adm-input" name="winTitle" [placeholder]="i18n.t('escAdmin.windowTitlePlaceholder')" [ngModel]="title()" (ngModelChange)="title.set($event)" /></label>
        </div>
        <div class="adm-row mw__repeat" role="group" [attr.aria-label]="i18n.t('escAdmin.repeat')">
          <span class="adm-label">{{ i18n.t('escAdmin.repeat') }}</span>
          @for (r of repeats; track r) {
            <button type="button" class="seg" [attr.aria-pressed]="repeat() === r" (click)="setRepeat(r)">{{ i18n.t(repeatKey(r)) }}</button>
          }
        </div>
        @if (repeat() === 'once') {
          <div class="adm-row">
            <label class="adm-field"><span class="adm-label">{{ i18n.t('audit.range.from') }}</span><input class="adm-input" name="winStart" type="datetime-local" [ngModel]="start()" (ngModelChange)="start.set($event)" /></label>
            <label class="adm-field"><span class="adm-label">{{ i18n.t('audit.range.to') }}</span><input class="adm-input" name="winEnd" type="datetime-local" [ngModel]="end()" (ngModelChange)="end.set($event)" /></label>
          </div>
        } @else {
          @if (repeat() === 'weekly') {
            <div class="adm-row">
              <div class="adm-field">
                <span class="adm-label">{{ i18n.t('escAdmin.days') }}</span>
                <span class="mw__days">
                  @for (d of weekdays; track d) {
                    <button type="button" class="mw__day" [attr.aria-pressed]="weekdaysOn().includes(d)" [attr.aria-label]="i18n.t(wdLongKey(d))" (click)="toggleDay(d)">{{ i18n.t(wdKey(d)) }}</button>
                  }
                </span>
              </div>
            </div>
          } @else {
            <div class="adm-row">
              <span class="mw__seg" role="group">
                <button type="button" class="seg" [attr.aria-pressed]="monthMode() === 'nth'" (click)="setMonthMode('nth')">{{ i18n.t('escAdmin.monthNth') }}</button>
                <button type="button" class="seg" [attr.aria-pressed]="monthMode() === 'day'" (click)="setMonthMode('day')">{{ i18n.t('escAdmin.monthDay') }}</button>
              </span>
              @if (monthMode() === 'nth') {
                <label class="adm-field adm-field--narrow">
                  <span class="adm-label">{{ i18n.t('escAdmin.which') }}</span>
                  <select class="adm-input" name="winNth" [ngModel]="nth()" (ngModelChange)="nth.set(+$event); refreshPreview()">
                    @for (n of [1, 2, 3, 4, 5]; track n) { <option [value]="n">{{ i18n.t(nthKey(n)) }}</option> }
                  </select>
                </label>
                <label class="adm-field adm-field--narrow">
                  <span class="adm-label">{{ i18n.t('escAdmin.weekday') }}</span>
                  <select class="adm-input" name="winWeekday" [ngModel]="weekday()" (ngModelChange)="weekday.set(+$event); refreshPreview()">
                    @for (d of weekdays; track d) { <option [value]="d">{{ i18n.t(wdLongKey(d)) }}</option> }
                  </select>
                </label>
              } @else {
                <label class="adm-field adm-field--narrow">
                  <span class="adm-label">{{ i18n.t('escAdmin.dayOfMonth') }}</span>
                  <input class="adm-input" name="winDay" type="number" min="1" max="31" [ngModel]="monthDay()" (ngModelChange)="monthDay.set(+$event); refreshPreview()" />
                </label>
              }
            </div>
          }
          <div class="adm-row">
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('escAdmin.fromTime') }}</span><input class="adm-input" name="winFromTime" type="time" [ngModel]="fromTime()" (ngModelChange)="fromTime.set($event); refreshPreview()" /></label>
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('escAdmin.toTime') }}</span><input class="adm-input" name="winToTime" type="time" [ngModel]="toTime()" (ngModelChange)="toTime.set($event); refreshPreview()" /></label>
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('escAdmin.validFrom') }}</span><input class="adm-input" name="winValidFrom" type="date" [ngModel]="validFrom()" (ngModelChange)="validFrom.set($event); refreshPreview()" /></label>
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('escAdmin.validTo') }}</span><input class="adm-input" name="winValidTo" type="date" [ngModel]="validTo()" (ngModelChange)="validTo.set($event)" /></label>
          </div>
          @if (overnight()) { <p class="adm-small adm-secondary mw__note">{{ i18n.t('escAdmin.overnight') }}</p> }
          @if (preview().length) {
            <div class="mw__preview">
              <span class="adm-label">{{ i18n.t('escAdmin.next') }}</span>
              @for (p of preview(); track p.day) {
                <span class="pill" [class]="p.holiday ? 'tone-system' : 'tone-neutral'">
                  {{ when(p.startsAt) }}@if (p.holiday) { · {{ p.holiday }} }
                </span>
              }
            </div>
            @if (hasHoliday()) { <p class="adm-small adm-secondary mw__note">{{ i18n.t('escAdmin.holidayHint') }}</p> }
          }
        }
        <div class="adm-row mw__actions">
          <label class="adm-switch-row mw__suppress">
            <span class="switch">
              <input class="switch__input" type="checkbox" role="switch" [checked]="suppress()" (change)="suppress.set(!suppress())" />
              <span class="switch__track" aria-hidden="true"></span>
            </span>
            <span class="adm-strong">{{ i18n.t('escAdmin.suppress') }}</span>
          </label>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !canCreate()"><mat-icon>event</mat-icon>{{ i18n.t('escAdmin.schedule') }}</button>
        </div>
      </form>

      @if (series().length) {
        <div class="mw__series">
          <h4 class="mw__subtitle"><mat-icon>event_repeat</mat-icon>{{ i18n.t('escAdmin.series') }}</h4>
          @for (s of series(); track s.id) {
            <article class="mw__serie">
              <header class="mw__serie-head">
                <strong>{{ s.title }}</strong>
                <span class="pill tone-neutral"><mat-icon>event_repeat</mat-icon>{{ ruleLabel(s.rule) }}</span>
                <span class="adm-small adm-secondary">{{ i18n.t(kindKey(kindOf(s))) }}: {{ s.targetName }}</span>
                <span class="pill" [class]="s.suppressNotifications ? 'tone-warn' : 'tone-neutral'">{{ i18n.t(s.suppressNotifications ? 'escAdmin.suppressed' : 'escAdmin.informative') }}</span>
                <button type="button" class="adm-btn mw__push" [disabled]="busy()" (click)="endSeries(s)">{{ i18n.t('escAdmin.deleteSeries') }}</button>
              </header>
              <ul class="mw__next">
                @for (w of s.next; track w.id) {
                  <li class="mw__occ" [class.mw__occ--off]="!w.active">
                    <span class="mono adm-small mw__when">{{ when(w.startsAt) }} → {{ w.endsAt | date: 'HH:mm' }}</span>
                    <span class="mw__what">
                      @if (w.holidayName) {
                        <span class="pill tone-system">{{ i18n.t('escAdmin.holiday') }} · {{ w.holidayName }}</span>
                        <span class="adm-small adm-secondary">{{ w.active ? i18n.tf('escAdmin.approvedBy', w.approvedByName ?? '') : i18n.t('escAdmin.holidayNotApplied') }}</span>
                      } @else if (!w.active) {
                        <span class="adm-small adm-secondary">{{ i18n.t('escAdmin.skipped') }}</span>
                      }
                    </span>
                    @if (isFuture(w)) {
                      @if (w.holidayName) {
                        @if (canApproveHoliday()) {
                          <button type="button" class="adm-btn" [disabled]="busy()" (click)="act(w, w.active ? 'unapprove' : 'approve')">
                            @if (!w.active) { <mat-icon>verified</mat-icon> }{{ i18n.t(w.active ? 'escAdmin.removeApproval' : 'escAdmin.applyAnyway') }}
                          </button>
                        }
                      } @else {
                        <button type="button" class="adm-btn" [disabled]="busy()" (click)="act(w, w.active ? 'skip' : 'apply')">{{ i18n.t(w.active ? 'escAdmin.skipOnce' : 'escAdmin.applyAgain') }}</button>
                      }
                    }
                  </li>
                }
              </ul>
            </article>
          }
        </div>
      }

      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('escAdmin.windowTitle') }}</th><th>{{ i18n.t('escAdmin.appliesTo') }}</th><th>{{ i18n.t('escAdmin.when') }}</th><th>{{ i18n.t('escAdmin.notices') }}</th><th></th></tr></thead>
          <tbody>
            @for (w of windows(); track w.id) {
              <tr [class.mw__inactive]="!w.active">
                <td><strong>{{ w.title }}</strong>@if (w.agendaTaskId) { <span class="adm-small adm-secondary"> · {{ i18n.t('escAdmin.fromTask') }}</span> }</td>
                <td>{{ i18n.t(kindKey(kindOf(w))) }}: {{ targetName(w) }}</td>
                <td class="mono adm-small">{{ w.startsAt | date: 'dd/MM/yy HH:mm' }} → {{ w.endsAt | date: 'dd/MM/yy HH:mm' }}</td>
                <td><span class="pill" [class]="w.suppressNotifications ? 'tone-warn' : 'tone-neutral'">{{ i18n.t(w.suppressNotifications ? 'escAdmin.suppressed' : 'escAdmin.informative') }}</span></td>
                <td class="adm-num">
                  @switch (stateOf(w)) {
                    @case ('running') { <button type="button" class="adm-btn" [disabled]="busy()" (click)="closeNow(w)">{{ i18n.t('escAdmin.closeNow') }}</button> }
                    @case ('upcoming') { <button type="button" class="adm-btn" [disabled]="busy()" (click)="close(w)">{{ i18n.t('escAdmin.cancelWindow') }}</button> }
                    @case ('closedEarly') { <span class="pill tone-neutral">{{ i18n.tf('escAdmin.closedEarly', (w.closedAt | date: 'dd/MM HH:mm') ?? '') }}</span> }
                    @case ('ended') { <span class="pill tone-neutral">{{ i18n.t('escAdmin.ended') }}</span> }
                    @default { <span class="pill tone-neutral">{{ i18n.t('escAdmin.cancelled') }}</span> }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!windows().length) { <p class="adm-empty">{{ i18n.t('escAdmin.noWindows') }}</p> }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .mw__lead { padding-bottom: 0; }
    .mw__msg { margin: 8px 14px 0; }
    .mw__form { border-bottom: 1px solid var(--border-subtle); }
    .mw__repeat { align-items: center; gap: 6px; }
    .mw__seg { display: inline-flex; gap: 6px; align-self: flex-end; flex-wrap: wrap; }
    .mw__days { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .mw__day { width: 34px; height: 30px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-app); color: var(--text-secondary); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
    .mw__day[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
    .mw__note { margin: 0; }
    .mw__preview { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .mw__actions { align-items: center; justify-content: flex-end; }
    .mw__suppress { align-self: center; flex: 0 0 auto; }
    .mw__inactive td { color: var(--text-muted); }
    .mw__series { padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 10px; }
    .mw__subtitle { margin: 0; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .mw__serie { border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-app); }
    .mw__serie-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); }
    .mw__serie-head .pill mat-icon { width: 13px; height: 13px; font-size: 13px; }
    .mw__push { margin-left: auto; }
    .mw__next { list-style: none; margin: 0; padding: 0; }
    .mw__occ { display: grid; grid-template-columns: minmax(0, 170px) minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--border-subtle); }
    .mw__occ:last-child { border-bottom: none; }
    .mw__occ--off .mw__when { text-decoration: line-through; color: var(--text-muted); }
    .mw__what { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; min-width: 0; }
    @media (max-width: 640px) { .mw__occ { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class MaintenanceWindowsComponent implements OnInit {
  /** Destino ya elegido en la pantalla (p. ej. el servicio abierto en Escalamiento). */
  readonly presetServiceId = input<string | null>(null);

  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(EscalationService);
  private readonly territory = inject(TerritoryService);
  private readonly modules = inject(ModuleAccessService);
  private readonly orgs = inject(OrganizationsService);
  private readonly agenda = inject(AgendaService);

  protected readonly weekdays = WEEKDAYS;
  protected readonly repeats: readonly Repeat[] = ['once', 'weekly', 'monthly'];

  private readonly allWindows = signal<MaintenanceWindow[]>([]);
  /** Las sueltas: las de una serie se ven en su serie. */
  protected readonly windows = computed(() => this.allWindows().filter((w) => !w.seriesId));
  protected readonly series = signal<WindowSeries[]>([]);
  protected readonly canApproveHoliday = signal(false);
  private readonly services = signal<SocService[]>([]);
  private readonly assets = signal<Asset[]>([]);
  private readonly units = signal<TerritorialUnit[]>([]);
  private readonly clients = signal<Organization[]>([]);
  private readonly areas = signal<{ id: string; name: string }[]>([]);
  private readonly teams = signal<TeamSummary[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly kind = signal<ScopeKind>('service');
  protected readonly target = signal('');
  protected readonly title = signal('');
  protected readonly start = signal('');
  protected readonly end = signal('');
  protected readonly suppress = signal(true);

  protected readonly repeat = signal<Repeat>('once');
  protected readonly weekdaysOn = signal<number[]>([0]);
  protected readonly monthMode = signal<'nth' | 'day'>('nth');
  protected readonly nth = signal(1);
  protected readonly weekday = signal(0);
  protected readonly monthDay = signal(1);
  protected readonly fromTime = signal('02:00');
  protected readonly toTime = signal('04:00');
  protected readonly validFrom = signal(localDate(new Date()));
  protected readonly validTo = signal('');
  protected readonly preview = signal<SeriesPreviewItem[]>([]);
  protected readonly hasHoliday = computed(() => this.preview().some((p) => p.holiday));
  protected readonly overnight = computed(() => !!this.fromTime() && !!this.toTime() && this.toTime() <= this.fromTime());

  protected readonly kinds = computed<ScopeKind[]>(() => [
    ...(this.modules.noc() ? (['asset', 'unit'] as const) : []),
    ...(this.modules.soc() ? (['service'] as const) : []),
    'client', 'area', 'team',
  ]);
  protected readonly options = computed(() => {
    switch (this.kind()) {
      case 'asset':
        return this.assets().map((a) => ({ id: a.id, label: `${a.name} (${a.code})` }));
      case 'unit':
        return this.units().filter((u) => u.active).map((u) => ({ id: u.id, label: `${'— '.repeat(u.depth)}${u.name}` }));
      case 'client':
        return this.clients().map((c) => ({ id: c.id, label: c.name }));
      case 'area':
        return this.areas().map((a) => ({ id: a.id, label: a.name }));
      case 'team':
        return this.teams().map((t) => ({ id: t.id, label: t.name }));
      default:
        return this.services()
          .map((s) => ({ id: s.id, label: serviceLabel(s) }))
          .sort((a, b) => a.label.localeCompare(b.label));
    }
  });
  protected readonly canCreate = computed(() => {
    if (!this.target() || !this.title().trim()) return false;
    if (this.repeat() === 'once') return !!this.start() && !!this.end();
    return !!this.fromTime() && !!this.toTime() && this.fromTime() !== this.toTime() && !!this.validFrom() && (this.repeat() !== 'weekly' || this.weekdaysOn().length > 0);
  });

  async ngOnInit(): Promise<void> {
    await this.modules.load();
    this.kind.set(this.kinds()[0] ?? 'service');
    await this.run(() =>
      Promise.all([
        this.refresh(),
        this.modules.soc() ? this.api.listServices().then((s) => this.services.set(s)) : null,
        this.modules.noc() ? this.api.listAssets().then((a) => this.assets.set(a)) : null,
        this.modules.noc() ? this.territory.list(1, 5000).then((r) => this.units.set(r.units)) : null,
        this.orgs.list({ clients: true, active: true }).then((c) => this.clients.set(c), () => this.clients.set([])),
        this.agenda.meta().then((m) => this.areas.set(m.areas), () => this.areas.set([])),
        this.orgs.listTeams().then((t) => this.teams.set(t.filter((x) => x.kind !== 'step')), () => this.teams.set([])),
      ]),
    );
    const preset = this.presetServiceId();
    if (preset && this.modules.soc()) {
      this.kind.set('service');
      this.target.set(preset);
    }
  }

  protected kindOf(s: WindowTarget): ScopeKind {
    if (s.assetId) return 'asset';
    if (s.territorialUnitId) return 'unit';
    if (s.organizationId) return 'client';
    if (s.areaId) return 'area';
    if (s.teamId) return 'team';
    return 'service';
  }

  /** En curso, programada, cerrada antes de tiempo, terminada o cancelada. */
  protected stateOf(w: MaintenanceWindow): 'running' | 'upcoming' | 'closedEarly' | 'ended' | 'cancelled' {
    const now = Date.now();
    if (!w.active) return 'cancelled';
    if (w.closedAt) return 'closedEarly';
    if (new Date(w.endsAt).getTime() <= now) return 'ended';
    return new Date(w.startsAt).getTime() <= now ? 'running' : 'upcoming';
  }

  /** «dom 18/10 02:00» / «Sun 10/18 02:00», en la hora del navegador. */
  protected when(iso: string): string {
    const en = this.prefs.language() === 'en';
    return new Intl.DateTimeFormat(en ? 'en-US' : 'es-CL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(iso));
  }

  protected isFuture(w: SeriesWindow): boolean {
    return new Date(w.startsAt).getTime() > Date.now();
  }

  protected kindKey(kind: ScopeKind): MessageKey {
    return `escAdmin.kind.${kind}` as MessageKey;
  }

  protected repeatKey(r: Repeat): MessageKey {
    return `escAdmin.repeat.${r}` as MessageKey;
  }

  protected wdKey(d: number): MessageKey {
    return `escAdmin.wd.${d}` as MessageKey;
  }

  protected wdLongKey(d: number): MessageKey {
    return `escAdmin.wdLong.${d}` as MessageKey;
  }

  protected nthKey(n: number): MessageKey {
    return `escAdmin.nth.${n}` as MessageKey;
  }

  /** «Cada domingo · 02:00–04:00», «Tercer domingo de cada mes · 02:00–04:00». */
  protected ruleLabel(r: WindowRule): string {
    const hours = `${r.start}–${r.end}`;
    if (r.kind === 'weekly') {
      const days = (r.weekdays ?? []).map((d) => this.i18n.t(this.wdLongKey(d))).join(', ');
      return `${this.i18n.tf('escAdmin.everyWeek', days)} · ${hours}`;
    }
    if (r.day) return `${this.i18n.tf('escAdmin.everyMonthDay', r.day)} · ${hours}`;
    const which = `${this.i18n.t(this.nthKey(r.nth ?? 1))} ${this.i18n.t(this.wdLongKey(r.weekday))}`;
    return `${this.i18n.tf('escAdmin.everyMonthNth', which)} · ${hours}`;
  }

  protected targetName(s: WindowTarget): string {
    if (s.organizationId) return this.clients().find((x) => x.id === s.organizationId)?.name ?? s.organizationId;
    if (s.areaId) return this.areas().find((x) => x.id === s.areaId)?.name ?? s.areaId;
    if (s.teamId) return this.teams().find((x) => x.id === s.teamId)?.name ?? s.teamId;
    if (s.assetId) return this.assets().find((x) => x.id === s.assetId)?.name ?? s.assetId;
    if (s.territorialUnitId) {
      const u = this.units().find((x) => x.id === s.territorialUnitId);
      return u ? `${u.name} (${u.code})` : s.territorialUnitId;
    }
    const svc = this.services().find((x) => x.id === s.serviceId);
    return svc ? serviceLabel(svc) : (s.serviceId ?? '');
  }

  protected setRepeat(r: Repeat): void {
    this.repeat.set(r);
    this.refreshPreview();
  }

  protected setMonthMode(m: 'nth' | 'day'): void {
    this.monthMode.set(m);
    this.refreshPreview();
  }

  protected toggleDay(d: number): void {
    const on = this.weekdaysOn();
    this.weekdaysOn.set(on.includes(d) ? on.filter((x) => x !== d) : [...on, d].sort());
    this.refreshPreview();
  }

  private rule(): WindowRule | null {
    if (this.repeat() === 'once' || !this.fromTime() || !this.toTime() || this.fromTime() === this.toTime()) return null;
    if (this.repeat() === 'weekly') {
      if (!this.weekdaysOn().length) return null;
      return { kind: 'weekly', weekdays: this.weekdaysOn(), weekday: 0, start: this.fromTime(), end: this.toTime() };
    }
    if (this.monthMode() === 'day') {
      const day = this.monthDay();
      if (!(day >= 1 && day <= 31)) return null;
      return { kind: 'monthly', day, weekday: 0, start: this.fromTime(), end: this.toTime() };
    }
    return { kind: 'monthly', nth: this.nth(), weekday: this.weekday(), start: this.fromTime(), end: this.toTime() };
  }

  protected async refreshPreview(): Promise<void> {
    const rule = this.rule();
    if (!rule) {
      this.preview.set([]);
      return;
    }
    try {
      this.preview.set(await this.api.previewSeries(rule, this.validFrom()));
    } catch {
      this.preview.set([]);
    }
  }

  protected async create(): Promise<void> {
    const id = this.target();
    const scope: WindowTarget = {
      asset: { assetId: id }, unit: { territorialUnitId: id }, service: { serviceId: id },
      client: { organizationId: id }, area: { areaId: id }, team: { teamId: id },
    }[this.kind()];
    const rule = this.rule();
    await this.run(async () => {
      if (rule) {
        await this.api.createSeries({
          ...scope, title: this.title().trim(), suppressNotifications: this.suppress(), rule,
          validFrom: this.validFrom(), validTo: this.validTo() || undefined,
        });
      } else {
        await this.api.createWindow({
          ...scope,
          title: this.title().trim(),
          // datetime-local viene sin zona: se interpreta en la hora local del navegador.
          startsAt: new Date(this.start()).toISOString(),
          endsAt: new Date(this.end()).toISOString(),
          suppressNotifications: this.suppress(),
        });
      }
      this.title.set('');
      await this.refresh();
    });
  }

  protected async closeNow(w: MaintenanceWindow): Promise<void> {
    await this.run(async () => {
      await this.api.closeWindowNow(w.id);
      await this.refresh();
    });
  }

  protected async close(w: MaintenanceWindow): Promise<void> {
    await this.run(async () => {
      await this.api.closeWindow(w.id);
      await this.refresh();
    });
  }

  protected async act(w: SeriesWindow, action: SeriesWindowAction): Promise<void> {
    await this.run(async () => {
      await this.api.setSeriesWindow(w.id, action);
      await this.refresh();
    });
  }

  protected async endSeries(s: WindowSeries): Promise<void> {
    await this.run(async () => {
      await this.api.deleteSeries(s.id);
      await this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    const [windows, series] = await Promise.all([this.api.listWindows(), this.api.listSeries()]);
    this.allWindows.set(windows);
    this.series.set(series.series);
    this.canApproveHoliday.set(series.canApproveHoliday);
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('escAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }
}

/** "Cliente · Servicio": varios clientes tienen un servicio con el mismo nombre. */
function serviceLabel(s: { name: string; organizationName?: string | null }): string {
  return [s.organizationName, s.name].filter(Boolean).join(' · ');
}

/** YYYY-MM-DD en la hora local del navegador. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
