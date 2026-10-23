import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ButtonComponent } from '../../shared/ui/button/button';
import { Goal, GoalBonus, GoalInput, GoalKind, GoalScope, ManagementService, MgmtMeta } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/management';

export interface GoalDialogData {
  meta: MgmtMeta;
  clients: { id: string; name: string }[];
  areas: { id: string; name: string }[];
  /** Al crear: para quién parte. */
  preset?: { scope?: GoalScope; clientId?: string; personId?: string };
  /** Al editar. */
  goal?: Goal;
}

/**
 * Nueva meta / Editar meta (diseño aprobado): para un cliente, un área o una
 * persona; las de una persona con tipo, bono y validación de la CSM. El plazo es una
 * fecha límite o un tiempo estimado en días hábiles (lo convierte el servidor
 * con el calendario de la Agenda).
 */
@Component({
  selector: 'app-mgmt-goal-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal>
      <span app-modal-title><mat-icon class="gd__ic">flag</mat-icon>{{ i18n.t(editing ? 'mg.gf.edit' : 'mg.gf.new') }}</span>
      <form class="gd" (submit)="$event.preventDefault(); save()">
        @if (!editing) {
          <div class="field"><span>{{ i18n.t('mg.gf.for') }}</span>
            <div class="gd__chips">
              <button type="button" class="seg" [attr.aria-pressed]="scope() === 'client'" (click)="setScope('client')"><mat-icon>business</mat-icon>{{ i18n.t('mg.gf.client') }}</button>
              <button type="button" class="seg" [attr.aria-pressed]="scope() === 'area'" (click)="setScope('area')"><mat-icon>groups</mat-icon>{{ i18n.t('mg.gf.area') }}</button>
              <button type="button" class="seg" [attr.aria-pressed]="scope() === 'person'" (click)="setScope('person')"><mat-icon>person</mat-icon>{{ i18n.t('mg.gf.person') }}</button>
            </div>
          </div>
        }
        @switch (scope()) {
          @case ('person') {
            @if (!editing) {
              @if (data.meta.people.length || canExternal) {
                <label class="field"><span>{{ i18n.t('mg.g.person') }}</span>
                  <select name="gPerson" (change)="person.set(val($event))">
                    @for (p of people(); track p.id) { <option [value]="p.id" [selected]="person() === p.id">{{ p.name }} ({{ p.label }})</option> }
                    @if (canExternal) { <option [value]="EXTERNAL" [selected]="external()">{{ i18n.t('mg.gf.external') }}</option> }
                  </select>
                  @if (personName(); as n) { <span class="gd__hint">{{ i18n.tf('mg.gf.personHint', n) }}</span> }
                </label>
                @if (external()) {
                  <div class="field-grid">
                    <label class="field"><span>{{ i18n.t('mg.gf.extName') }}</span>
                      <input name="gExtName" maxlength="120" autocomplete="off" [value]="extName()" (input)="extName.set(val($event))" /></label>
                    <label class="field"><span>{{ i18n.t('mg.gf.extEmail') }}</span>
                      <input name="gExtEmail" type="email" maxlength="254" autocomplete="off" [value]="extEmail()" (input)="extEmail.set(val($event))" /></label>
                  </div>
                  <span class="gd__hint">{{ i18n.t('mg.gf.extHint') }}</span>
                }
              } @else {
                <p class="gd__hint">{{ i18n.t('mg.gf.noPeople') }}</p>
              }
            }
            <div class="field"><span>{{ i18n.t('mg.gf.kind') }}</span>
              <div class="gd__chips">
                @for (k of kinds; track k) { <button type="button" class="seg" [attr.aria-pressed]="kind() === k" (click)="setKind(k)">{{ i18n.t(kindKey(k)) }}</button> }
              </div>
            </div>
            <div class="field"><span>{{ i18n.t('mg.gf.bonus') }}</span>
              <div class="gd__chips">
                <button type="button" class="seg" [attr.aria-pressed]="bonus() === ''" (click)="bonus.set('')">{{ i18n.t('mg.gf.bonusNo') }}</button>
                <button type="button" class="seg" [attr.aria-pressed]="bonus() === 'primary'" (click)="bonus.set('primary')">{{ i18n.t('mg.gf.bonusPrimary') }}</button>
                <button type="button" class="seg" [attr.aria-pressed]="bonus() === 'secondary'" (click)="bonus.set('secondary')">{{ i18n.t('mg.gf.bonusSecondary') }}</button>
                <button type="button" class="seg" [attr.aria-pressed]="bonus() === 'tertiary'" (click)="bonus.set('tertiary')">{{ i18n.t('mg.gf.bonusTertiary') }}</button>
              </div>
              @if (bonus()) { <span class="gd__hint">{{ i18n.t('mg.gf.bonusHint') }}</span> }
            </div>
          }
          @case ('client') {
            <div class="field-grid">
              @if (!editing) {
                <label class="field"><span>{{ i18n.t('mg.g.client') }}</span>
                  <select name="gClient" (change)="client.set(val($event))">
                    <option value="" [selected]="!client()">{{ i18n.t('mg.act.clientPick') }}</option>
                    @for (c of data.clients; track c.id) { <option [value]="c.id" [selected]="client() === c.id">{{ c.name }}</option> }
                  </select>
                </label>
              }
              <label class="field"><span>{{ i18n.t('mg.gf.areaOpt') }}</span>
                <select name="gArea" (change)="area.set(val($event))">
                  <option value="" [selected]="!area()">{{ i18n.t('mg.gf.noArea') }}</option>
                  @for (a of data.areas; track a.id) { <option [value]="a.id" [selected]="area() === a.id">{{ a.name }}</option> }
                </select>
              </label>
            </div>
          }
          @case ('area') {
            @if (!editing) {
              <div class="field"><span>{{ i18n.t('mg.g.area') }}</span>
                <div class="gd__chips">
                  @for (a of data.areas; track a.id) { <button type="button" class="seg" [attr.aria-pressed]="area() === a.id" (click)="area.set(a.id)">{{ a.name }}</button> }
                </div>
              </div>
            }
          }
        }
        <label class="field"><span>{{ i18n.t('mg.gf.name') }}</span>
          <input name="gName" maxlength="200" [placeholder]="i18n.t(scope() === 'person' ? 'mg.gf.namePh.person' : 'mg.gf.namePh.other')" [value]="name()" (input)="name.set(val($event))" /></label>
        <div class="field"><span>{{ i18n.t('mg.gf.due') }}</span>
          <div class="gd__chips">
            <button type="button" class="seg" [attr.aria-pressed]="due() === 'date'" (click)="due.set('date')">{{ i18n.t('mg.gf.date') }}</button>
            <button type="button" class="seg" [attr.aria-pressed]="due() === 'days'" (click)="due.set('days')">{{ i18n.t('mg.gf.days') }}</button>
          </div>
          @if (due() === 'date') {
            <input name="gDate" class="mono gd__date" type="date" [value]="date()" (input)="date.set(val($event))" />
          } @else {
            <span class="gd__line"><input name="gDays" class="mono gd__days" type="number" min="1" max="500" [value]="days()" (input)="days.set(val($event))" [attr.aria-label]="i18n.t('mg.gf.daysLabel')" />{{ i18n.t('mg.gf.daysLabel') }}</span>
          }
        </div>
        @if (!editing) {
          <div class="field"><span>{{ i18n.t('mg.gf.steps') }}</span>
            @for (s of steps(); track $index) {
              <div class="gd__step"><span class="gd__hint">{{ $index + 1 }}.</span><span>{{ s }}</span>
                <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.tf('mg.g.removeStep', s)" (click)="removeStep($index)"><mat-icon>close</mat-icon></button></div>
            } @empty {
              <span class="gd__hint">{{ i18n.t('mg.gf.noSteps') }}</span>
            }
            <span class="gd__line"><input name="gStep" maxlength="200" [placeholder]="i18n.t('mg.gf.addStep')" [value]="stepDraft()" (input)="stepDraft.set(val($event))" (keydown.enter)="$event.preventDefault(); addStep()" />
              <button type="button" class="adm-btn" (click)="addStep()">{{ i18n.t('mg.gf.add') }}</button></span>
          </div>
        }
        @if (scope() === 'person' && kind() === 'certification') {
          <label class="gd__check"><input type="checkbox" name="gValidation" [checked]="validation()" (change)="validation.set(!validation())" />
            <span><b>{{ i18n.t('mg.gf.validation') }}</b><span class="gd__hint gd__block">{{ i18n.t('mg.gf.validationHint') }}</span></span></label>
        }
        @if (error(); as e) { <p class="msg msg--error" role="alert">{{ e }}</p> }
      </form>
      <ng-container app-modal-actions>
        <app-button (pressed)="ref.close()">{{ i18n.t('mg.cancel') }}</app-button>
        <app-button variant="primary" [disabled]="!valid() || busy()" (pressed)="save()">{{ i18n.t(editing ? 'mg.save' : 'mg.gf.create') }}</app-button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .gd { display: flex; flex-direction: column; gap: 12px; width: min(560px, calc(100vw - 64px)); }
    .gd__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .gd__chips mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .gd__hint { color: var(--text-muted); font-size: 11.5px; }
    .gd__block { display: block; }
    .gd__line { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .gd__line input:not([type="number"]) { flex: 1; }
    .gd__date { max-width: 200px; }
    .gd__days { max-width: 90px; }
    .gd__step { display: grid; grid-template-columns: 20px minmax(0, 1fr) 28px; gap: 6px; align-items: center; font-size: 13px; }
    .gd__check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; }
    .gd__check input { margin-top: 3px; accent-color: var(--accent); }
    .gd__ic { width: 18px; height: 18px; margin-right: 6px; font-size: 18px; vertical-align: -3px; }
  `,
})
export class GoalDialogComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<GoalDialogData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef<Goal>);
  private readonly api = inject(ManagementService);

  protected readonly editing = !!this.data.goal;
  /** Opción «Alguien sin cuenta» del selector de persona. */
  protected readonly EXTERNAL = '__external';
  /** Una meta para alguien sin cuenta la registran el admin o una jefatura. */
  protected readonly canExternal = this.data.meta.admin || this.data.meta.leadAreas.length > 0;
  protected readonly kinds: GoalKind[] = ['certification', 'action', 'other'];
  private readonly g = this.data.goal;
  private readonly p = this.data.preset ?? {};

  protected readonly scope = signal<GoalScope>(this.g?.scope ?? this.p.scope ?? (this.data.meta.people.length && !this.p.clientId ? 'person' : 'client'));
  protected readonly client = signal(this.g?.clientId ?? this.p.clientId ?? '');
  protected readonly area = signal(this.g?.areaId ?? '');
  protected readonly person = signal(this.g?.personId ?? this.p.personId ?? this.data.meta.people[0]?.id ?? (this.canExternal ? this.EXTERNAL : ''));
  protected readonly external = computed(() => this.person() === this.EXTERNAL);
  protected readonly extName = signal('');
  protected readonly extEmail = signal('');
  protected readonly kind = signal<GoalKind>(this.g?.kind ?? 'certification');
  protected readonly bonus = signal<GoalBonus | ''>(this.g?.bonus ?? (this.g ? '' : 'primary'));
  protected readonly name = signal(this.g?.name ?? '');
  protected readonly due = signal<'date' | 'days'>(this.g?.estimateBizDays ? 'days' : 'date');
  protected readonly date = signal(this.g?.dueDate ?? '');
  protected readonly days = signal(String(this.g?.estimateBizDays ?? 15));
  protected readonly steps = signal<string[]>(!this.g && this.scope() === 'person' ? this.certSteps() : []);
  protected readonly stepDraft = signal('');
  protected readonly validation = signal(this.g?.validationRequired ?? true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Una persona aparece una vez, con sus áreas y niveles. */
  protected readonly people = computed(() => {
    const by = new Map<string, { id: string; name: string; label: string }>();
    for (const p of this.data.meta.people) {
      const label = p.areaId ? [p.areaName, p.level].filter(Boolean).join(' ') : this.i18n.t('mg.gf.noAreaPerson');
      const cur = by.get(p.id);
      by.set(p.id, cur ? { ...cur, label: `${cur.label}, ${label}` } : { id: p.id, name: p.name, label });
    }
    return [...by.values()];
  });
  protected readonly personName = computed(() => this.people().find((p) => p.id === this.person())?.name ?? '');

  protected readonly valid = computed(() => {
    if (!this.name().trim()) return false;
    if (this.due() === 'date' ? !this.date() : !(Number(this.days()) >= 1)) return false;
    if (this.editing) return true;
    switch (this.scope()) {
      case 'client': return !!this.client();
      case 'area': return !!this.area();
      case 'person': return this.external() ? !!this.extName().trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.extEmail().trim()) : !!this.person();
    }
  });

  /** Una certificación parte con tres hitos (spec/16 §4.4.5). */
  private certSteps(): string[] {
    return [this.i18n.t('mg.gf.certStep1'), this.i18n.t('mg.gf.certStep2'), this.i18n.t('mg.gf.certStep3')];
  }

  protected kindKey(k: GoalKind): MessageKey {
    return `mg.gk.${k}` as MessageKey;
  }

  protected setScope(s: GoalScope): void {
    this.scope.set(s);
    if (s === 'person') {
      if (this.kind() === 'certification' && !this.steps().length) this.steps.set(this.certSteps());
    } else if (this.kind() === 'certification' && this.steps().join() === this.certSteps().join()) {
      this.steps.set([]);
    }
  }

  protected setKind(k: GoalKind): void {
    const wasCert = this.steps().join() === this.certSteps().join();
    this.kind.set(k);
    if (k === 'certification' && !this.steps().length) this.steps.set(this.certSteps());
    else if (k !== 'certification' && wasCert) this.steps.set([]);
  }

  protected addStep(): void {
    const s = this.stepDraft().trim();
    if (!s) return;
    this.steps.update((list) => [...list, s]);
    this.stepDraft.set('');
  }

  protected removeStep(i: number): void {
    this.steps.update((list) => list.filter((_, j) => j !== i));
  }

  protected async save(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const scope = this.scope();
    const input: GoalInput = {
      name: this.name().trim(), scope,
      dueDate: this.due() === 'date' ? this.date() : undefined,
      estimateBizDays: this.due() === 'days' ? Number(this.days()) : undefined,
      validationRequired: scope === 'person' && this.kind() === 'certification' && this.validation(),
      steps: this.steps(),
    };
    if (scope === 'client') Object.assign(input, { clientId: this.client(), areaId: this.area() || undefined });
    if (scope === 'area') input.areaId = this.area();
    if (scope === 'person') {
      Object.assign(input, { kind: this.kind(), bonus: this.bonus() });
      if (this.external()) Object.assign(input, { personName: this.extName().trim(), personEmail: this.extEmail().trim() });
      else input.personId = this.person();
    }
    if (this.g?.ownerId && scope !== 'person') input.ownerId = this.g.ownerId;
    try {
      const saved = this.g ? await this.api.updateGoal(this.g.id, input) : await this.api.createGoal(input);
      this.ref.close(saved);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
