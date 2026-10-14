import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Area, AreasService, Level, PROFILES, Profile } from '../../core/areas/areas.service';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

import '../../core/i18n/packs/admin';

/**
 * Administración → Áreas y niveles (spec/16 §3, 9b; canvas "Áreas, niveles y
 * perfiles", aprobado por el dueño 2026-10-13). Áreas: de quién son los
 * datos; SOC y NOC son de sistema y se encienden acá. Niveles: se combinan
 * con el área y su orden decide quién asigna a quién.
 */
@Component({
  selector: 'app-admin-areas',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.areas') }}</h2>
        <p class="adm-muted">{{ i18n.t('areas.subtitle') }}</p>
      </div>
    </header>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    <div class="ar__grid">
      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>hub</mat-icon>{{ i18n.t('areas.areas') }}</h3>
          <button type="button" class="adm-btn adm-btn--primary adm-push" [disabled]="busy()" (click)="newArea.set('')"><mat-icon>add</mat-icon>{{ i18n.t('areas.newArea') }}</button>
        </div>
        @if (newArea() !== null) {
          <form class="ar__new" (submit)="$event.preventDefault(); createArea()">
            <label class="adm-field ar__grow">
              <span class="adm-label">{{ i18n.t('areas.name') }}</span>
              <input class="adm-input" name="newArea" maxlength="60" placeholder="Infraestructura" [ngModel]="newArea()" (ngModelChange)="newArea.set($event)" />
            </label>
            <button type="button" class="adm-btn" (click)="newArea.set(null)">{{ i18n.t('areas.cancel') }}</button>
            <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !(newArea() ?? '').trim()">{{ i18n.t('areas.create') }}</button>
          </form>
        }
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ i18n.t('areas.col.area') }}</th><th>{{ i18n.t('areas.col.code') }}</th><th>{{ i18n.t('areas.col.profile') }}</th><th class="adm-num">{{ i18n.t('areas.col.groups') }}</th><th>{{ i18n.t('areas.col.active') }}</th><th></th></tr></thead>
            <tbody>
              @for (a of areas(); track a.id) {
                <tr [class.ar__off]="!a.active">
                  <td>
                    @if (renaming() === a.id) {
                      <input class="adm-input" [attr.aria-label]="i18n.t('areas.name')" maxlength="60" [ngModel]="renameTo()" (ngModelChange)="renameTo.set($event)" (keydown.enter)="renameArea(a)" (keydown.escape)="renaming.set(null)" />
                    } @else {
                      <strong>{{ a.name }}</strong>
                      @if (a.system) { <span class="pill tone-system ar__tag">{{ i18n.t('areas.system') }}</span> }
                    }
                  </td>
                  <td class="mono adm-secondary">{{ a.code }}</td>
                  <td>
                    <select class="adm-input ar__profile" [attr.aria-label]="i18n.t('areas.col.profile') + ' · ' + a.name" [disabled]="busy()" [value]="a.profile" (change)="setProfile(a, $any($event.target).value)">
                      @for (p of profiles; track p) { <option [value]="p" [selected]="a.profile === p">{{ i18n.t(profileKey(p)) }}</option> }
                    </select>
                  </td>
                  <td class="adm-num mono">{{ a.groupCount }}</td>
                  <td>
                    <label class="switch">
                      <input class="switch__input" type="checkbox" role="switch" [attr.aria-label]="a.name" [checked]="a.active" [disabled]="busy()" (change)="toggleArea(a)" />
                      <span class="switch__track" aria-hidden="true"></span>
                    </label>
                  </td>
                  <td class="adm-num">
                    @if (renaming() === a.id) {
                      <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('areas.save')" (click)="renameArea(a)"><mat-icon>check</mat-icon></button>
                    } @else {
                      <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('areas.rename') + ' ' + a.name" (click)="startRename(a.id, a.name)"><mat-icon>edit</mat-icon></button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="adm-card__note">{{ i18n.t('areas.areasHint') }}</p>
        <p class="adm-card__note">{{ i18n.t('areas.peopleHint') }} <button type="button" class="ar__link" (click)="goToAccess.emit()">{{ i18n.t('areas.toAccess') }}</button></p>
      </section>

      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>stairs</mat-icon>{{ i18n.t('areas.levels') }}</h3>
          <button type="button" class="adm-btn adm-push" [disabled]="busy()" (click)="newLevel.set('')"><mat-icon>add</mat-icon>{{ i18n.t('areas.newLevel') }}</button>
        </div>
        @if (newLevel() !== null) {
          <form class="ar__new" (submit)="$event.preventDefault(); createLevel()">
            <label class="adm-field ar__grow">
              <span class="adm-label">{{ i18n.t('areas.name') }}</span>
              <input class="adm-input" name="newLevel" maxlength="60" placeholder="N4" [ngModel]="newLevel()" (ngModelChange)="newLevel.set($event)" />
            </label>
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
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ar__grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .ar__new { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--accent-soft); }
    .ar__grow { flex: 1; min-width: 0; }
    .ar__off { opacity: 0.55; }
    .ar__profile { padding: 3px 6px; }
    .ar__link { padding: 0; border: none; background: none; color: var(--accent); font: inherit; cursor: pointer; }
    .ar__link:hover { text-decoration: underline; }
    .ar__tag { margin-left: 6px; }
    .ar__levels { margin: 0; padding: 0; list-style: none; }
    .ar__levels li { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border-subtle); }
    @media (width <= 1100px) { .ar__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AdminAreasComponent implements OnInit {
  /** Lleva a Usuarios y grupos: las personas entran a un área por su grupo. */
  readonly goToAccess = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AreasService);
  private readonly setup = inject(SetupService);

  protected readonly profiles = PROFILES;
  protected readonly areas = signal<Area[]>([]);
  protected readonly levels = signal<Level[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** null = cerrado; '' o texto = el formulario abierto. */
  protected readonly newArea = signal<string | null>(null);
  protected readonly newLevel = signal<string | null>(null);
  protected readonly renaming = signal<string | null>(null);
  protected readonly renameTo = signal('');

  async ngOnInit(): Promise<void> {
    await this.run(() => this.load());
  }

  private async load(): Promise<void> {
    const [areas, levels] = await Promise.all([this.api.areas(), this.api.levels()]);
    this.areas.set(areas);
    this.levels.set(levels);
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
      await this.api.createArea(name);
      this.newArea.set(null);
      await this.load();
    });
  }

  protected async toggleArea(a: Area): Promise<void> {
    await this.run(async () => {
      await this.api.patchArea(a.code, { active: !a.active });
      await this.load();
      // SOC y NOC abren o cierran Bitácora, Turnos y Escalamiento en el menú, al instante.
      if (a.system) {
        const on = (code: string) => this.areas().some((x) => x.code === code && x.active);
        this.setup.applyModules({ socEnabled: on('soc'), nocEnabled: on('noc') });
      }
    }, () => void this.load());
  }

  protected async renameArea(a: Area): Promise<void> {
    const name = this.renameTo().trim();
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
