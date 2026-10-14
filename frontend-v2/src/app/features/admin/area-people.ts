import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { AreaPerson, AreasService, Level } from '../../core/areas/areas.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { CAPABILITIES } from './admin-access';

import '../../core/i18n/packs/admin';

interface UserOption { id: string; username: string; fullName?: string; active: boolean; }

/**
 * Ficha del área → Personas (canvas "Ficha del área", aprobado por el dueño
 * 2026-10-14): la gente del área con su nivel, Jefe y permisos extra; se
 * guarda al tocar. Agregar a alguien que ya existe o una persona nueva.
 * Por debajo usa la ubicación por área y nivel (los grupos se arman solos).
 */
@Component({
  selector: 'app-area-people',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ap">
      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>badge</mat-icon>{{ i18n.tf('ap.title', areaName()) }}</h3>
          <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="openAdd()"><mat-icon>person_add</mat-icon>{{ i18n.t('ap.add') }}</button>
        </div>
        @if (error(); as e) { <p class="adm-error ap__pad" role="alert">{{ e }}</p> }
        @if (people().length) {
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead><tr>
                <th>{{ i18n.t('ap.col.person') }}</th><th>{{ i18n.t('ap.col.level') }}</th>
                <th>{{ i18n.t('ap.col.lead') }}</th><th>{{ i18n.t('ap.col.extras') }}</th><th></th>
              </tr></thead>
              <tbody>
                @for (p of people(); track p.id) {
                  <tr [class.ap__off]="!p.active">
                    <td>
                      <strong>{{ p.fullName || p.username }}</strong>
                      <div class="adm-small adm-muted mono">{{ p.username }}@if (!p.active) { · {{ i18n.t('ap.inactive') }} }</div>
                    </td>
                    <td>
                      <div class="ap__levels" role="group" [attr.aria-label]="i18n.t('ap.col.level') + ' · ' + (p.fullName || p.username)">
                        @for (l of levels(); track l.id) {
                          <button type="button" [attr.aria-pressed]="p.levelId === l.id" [disabled]="busy()" (click)="setLevel(p, l.id)">{{ l.name }}</button>
                        }
                      </div>
                    </td>
                    <td>
                      <input type="checkbox" [attr.aria-label]="i18n.t('ap.col.lead') + ' · ' + (p.fullName || p.username)" [checked]="p.lead" [disabled]="busy()" (change)="toggleLead(p)" />
                    </td>
                    <td>
                      <button type="button" class="ap__extras" [attr.aria-label]="i18n.tf('ap.editExtras', p.fullName || p.username)" (click)="editing.set(editing() === p.id ? null : p.id)">
                        @for (c of p.extras; track c) { <span class="pill tone-accent">{{ capLabel(c) }}</span> } @empty { <span class="adm-small adm-muted">—</span> }
                        <mat-icon>{{ editing() === p.id ? 'expand_less' : 'edit' }}</mat-icon>
                      </button>
                      @if (editing() === p.id) {
                        <div class="ap__caps">
                          @for (cap of extraCapabilities; track cap.code) {
                            <label><input type="checkbox" [checked]="p.extras.includes(cap.code)" [disabled]="busy()" (change)="toggleExtra(p, cap.code)" />{{ i18n.t(cap.labelKey) }}</label>
                          }
                        </div>
                      }
                    </td>
                    <td class="adm-num">
                      <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.tf('ap.removeOf', p.fullName || p.username)" [disabled]="busy()" (click)="remove(p)"><mat-icon>person_remove</mat-icon></button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (loaded()) {
          <p class="adm-empty">{{ i18n.t('ap.empty') }}</p>
        }
        <p class="adm-card__note">{{ i18n.t('ap.hint') }}</p>
      </section>

      <section class="adm-card">
        @if (created(); as c) {
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>key</mat-icon>{{ c.username }}</h3></div>
          <div class="ap__body">
            <p>{{ i18n.tf('ap.created', c.username) }}</p>
            <code class="mono ap__pwd">{{ c.tempPassword }}</code>
            <p class="adm-small adm-muted">{{ i18n.t('ap.createdHint') }}</p>
            <div class="ap__actions"><button type="button" class="adm-btn adm-btn--primary" (click)="created.set(null)">{{ i18n.t('ap.done') }}</button></div>
          </div>
        } @else if (adding()) {
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>person_add</mat-icon>{{ i18n.tf('ap.addTo', areaName()) }}</h3></div>
          <form class="ap__body" (submit)="$event.preventDefault(); add()">
            <div class="ap__row" role="group">
              <button type="button" class="seg" [attr.aria-pressed]="mode() === 'existing'" (click)="mode.set('existing')">{{ i18n.t('ap.existing') }}</button>
              <button type="button" class="seg" [attr.aria-pressed]="mode() === 'new'" (click)="mode.set('new')">{{ i18n.t('ap.new') }}</button>
            </div>
            @if (mode() === 'existing') {
              <label class="adm-field"><span class="adm-label">{{ i18n.t('ap.person') }}</span>
                <select class="adm-input" name="userId" [ngModel]="userId()" (ngModelChange)="userId.set($event)">
                  <option value="">{{ i18n.t('ap.pickPerson') }}</option>
                  @for (u of candidates(); track u.id) { <option [value]="u.id">{{ u.fullName || u.username }}</option> }
                </select></label>
            } @else {
              <label class="adm-field"><span class="adm-label">{{ i18n.t('ap.name') }}</span>
                <input class="adm-input" name="fullName" maxlength="120" autocomplete="off" [ngModel]="draft().fullName" (ngModelChange)="setDraft('fullName', $event)" /></label>
              <label class="adm-field"><span class="adm-label">{{ i18n.t('ap.username') }}</span>
                <input class="adm-input mono" name="username" maxlength="40" autocomplete="off" [ngModel]="draft().username" (ngModelChange)="setDraft('username', $event)" /></label>
              <label class="adm-field"><span class="adm-label">{{ i18n.t('ap.email') }}</span>
                <input class="adm-input mono" name="email" type="email" maxlength="160" autocomplete="off" [ngModel]="draft().email" (ngModelChange)="setDraft('email', $event)" /></label>
              <p class="adm-small adm-muted">{{ i18n.t('ap.tempHint') }}</p>
            }
            <div class="adm-field">
              <span class="adm-label">{{ i18n.t('ap.col.level') }}</span>
              <div class="ap__row">
                @for (l of levels(); track l.id) {
                  <button type="button" class="seg" [attr.aria-pressed]="newLevel() === l.id" (click)="newLevel.set(l.id)">{{ l.name }}</button>
                }
              </div>
            </div>
            <div class="ap__actions">
              <button type="button" class="adm-btn" (click)="adding.set(false)">{{ i18n.t('ap.cancel') }}</button>
              <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !canAdd()"><mat-icon>person_add</mat-icon>{{ i18n.t('ap.confirm') }}</button>
            </div>
          </form>
        } @else {
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>verified_user</mat-icon>{{ i18n.t('ap.col.extras') }}</h3></div>
          <div class="ap__body">
            <p class="adm-small adm-muted">{{ i18n.t('ap.extrasHint') }}</p>
            <ul class="ap__list">@for (cap of extraCapabilities; track cap.code) { <li>{{ i18n.t(cap.labelKey) }}</li> }</ul>
            <p class="adm-small adm-muted">{{ i18n.t('ap.accountHint') }}</p>
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ap { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; align-items: start; }
    .ap__pad { margin: 8px 16px 0; }
    .ap__off { opacity: 0.55; }
    .ap__levels { display: inline-flex; border: 1px solid var(--border-subtle); border-radius: 6px; overflow: hidden; }
    .ap__levels button { padding: 3px 10px; border: none; border-left: 1px solid var(--border-subtle); background: var(--bg-app); color: var(--text-secondary); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
    .ap__levels button:first-child { border-left: none; }
    .ap__levels button[aria-pressed="true"] { background: var(--accent); color: var(--accent-contrast); }
    .ap__levels button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .ap__extras { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0; border: none; background: none; color: var(--text-muted); font: inherit; cursor: pointer; text-align: left; }
    .ap__caps { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; font-size: 12px; }
    .ap__caps label { display: inline-flex; align-items: center; gap: 6px; }
    .ap__body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; }
    .ap__body p { margin: 0; }
    .ap__row { display: flex; flex-wrap: wrap; gap: 6px; }
    .ap__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .ap__pwd { font-size: 16px; padding: 6px 10px; border-radius: 6px; background: var(--bg-surface-hover); user-select: all; align-self: flex-start; }
    .ap__list { margin: 0; padding-left: 18px; font-size: 12.5px; }
    @media (width <= 1100px) { .ap { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AreaPeopleComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AreasService);
  private readonly http = inject(HttpClient);

  readonly area = input.required<string>();
  readonly areaName = input.required<string>();
  readonly levels = input.required<Level[]>();
  /** Cambió la gente del área (la lista de áreas muestra cuántos hay). */
  readonly changed = output<AreaPerson[]>();

  protected readonly extraCapabilities = CAPABILITIES.filter((c) => c.code !== 'area:lead');
  protected readonly people = signal<AreaPerson[]>([]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly mode = signal<'existing' | 'new'>('existing');
  protected readonly users = signal<UserOption[]>([]);
  protected readonly userId = signal('');
  protected readonly newLevel = signal('');
  protected readonly draft = signal({ fullName: '', username: '', email: '' });
  protected readonly created = signal<{ username: string; tempPassword: string } | null>(null);

  protected readonly candidates = computed(() => {
    const inArea = new Set(this.people().map((p) => p.id));
    return this.users().filter((u) => u.active && !inArea.has(u.id));
  });
  protected readonly canAdd = computed(() => {
    if (this.mode() === 'existing') return !!this.userId();
    const d = this.draft();
    return !!d.fullName.trim() && !!d.username.trim() && d.email.includes('@');
  });

  async ngOnInit(): Promise<void> {
    await this.run(() => this.load());
    this.loaded.set(true);
  }

  protected capLabel(code: string): string {
    const cap = this.extraCapabilities.find((c) => c.code === code);
    return cap ? this.i18n.t(cap.labelKey) : code;
  }

  private async load(): Promise<void> {
    this.people.set(await this.api.areaPeople(this.area()));
    this.changed.emit(this.people());
  }

  /** Cambia la ubicación de la persona solo en esta área (o la saca, con null). */
  private async place(userId: string, change: (row: { code: string; levelId: string; lead: boolean } | null) => { levelId: string; lead: boolean } | null, extras?: (list: string[]) => string[]): Promise<void> {
    const current = await this.api.placement(userId);
    const row = current.areas.find((a) => a.code === this.area()) ?? null;
    const next = change(row);
    const areas = current.areas.filter((a) => a.code !== this.area());
    if (next) areas.push({ code: this.area(), ...next });
    await this.api.savePlacement(userId, { areas, extras: extras ? extras(current.extras) : current.extras });
  }

  protected async setLevel(p: AreaPerson, levelId: string): Promise<void> {
    if (p.levelId === levelId) return;
    await this.run(async () => {
      await this.place(p.id, (row) => ({ levelId, lead: row?.lead ?? false }));
      await this.load();
    });
  }

  protected async toggleLead(p: AreaPerson): Promise<void> {
    await this.run(async () => {
      await this.place(p.id, (row) => ({ levelId: row?.levelId ?? p.levelId, lead: !(row?.lead ?? p.lead) }));
      await this.load();
    });
  }

  protected async toggleExtra(p: AreaPerson, cap: string): Promise<void> {
    await this.run(async () => {
      await this.place(p.id, (row) => row && { levelId: row.levelId, lead: row.lead },
        (list) => (list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap].sort()));
      await this.load();
    });
  }

  protected async remove(p: AreaPerson): Promise<void> {
    await this.run(async () => {
      await this.place(p.id, () => null);
      await this.load();
    });
  }

  protected async openAdd(): Promise<void> {
    this.created.set(null);
    this.userId.set('');
    this.newLevel.set(this.levels()[0]?.id ?? '');
    this.draft.set({ fullName: '', username: '', email: '' });
    this.adding.set(true);
    if (!this.users().length) {
      await this.run(async () => this.users.set((await firstValueFrom(this.http.get<ApiEnvelope<UserOption[]>>('/api/users'))).data));
    }
  }

  protected setDraft(field: 'fullName' | 'username' | 'email', value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  protected async add(): Promise<void> {
    if (!this.canAdd()) return;
    await this.run(async () => {
      if (this.mode() === 'existing') {
        await this.place(this.userId(), () => ({ levelId: this.newLevel(), lead: false }));
      } else {
        const res = await this.api.createAreaPerson(this.area(), { ...this.draft(), levelId: this.newLevel() });
        this.created.set({ username: res.username, tempPassword: res.tempPassword });
      }
      this.adding.set(false);
      await this.load();
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('areas.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
