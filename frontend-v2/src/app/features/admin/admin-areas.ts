import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Area, AreaPerson, AreasService, Level, PROFILES, Profile } from '../../core/areas/areas.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { AreaPeopleComponent } from './area-people';
import { AdminGuardsComponent } from './admin-guards';
import { AdminEscalationComponent } from './admin-escalation';
import { TeamGuardsComponent } from '../team/team-guards';

import '../../core/i18n/packs/admin';

type AreaTab = 'people' | 'guards' | 'escalation';

/**
 * Administración → Áreas y niveles (spec/16 §3; canvas "Ficha del área",
 * aprobado por el dueño 2026-10-14): todo lo de la gente de un área. A la
 * izquierda las áreas; al elegir una se abre su ficha con Personas (nivel,
 * Jefe, permisos extra, agregar), Guardias y Escalamiento. Un área es gente:
 * apagarla no apaga funciones (los módulos SOC/NOC van en Módulos).
 */
@Component({
  selector: 'app-admin-areas',
  standalone: true,
  imports: [FormsModule, MatIconModule, AreaPeopleComponent, AdminGuardsComponent, AdminEscalationComponent, TeamGuardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ar">
      <aside class="adm-card ar__side">
        <div class="ar__side-head">
          <h2 class="adm-title">{{ i18n.t('admin.nav.areas') }}</h2>
          <p class="adm-muted adm-small">{{ i18n.t('areas.pick') }}</p>
        </div>
        @for (a of areas(); track a.id) {
          <button type="button" class="ar__item" [class.ar__item--on]="view() === a.code" [class.ar__off]="!a.active" (click)="pick(a.code)">
            <span class="ar__grow"><strong>{{ a.name }}</strong><span class="adm-small adm-muted ar__block">{{ i18n.t(profileKey(a.profile)) }}@if (!a.active) { · {{ i18n.t('areas.off') }} }</span></span>
            <span class="mono adm-small adm-muted">{{ countOf(a.code) }}</span>
          </button>
        }
        <div class="ar__side-foot">
          @if (newArea() !== null) {
            <form class="ar__new" (submit)="$event.preventDefault(); createArea()">
              <input class="adm-input" name="newArea" maxlength="60" placeholder="Infraestructura" [attr.aria-label]="i18n.t('areas.name')" [ngModel]="newArea()" (ngModelChange)="newArea.set($event)" />
              <span class="ar__row">
                <button type="button" class="adm-btn" (click)="newArea.set(null)">{{ i18n.t('areas.cancel') }}</button>
                <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !(newArea() ?? '').trim()">{{ i18n.t('areas.create') }}</button>
              </span>
            </form>
          } @else {
            <button type="button" class="adm-btn" (click)="newArea.set('')"><mat-icon>add</mat-icon>{{ i18n.t('areas.newArea') }}</button>
          }
          <button type="button" class="adm-btn" [class.adm-btn--primary]="view() === 'levels'" (click)="view.set('levels')"><mat-icon>stairs</mat-icon>{{ i18n.t('areas.levelsButton') }}</button>
        </div>
      </aside>

      <div class="ar__main">
        @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
        @if (view() === 'levels') {
          <section class="adm-card">
            <div class="adm-card__head">
              <h3 class="adm-card__title"><mat-icon>stairs</mat-icon>{{ i18n.t('areas.levels') }}</h3>
              <button type="button" class="adm-btn adm-push" [disabled]="busy()" (click)="newLevel.set('')"><mat-icon>add</mat-icon>{{ i18n.t('areas.newLevel') }}</button>
            </div>
            @if (newLevel() !== null) {
              <form class="ar__new ar__new--row" (submit)="$event.preventDefault(); createLevel()">
                <input class="adm-input ar__grow" name="newLevel" maxlength="60" placeholder="N4" [attr.aria-label]="i18n.t('areas.name')" [ngModel]="newLevel()" (ngModelChange)="newLevel.set($event)" />
                <button type="button" class="adm-btn" (click)="newLevel.set(null)">{{ i18n.t('areas.cancel') }}</button>
                <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !(newLevel() ?? '').trim()">{{ i18n.t('areas.create') }}</button>
              </form>
            }
            <ol class="ar__levels">
              @for (l of levels(); track l.id; let i = $index; let last = $last) {
                <li>
                  <span class="mono adm-secondary">{{ i + 1 }}</span>
                  @if (renaming() === l.id) {
                    <input class="adm-input ar__grow" [attr.aria-label]="i18n.t('areas.name')" maxlength="60" [ngModel]="renameTo()" (ngModelChange)="renameTo.set($event)" (keydown.enter)="renameLevel(l)" (keydown.escape)="renaming.set(null)" />
                  } @else {
                    <strong class="ar__grow">{{ l.name }}</strong>
                  }
                  <span class="adm-small adm-muted">{{ l.groupCount === 1 ? i18n.t('areas.levelGroup') : i18n.tf('areas.levelGroups', l.groupCount) }}</span>
                  <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('areas.rename') + ' ' + l.name" (click)="renaming() === l.id ? renameLevel(l) : startRename(l.id, l.name)"><mat-icon>{{ renaming() === l.id ? 'check' : 'edit' }}</mat-icon></button>
                  <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('areas.up') + ' ' + l.name" [disabled]="busy() || i === 0" (click)="moveLevel(i, -1)"><mat-icon>arrow_upward</mat-icon></button>
                  <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('areas.down') + ' ' + l.name" [disabled]="busy() || last" (click)="moveLevel(i, 1)"><mat-icon>arrow_downward</mat-icon></button>
                </li>
              }
            </ol>
            <p class="adm-card__note">{{ i18n.t('areas.levelsHint') }}</p>
          </section>
        } @else if (selected(); as a) {
          <header class="ar__head">
            <div class="ar__grow">
              @if (renaming() === a.id) {
                <input class="adm-input" [attr.aria-label]="i18n.t('areas.name')" maxlength="60" [ngModel]="renameTo()" (ngModelChange)="renameTo.set($event)" (keydown.enter)="renameArea(a)" (keydown.escape)="renaming.set(null)" (blur)="renameArea(a)" />
              } @else {
                <h2 class="adm-title">{{ a.name }}
                  @if (a.system) { <span class="pill tone-system">{{ i18n.t('areas.system') }}</span> }
                  <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('areas.rename') + ' ' + a.name" (click)="startRename(a.id, a.name)"><mat-icon>edit</mat-icon></button>
                </h2>
              }
              <p class="adm-small adm-muted">{{ i18n.t('areas.leads') }} <strong class="ar__leads">{{ leads() || i18n.t('areas.noLeads') }}</strong></p>
            </div>
            <label class="adm-field ar__profile"><span class="adm-label">{{ i18n.t('areas.col.profile') }}</span>
              <select class="adm-input" [disabled]="busy()" [value]="a.profile" (change)="setProfile(a, $any($event.target).value)">
                @for (p of profiles; track p) { <option [value]="p" [selected]="a.profile === p">{{ i18n.t(profileKey(p)) }}</option> }
              </select>
            </label>
            <label class="ar__active">
              <span class="switch">
                <input class="switch__input" type="checkbox" role="switch" [attr.aria-label]="i18n.t('areas.col.active') + ' · ' + a.name" [checked]="a.active" [disabled]="busy()" (change)="toggleArea(a)" />
                <span class="switch__track" aria-hidden="true"></span>
              </span>
              <span class="adm-small">{{ i18n.t('areas.col.active') }}</span>
            </label>
          </header>
          <p class="adm-small adm-muted">{{ i18n.t('areas.areasHint') }}</p>
          @if (a.active) {
            <div class="ar__tabs" role="tablist">
              <button type="button" role="tab" class="seg" [attr.aria-selected]="tab() === 'people'" [attr.aria-pressed]="tab() === 'people'" (click)="tab.set('people')"><mat-icon>badge</mat-icon>{{ i18n.t('areas.tab.people') }}</button>
              <button type="button" role="tab" class="seg" [attr.aria-selected]="tab() === 'guards'" [attr.aria-pressed]="tab() === 'guards'" (click)="tab.set('guards')"><mat-icon>shield</mat-icon>{{ i18n.t('areas.tab.guards') }}</button>
              <button type="button" role="tab" class="seg" [attr.aria-selected]="tab() === 'escalation'" [attr.aria-pressed]="tab() === 'escalation'" (click)="tab.set('escalation')"><mat-icon>call_split</mat-icon>{{ i18n.t('areas.tab.escalation') }}</button>
            </div>
            <!-- Cada área monta su propia ficha (el @for la recrea al cambiar de área). -->
            @for (code of [a.code]; track code) {
              @if (tab() === 'people') {
                <app-area-people [area]="code" [areaName]="a.name" [levels]="levels()" (changed)="setPeople(code, $event)" />
              } @else if (tab() === 'guards') {
                <app-team-guards [area]="code" [areaName]="a.name" [people]="peopleOf(code)" />
                <app-admin-guards [area]="code" />
              } @else {
                <app-admin-escalation [area]="code" />
              }
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ar { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 16px; align-items: start; }
    .ar__side { display: flex; flex-direction: column; overflow: hidden; }
    .ar__side-head { padding: 14px 16px 8px; }
    .ar__side-head p { margin: 2px 0 0; }
    .ar__item { display: flex; align-items: center; gap: 8px; padding: 9px 16px; border: none; border-left: 3px solid transparent; background: none; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .ar__item:hover { background: var(--bg-surface-hover); }
    .ar__item--on { border-left-color: var(--accent); background: var(--accent-soft); }
    .ar__item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .ar__block { display: block; }
    .ar__off { opacity: 0.55; }
    .ar__side-foot { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-top: 1px solid var(--border-subtle); }
    .ar__new { display: flex; flex-direction: column; gap: 6px; }
    .ar__new--row { flex-direction: row; flex-wrap: wrap; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--accent-soft); }
    .ar__row { display: flex; gap: 6px; justify-content: flex-end; }
    .ar__main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .ar__head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px; }
    .ar__head h2 { display: flex; align-items: center; gap: 8px; margin: 0; }
    .ar__head p { margin: 2px 0 0; }
    .ar__leads { color: var(--text-primary); }
    .ar__profile { width: 160px; }
    .ar__active { display: inline-flex; align-items: center; gap: 6px; padding-bottom: 6px; }
    .ar__grow { flex: 1; min-width: 0; }
    .ar__tabs { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle); }
    .ar__tabs mat-icon { width: 14px; height: 14px; font-size: 14px; vertical-align: -2px; margin-right: 4px; }
    .ar__levels { margin: 0; padding: 0; list-style: none; }
    .ar__levels li { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border-subtle); }
    @media (width <= 900px) { .ar { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AdminAreasComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AreasService);

  protected readonly profiles = PROFILES;
  protected readonly areas = signal<Area[]>([]);
  protected readonly levels = signal<Level[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** El área abierta (su código) o 'levels'. */
  protected readonly view = signal<string>('');
  protected readonly tab = signal<AreaTab>('people');
  /** La gente de cada área ya cargada (para el conteo, los jefes y las guardias). */
  private readonly people = signal<Record<string, AreaPerson[]>>({});
  /** null = cerrado; '' o texto = el formulario abierto. */
  protected readonly newArea = signal<string | null>(null);
  protected readonly newLevel = signal<string | null>(null);
  protected readonly renaming = signal<string | null>(null);
  protected readonly renameTo = signal('');

  protected readonly selected = computed(() => this.areas().find((a) => a.code === this.view()) ?? null);
  protected readonly leads = computed(() =>
    this.peopleOf(this.view()).filter((p) => p.lead).map((p) => p.fullName || p.username).join(', '),
  );

  async ngOnInit(): Promise<void> {
    await this.run(() => this.load());
    if (!this.view()) this.view.set(this.areas().find((a) => a.active)?.code ?? this.areas()[0]?.code ?? 'levels');
  }

  private async load(): Promise<void> {
    const [areas, levels] = await Promise.all([this.api.areas(), this.api.levels()]);
    this.areas.set(areas);
    this.levels.set(levels);
  }

  protected pick(code: string): void {
    this.view.set(code);
    this.renaming.set(null);
  }

  protected peopleOf(code: string): AreaPerson[] {
    return this.people()[code] ?? [];
  }

  protected setPeople(code: string, list: AreaPerson[]): void {
    this.people.update((all) => ({ ...all, [code]: list }));
  }

  /** Cuántas personas tiene el área (si ya se abrió su ficha). */
  protected countOf(code: string): string {
    const list = this.people()[code];
    return list ? String(list.length) : '';
  }

  protected profileKey(p: Profile): MessageKey {
    return `access.profile.${p}` as MessageKey;
  }

  /** El perfil de los grupos que se arman solos en el área (los que ya existen no cambian). */
  protected async setProfile(a: Area, profile: Profile): Promise<void> {
    if (profile === a.profile) return;
    await this.run(async () => {
      await this.api.patchArea(a.code, { profile });
      await this.load();
    }, () => void this.load());
  }

  protected startRename(id: string, name: string): void {
    this.renaming.set(id);
    this.renameTo.set(name);
  }

  protected async createArea(): Promise<void> {
    const name = (this.newArea() ?? '').trim();
    if (!name) return;
    await this.run(async () => {
      const a = await this.api.createArea(name);
      this.newArea.set(null);
      await this.load();
      this.view.set(a.code);
    });
  }

  protected async toggleArea(a: Area): Promise<void> {
    await this.run(async () => {
      await this.api.patchArea(a.code, { active: !a.active });
      await this.load();
    }, () => void this.load());
  }

  protected async renameArea(a: Area): Promise<void> {
    const name = this.renameTo().trim();
    if (this.renaming() !== a.id) return;
    if (!name || name === a.name) {
      this.renaming.set(null);
      return;
    }
    await this.run(async () => {
      await this.api.patchArea(a.code, { name });
      this.renaming.set(null);
      await this.load();
    });
  }

  protected async createLevel(): Promise<void> {
    const name = (this.newLevel() ?? '').trim();
    if (!name) return;
    await this.run(async () => {
      await this.api.createLevel(name);
      this.newLevel.set(null);
      await this.load();
    });
  }

  protected async renameLevel(l: Level): Promise<void> {
    const name = this.renameTo().trim();
    if (!name || name === l.name) {
      this.renaming.set(null);
      return;
    }
    await this.run(async () => {
      await this.api.renameLevel(l.id, name);
      this.renaming.set(null);
      await this.load();
    });
  }

  protected async moveLevel(i: number, delta: number): Promise<void> {
    const list = [...this.levels()];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.levels.set(list);
    await this.run(() => this.api.orderLevels(list.map((l) => l.id)), () => void this.load());
  }

  private async run(action: () => Promise<unknown>, onError?: () => void): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('areas.error')));
      onError?.();
    } finally {
      this.busy.set(false);
    }
  }
}
