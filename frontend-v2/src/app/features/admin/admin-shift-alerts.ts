import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/admin';

interface AlertGuard { cycleId: string; teamId: string; name: string; remindUncovered: boolean; }
interface ShiftAlerts {
  checklistEnabled: boolean;
  checklistTime: string;
  checklistTeamId: string | null;
  checklistCargos: string[];
  checklistLastSent?: string;
  guardEnabled: boolean;
  guardDaysAhead: number;
  guardCargos: string[];
  guardLastSent?: string;
  guards: AlertGuard[];
}
interface Draft {
  checklistEnabled: boolean;
  checklistTime: string;
  checklistTeamId: string;
  checklistCargos: string;
  guardEnabled: boolean;
  guardDaysAhead: number;
  guardCargos: string;
  remind: string[];
}

const toDraft = (c: ShiftAlerts): Draft => ({
  checklistEnabled: c.checklistEnabled, checklistTime: c.checklistTime, checklistTeamId: c.checklistTeamId ?? '',
  checklistCargos: c.checklistCargos.join(', '), guardEnabled: c.guardEnabled, guardDaysAhead: c.guardDaysAhead,
  guardCargos: c.guardCargos.join(', '), remind: c.guards.filter((g) => g.remindUncovered).map((g) => g.cycleId).sort(),
});
const cargos = (raw: string): string[] => raw.split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean);

/**
 * Administración → Turnos → Avisos: dos correos del legacy (revisión de
 * paridad, decisiones del dueño 2026-10-16: «igual al legacy»).
 * - Checklist no realizado: a la hora elegida, si nadie hizo el checklist de
 *   inicio ese día, a quien está de guardia en la guardia elegida y a los cargos.
 * - Guardia sin cubrir: N días antes, si la semana que viene tiene una de las
 *   guardias marcadas sin nadie, a los cargos.
 */
