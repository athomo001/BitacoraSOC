import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Guard, GuardsService } from '../../core/shifts/guards.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

import '../../core/i18n/packs/team';

/** Quien se puede sumar a una guardia (de Mi equipo o de la ficha del área). */
export interface GuardCandidate { id: string; username: string; fullName: string; active: boolean; }

/**
 * Mi equipo → Guardias (9e, canvas "Guardias y escalamiento por área",
 * aprobado por el dueño 2026-10-14): las guardias del área, quién está en
 * cada una y una guardia nueva. Las fechas (asignar, rotación, reemplazos)
 * se ven y editan abajo, en la misma línea de tiempo de Administración.
 */
@Component({
  selector: 'app-team-guards',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h2 class="adm-card__title"><mat-icon>shield</mat-icon>{{ i18n.tf('team.g.title', areaName()) }}</h2>
        @if (!creating()) {
          <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="creating.set(true)"><mat-icon>add</mat-icon>{{ i18n.t('team.g.new') }}</button>
        }
      </div>
      @if (error(); as e) { <p class="adm-error tg__pad" role="alert">{{ e }}</p> }
      @if (creating()) {
        <form class="tg__new" (submit)="$event.preventDefault(); create()">
          <label class="adm-field tg__grow"><span class="adm-label">{{ i18n.t('team.g.name') }}</span>
            <input class="adm-input" name="guardName" maxlength="40" placeholder="Infra" [ngModel]="name()" (ngModelChange)="name.set($event)" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('team.g.changeDay') }}</span>
            <select class="adm-input" name="changeDay" [ngModel]="changeDay()" (ngModelChange)="changeDay.set(+$event)">
              @for (d of weekdays; track d) { <option [value]="d">{{ i18n.t(dayKey(d)) }}</option> }
            </select></label>
          <label class="tg__check"><input type="checkbox" name="mustBeCovered" [checked]="mustBeCovered()" (change)="mustBeCovered.set($any($event.target).checked)" />{{ i18n.t('team.g.mustBeCovered') }}</label>
          <button type="button" class="adm-btn" (click)="creating.set(false)">{{ i18n.t('team.cancel') }}</button>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !name().trim()">{{ i18n.t('team.g.create') }}</button>
        </form>
      }
      @for (g of guards(); track g.cycleId) {
        <div class="tg__row">
          <strong class="tg__label">{{ g.label }}</strong>
          <span class="tg__members">
            @for (m of g.members; track m.teamMemberId) {
              <span class="pill tone-accent">{{ m.name }}
                <button type="button" class="tg__x" [attr.aria-label]="i18n.tf('team.g.remove', m.name)" [disabled]="busy()" (click)="remove(g, m.teamMemberId)"><mat-icon>close</mat-icon></button>
              </span>
            } @empty { <span class="adm-small adm-muted">{{ i18n.t('team.g.noMembers') }}</span> }
          </span>
          <select class="adm-input tg__add" [attr.aria-label]="i18n.tf('team.g.addTo', g.label)" [disabled]="busy()" (change)="add(g, $any($event.target).value); $any($event.target).value = ''">
            <option value="">{{ i18n.t('team.g.add') }}</option>
            @for (p of candidates(g); track p.id) { <option [value]="p.id">{{ p.fullName || p.username }}</option> }
          </select>
        </div>
      } @empty {
        <p class="adm-empty">{{ i18n.t('team.g.empty') }}</p>
      }
      <p class="adm-card__note">{{ i18n.t('team.g.hint') }}</p>
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tg__pad { margin: 8px 16px 0; }
    .tg__new { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--accent-soft); }
    .tg__grow { flex: 1 1 160px; }
    .tg__check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding-bottom: 6px; }
    .tg__row { display: grid; grid-template-columns: 140px minmax(0, 1fr) 200px; gap: 10px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); }
    .tg__label { overflow-wrap: anywhere; }
    .tg__members { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
    .tg__x { display: inline-flex; padding: 0; margin-left: 2px; border: none; background: none; color: inherit; cursor: pointer; }
    .tg__x mat-icon { width: 13px; height: 13px; font-size: 13px; }
    .tg__add { padding: 4px 6px; }
    @media (width <= 700px) { .tg__row { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class TeamGuardsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GuardsService);

  readonly area = input.required<string>();
  readonly areaName = input.required<string>();
  /** La gente del área, para sumarla a una guardia. */
  readonly people = input.required<GuardCandidate[]>();
  /** Cambió una guardia o sus integrantes: la línea de tiempo de abajo se recarga. */
  readonly changed = output<void>();

  protected readonly guards = signal<Guard[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly name = signal('');
  protected readonly changeDay = signal(1);
  protected readonly mustBeCovered = signal(false);
  /** Lunes a domingo (0 = domingo). */
  protected readonly weekdays = [1, 2, 3, 4, 5, 6, 0];

  async ngOnInit(): Promise<void> {
    await this.run(() => this.load());
  }

  protected dayKey(d: number): MessageKey {
    return `team.g.day.${d}` as MessageKey;
  }

  protected candidates(g: Guard): GuardCandidate[] {
    const inGuard = new Set(g.members.map((m) => m.userId));
    return this.people().filter((p) => p.active && !inGuard.has(p.id));
  }

  private async load(): Promise<void> {
    const now = new Date();
    const view = await this.api.timeline(new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000), this.area());
    this.guards.set(view.guards);
  }

  protected async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    await this.run(async () => {
      await this.api.createGuard(this.area(), name, this.changeDay(), this.mustBeCovered());
      this.creating.set(false);
      this.name.set('');
      await this.load();
      this.changed.emit();
    });
  }

  protected async add(g: Guard, userId: string): Promise<void> {
    if (!userId) return;
    await this.run(async () => {
      await this.api.addMember(g.cycleId, userId);
      await this.load();
      this.changed.emit();
    });
  }

  protected async remove(g: Guard, teamMemberId: string): Promise<void> {
    await this.run(async () => {
      await this.api.removeMember(g.cycleId, teamMemberId);
      await this.load();
      this.changed.emit();
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
