import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

interface ShiftMember {
  userId: string;
  username: string;
  displayName: string;
  weekdays: number[];
  userActive: boolean;
}

interface UserOption {
  id: string;
  username: string;
  fullName?: string;
  role: string;
  active: boolean;
}

/** Lunes primero; 0 = domingo como Date.getDay. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Personas del turno (WorkShiftAssignment del legacy): quién trabaja en el
 * turno y qué días. A ellas les llegan los recordatorios de turno; si el
 * turno no tiene personas, van a sus correos configurados.
 */
@Component({
  selector: 'app-admin-shift-members',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sm">
      <span class="adm-label">{{ i18n.t('shiftMembers.title') }}</span>
      @for (m of members(); track m.userId) {
        <div class="sm__row" [class.sm__row--off]="!m.userActive">
          <span class="sm__name">{{ m.displayName }}</span>
          <span class="sm__days" role="group" [attr.aria-label]="i18n.tf('shiftMembers.daysOf', m.displayName)">
            @for (d of week; track d) {
              <button type="button" class="adm-btn sm__day" [class.sm__on]="m.weekdays.includes(d)" [attr.aria-pressed]="m.weekdays.includes(d)" [disabled]="busy()" (click)="toggleDay(m, d)">{{ i18n.t(dayKey(d)) }}</button>
            }
          </span>
          <button type="button" class="adm-icon-btn adm-icon-btn--danger" [attr.aria-label]="i18n.tf('shiftMembers.remove', m.displayName)" [title]="i18n.tf('shiftMembers.remove', m.displayName)" [disabled]="busy()" (click)="remove(m)"><mat-icon>close</mat-icon></button>
        </div>
      } @empty {
        <span class="adm-hint">{{ i18n.t('shiftMembers.empty') }}</span>
      }
      <div class="sm__add">
        <select class="adm-input" name="smUser" [attr.aria-label]="i18n.t('shiftMembers.add')" [ngModel]="pick()" (ngModelChange)="pick.set($event)">
          <option value="">{{ i18n.t('shiftMembers.choose') }}</option>
          @for (u of available(); track u.id) { <option [value]="u.id">{{ u.fullName || u.username }}</option> }
        </select>
        <button type="button" class="adm-btn" [disabled]="!pick() || busy()" (click)="add()"><mat-icon>person_add</mat-icon>{{ i18n.t('shiftMembers.add') }}</button>
      </div>
      <span class="adm-hint">{{ i18n.t('shiftMembers.hint') }}</span>
      @if (error(); as e) { <span class="adm-error" role="alert">{{ e }}</span> }
    </div>
  `,
  styles: `
    mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .sm { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
    .sm__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .sm__row--off { opacity: 0.55; }
    .sm__name { min-width: 160px; font-weight: 600; font-size: 12.5px; }
    .sm__days { display: inline-flex; flex-wrap: wrap; gap: 3px; }
    .sm__day { padding: 2px 7px; font-size: 11px; }
    .sm__on, .sm__on:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
    .sm__add { display: flex; flex-wrap: wrap; gap: 6px; }
    .sm__add .adm-input { max-width: 260px; }
  `,
})
export class AdminShiftMembersComponent {
  readonly shiftId = input.required<string>();

  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);

  protected readonly week = WEEK;
  protected readonly members = signal<ShiftMember[]>([]);
  private readonly users = signal<UserOption[]>([]);
  protected readonly pick = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly available = computed(() =>
    this.users().filter((u) => u.active && u.role !== 'guest' && !this.members().some((m) => m.userId === u.id)),
  );

  constructor() {
    void this.loadUsers();
    effect(() => {
      const id = this.shiftId();
      void this.load(id);
    });
  }

  protected dayKey(d: number): MessageKey {
    return `ca.day.${d}` as MessageKey;
  }

  private async loadUsers(): Promise<void> {
    try {
      this.users.set((await firstValueFrom(this.http.get<ApiEnvelope<UserOption[]>>('/api/users'))).data);
    } catch {
      this.users.set([]);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const list = (await firstValueFrom(this.http.get<ApiEnvelope<ShiftMember[]>>(`/api/work-shifts/${id}/members`))).data;
      if (this.shiftId() === id) this.members.set(list);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('shiftMembers.error')));
    }
  }

  protected async add(): Promise<void> {
    await this.save(this.pick(), [1, 2, 3, 4, 5]);
    this.pick.set('');
  }

  protected async toggleDay(m: ShiftMember, d: number): Promise<void> {
    const days = m.weekdays.includes(d) ? m.weekdays.filter((x) => x !== d) : [...m.weekdays, d];
    if (!days.length) return; // al menos un día; para sacarla, la X
    await this.save(m.userId, days);
  }

  protected async remove(m: ShiftMember): Promise<void> {
    await this.run(() => firstValueFrom(this.http.delete(`/api/work-shifts/${this.shiftId()}/members/${m.userId}`)));
  }

  private async save(userId: string, weekdays: number[]): Promise<void> {
    await this.run(() => firstValueFrom(this.http.put(`/api/work-shifts/${this.shiftId()}/members/${userId}`, { weekdays })));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      await this.load(this.shiftId());
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('shiftMembers.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