@Component({
  selector: 'app-admin-shift-alerts',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (draft(); as d) {
      <section class="adm-card">
        <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>assignment_late</mat-icon>{{ i18n.t('alerts.checklist.title') }}</h3></div>
        <div class="adm-card__body sx">
          <label class="switch">
            <input class="switch__input" type="checkbox" role="switch" name="clEnabled" [ngModel]="d.checklistEnabled" (ngModelChange)="patch({ checklistEnabled: $event })" />
            <span class="switch__track" aria-hidden="true"></span>{{ i18n.t('alerts.checklist.enabled') }}
          </label>
          <div class="adm-row">
            <label class="adm-field adm-field--narrow">
              <span class="adm-label">{{ i18n.t('alerts.checklist.time') }}</span>
              <input class="adm-input mono" type="time" name="clTime" [disabled]="!d.checklistEnabled" [ngModel]="d.checklistTime" (ngModelChange)="patch({ checklistTime: $event })" />
            </label>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('alerts.checklist.guard') }}</span>
              <select class="adm-input" name="clGuard" [disabled]="!d.checklistEnabled" [ngModel]="d.checklistTeamId" (ngModelChange)="patch({ checklistTeamId: $event })">
                <option value="">{{ i18n.t('alerts.none') }}</option>
                @for (g of guards(); track g.cycleId) { <option [value]="g.teamId">{{ g.name }}</option> }
              </select>
            </label>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('alerts.cargos') }}</span>
              <input class="adm-input mono" name="clCargos" placeholder="N2" [disabled]="!d.checklistEnabled" [ngModel]="d.checklistCargos" (ngModelChange)="patch({ checklistCargos: $event })" />
            </label>
          </div>
          <span class="adm-hint">{{ i18n.t('alerts.checklist.hint') }}</span>
          @if (saved()?.checklistLastSent; as last) { <span class="adm-small adm-muted">{{ i18n.tf('alerts.lastSent', last) }}</span> }
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>event_busy</mat-icon>{{ i18n.t('alerts.guard.title') }}</h3></div>
        <div class="adm-card__body sx">
          <label class="switch">
            <input class="switch__input" type="checkbox" role="switch" name="grEnabled" [ngModel]="d.guardEnabled" (ngModelChange)="patch({ guardEnabled: $event })" />
            <span class="switch__track" aria-hidden="true"></span>{{ i18n.t('alerts.guard.enabled') }}
          </label>
          <div class="adm-row">
            <label class="adm-field adm-field--narrow">
              <span class="adm-label">{{ i18n.t('alerts.guard.days') }}</span>
              <input class="adm-input mono" type="number" min="1" max="60" name="grDays" [disabled]="!d.guardEnabled" [ngModel]="d.guardDaysAhead" (ngModelChange)="patch({ guardDaysAhead: +$event })" />
            </label>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('alerts.cargos') }}</span>
              <input class="adm-input mono" name="grCargos" placeholder="N2" [disabled]="!d.guardEnabled" [ngModel]="d.guardCargos" (ngModelChange)="patch({ guardCargos: $event })" />
            </label>
          </div>
          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('alerts.guard.which') }}</span>
            <span class="sx__chips">
              @for (g of guards(); track g.cycleId) {
                <button type="button" class="seg" [disabled]="!d.guardEnabled" [attr.aria-pressed]="d.remind.includes(g.cycleId)" (click)="toggleGuard(g.cycleId)">{{ g.name }}</button>
              } @empty { <span class="adm-hint">{{ i18n.t('alerts.guard.noGuards') }}</span> }
            </span>
          </div>
          <span class="adm-hint">{{ i18n.t('alerts.guard.hint') }}</span>
          @if (saved()?.guardLastSent; as last) { <span class="adm-small adm-muted">{{ i18n.tf('alerts.lastSent', last) }}</span> }
        </div>
        <footer class="adm-foot">
          <span class="adm-foot__status">
            @if (error(); as e) {
              <span class="adm-error" role="alert">{{ e }}</span>
            } @else if (notice(); as n) {
              <span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ n }}</span>
            } @else {
              <span class="adm-muted">{{ i18n.t(dirty() ? 'admin.unsaved' : 'admin.noChanges') }}</span>
            }
          </span>
          <button type="button" class="adm-btn adm-btn--primary adm-push" [disabled]="!dirty() || busy()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
        </footer>
      </section>
    } @else if (error(); as e) {
      <p class="adm-error" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .sx { display: flex; flex-direction: column; gap: 10px; }
    .sx__chips { display: flex; flex-wrap: wrap; gap: 6px; }
  `,
})
export class AdminShiftAlertsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);

  protected readonly saved = signal<ShiftAlerts | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly guards = computed(() => this.saved()?.guards ?? []);
  protected readonly dirty = computed(() => {
    const s = this.saved();
    const d = this.draft();
    return !!s && !!d && JSON.stringify(toDraft(s)) !== JSON.stringify({ ...d, remind: [...d.remind].sort() });
  });

  async ngOnInit(): Promise<void> {
    try {
      this.apply((await firstValueFrom(this.http.get<ApiEnvelope<ShiftAlerts>>('/api/config/shift-alerts'))).data);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('alerts.loadError')));
    }
  }

  protected patch(p: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
    this.notice.set(null);
    this.error.set(null);
  }

  protected toggleGuard(id: string): void {
    const d = this.draft();
    if (!d) return;
    this.patch({ remind: d.remind.includes(id) ? d.remind.filter((x) => x !== id) : [...d.remind, id] });
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = {
        checklistEnabled: d.checklistEnabled, checklistTime: d.checklistTime, checklistTeamId: d.checklistTeamId || null,
        checklistCargos: cargos(d.checklistCargos), guardEnabled: d.guardEnabled, guardDaysAhead: d.guardDaysAhead,
        guardCargos: cargos(d.guardCargos), remindCycleIds: d.remind,
      };
      this.apply((await firstValueFrom(this.http.put<ApiEnvelope<ShiftAlerts>>('/api/config/shift-alerts', body))).data);
      this.notice.set(this.i18n.t('admin.saved'));
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('alerts.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  private apply(c: ShiftAlerts): void {
    this.saved.set(c);
    this.draft.set(toDraft(c));
  }
}
