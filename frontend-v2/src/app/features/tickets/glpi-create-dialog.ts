import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ButtonComponent } from '../../shared/ui/button/button';
import { GlpiCreateInput, GlpiCreatePreview } from '../../core/glpi/glpi.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/glpi';

/** De dónde se crea: cómo leer la vista previa y cómo crear. */
export interface GlpiCreateDialogData<T> {
  load: () => Promise<GlpiCreatePreview>;
  create: (input: GlpiCreateInput) => Promise<T>;
}

/**
 * «Crear en GLPI» (10d.2, spec/18 §4.4–4.5, diseño aprobado): la vista previa
 * de lo que se va a crear, sacada del ticket o de la entrada y de los mapeos;
 * entidad, grupo, tipo y título se pueden cambiar antes de crear.
 */
@Component({
  selector: 'app-glpi-create-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal>
      <span app-modal-title><mat-icon class="gc__ic">add_task</mat-icon>{{ i18n.t('gw.create') }}</span>
      @if (preview(); as p) {
        <form class="gc" (submit)="$event.preventDefault(); create()">
          @if (p.problem) { <p class="gc__note gc__note--bad" role="alert">{{ p.problem }}</p> }
          <label class="field"><span>{{ i18n.t('gw.entity') }}</span>
            <select name="gcEntity" [value]="entity() ?? ''" (change)="entity.set(num($event))">
              @if (entity() === null) { <option value="">{{ i18n.t('gw.pickEntity') }}</option> }
              @for (e of p.entities; track e.id) { <option [value]="e.id" [selected]="e.id === entity()">{{ e.name }}</option> }
            </select></label>
          <label class="field"><span>{{ i18n.t('gw.group') }}</span>
            <select name="gcGroup" (change)="group.set(num($event) ?? 0)">
              <option value="0" [selected]="group() === 0">{{ i18n.t('gw.groupNone') }}</option>
              @for (g of p.groups; track g.id) { <option [value]="g.id" [selected]="g.id === group()">{{ g.name }}</option> }
            </select></label>
          <div class="field"><span>{{ i18n.t('gw.type') }}</span>
            <span class="gc__row">
              <button type="button" class="seg" [attr.aria-pressed]="type() === 1" (click)="type.set(1)">{{ i18n.t('gw.type1') }}</button>
              <button type="button" class="seg" [attr.aria-pressed]="type() === 2" (click)="type.set(2)">{{ i18n.t('gw.type2') }}</button>
            </span></div>
          <div class="field"><span>{{ i18n.t('gw.urgencyImpact') }}</span><span class="mono">{{ p.urgency }} · {{ p.impact }}</span></div>
          <label class="field"><span>{{ i18n.t('gw.title') }}</span>
            <input name="gcTitle" maxlength="250" [value]="title()" (input)="title.set(text($event))" /></label>
          <div class="field"><span>{{ i18n.t('gw.description') }}</span><p class="gc__desc">{{ p.description }}</p></div>
          <p class="gc__hint">{{ i18n.t('gw.previewHint') }}</p>
          @if (p.warning) { <p class="gc__hint">{{ p.warning }}</p> }
          @if (error(); as e) { <p class="gc__note gc__note--bad" role="alert">{{ e }}</p> }
        </form>
      } @else if (error(); as e) {
        <p class="gc__note gc__note--bad" role="alert">{{ e }}</p>
      } @else {
        <p class="gc__hint">{{ i18n.t('gw.loading') }}</p>
      }
      <ng-container app-modal-actions>
        <app-button (pressed)="ref.close()">{{ i18n.t('gw.cancel') }}</app-button>
        <app-button variant="primary" [disabled]="!valid() || busy()" (pressed)="create()">{{ i18n.t(busy() ? 'gw.creating' : 'gw.create') }}</app-button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .gc { display: flex; flex-direction: column; gap: 12px; min-width: min(460px, 80vw); }
    .gc__ic { width: 18px; height: 18px; font-size: 18px; vertical-align: -4px; margin-right: 6px; }
    .gc__row { display: flex; gap: 6px; flex-wrap: wrap; }
    .gc__desc { margin: 0; padding: 8px 10px; max-height: 160px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); font-size: 12.5px; white-space: pre-line; }
    .gc__hint { margin: 0; color: var(--text-muted); font-size: 11.5px; }
    .gc__note { margin: 0; padding: 8px 10px; border-radius: var(--radius-md); font-size: 12.5px; }
    .gc__note--bad { background: var(--status-critical-bg); }
  `,
})
export class GlpiCreateDialogComponent<T = unknown> implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly ref = inject<DialogRef<T>>(DialogRef);
  protected readonly data = inject<GlpiCreateDialogData<T>>(DIALOG_DATA);

  protected readonly preview = signal<GlpiCreatePreview | null>(null);
  protected readonly entity = signal<number | null>(null);
  protected readonly group = signal(0);
  protected readonly type = signal<1 | 2>(1);
  protected readonly title = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => !!this.preview() && !this.preview()!.problem && this.entity() !== null && !!this.title().trim());

  async ngOnInit(): Promise<void> {
    try {
      const p = await this.data.load();
      this.preview.set(p);
      this.entity.set(p.entityId);
      this.group.set(p.groupId ?? 0);
      this.type.set(p.type);
      this.title.set(p.title);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('gw.loadError')));
    }
  }

  protected num(e: Event): number | null {
    const v = (e.target as HTMLSelectElement).value;
    return v === '' ? null : Number(v);
  }

  protected text(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async create(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.ref.close(await this.data.create({ entityId: this.entity()!, groupId: this.group(), type: this.type(), title: this.title().trim() }));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('gw.createError')));
    } finally {
      this.busy.set(false);
    }
  }
}
