import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ComplementSlot, ComplementsService, SlotTarget } from '../../core/complements/complements.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ComplementFrameComponent } from './complement-frame';

import '../../core/i18n/packs/complement-features';

/**
 * «Más acciones» de una ficha (10i): las acciones aprobadas de los
 * complementos para ese tipo de ficha. Cada una abre el complemento en un
 * diálogo con la ficha abierta. Sin acciones no aparece nada.
 */
@Component({
  selector: 'app-complement-actions',
  standalone: true,
  imports: [MatIconModule, ComplementFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (actions().length) {
      <span class="ca-menu">
        <button type="button" [class]="buttonClass()" [attr.aria-expanded]="open()" aria-haspopup="menu" (click)="open.set(!open())">
          <mat-icon>extension</mat-icon>{{ i18n.t('cf.moreActions') }}<mat-icon>expand_more</mat-icon>
        </button>
        @if (open()) {
          <span class="ca-menu__list" role="menu">
            @for (a of actions(); track a.slug + a.key) {
              <button type="button" role="menuitem" class="ca-menu__item" (click)="run(a)"><mat-icon>{{ a.icon }}</mat-icon>{{ a.title }}</button>
            }
          </span>
        }
      </span>
    }
    @if (active(); as a) {
      <div class="ca-dialog" role="presentation" (click)="active.set(null)" (keydown.escape)="active.set(null)">
        <div class="ca-dialog__box" role="dialog" aria-modal="true" [attr.aria-label]="a.title" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="ca-dialog__head">
            <h2 class="ca-dialog__title">{{ a.title }}</h2>
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('cf.close')" (click)="active.set(null)"><mat-icon>close</mat-icon></button>
          </div>
          <app-complement-frame class="ca-dialog__frame" [slug]="a.slug" [slot]="a.key" [objectType]="target()" [objectId]="objectId()" [label]="a.title"
            (changed)="changed.emit()" (closeRequested)="active.set(null)" />
        </div>
      </div>
    }
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ca-menu { position: relative; display: inline-flex; }
    .ca-menu__list {
      position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; display: flex; flex-direction: column; min-width: 240px; padding: 6px 0;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    }
    .ca-menu__item {
      display: flex; align-items: center; gap: 8px; padding: 8px 14px; border: 0; background: transparent; color: var(--text-primary);
      font: inherit; text-align: left; cursor: pointer;
    }
    .ca-menu__item:hover, .ca-menu__item:focus-visible { background: var(--bg-surface-hover); }
    .ca-dialog { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgb(1 4 9 / 0.6); }
    .ca-dialog__box {
      display: flex; flex-direction: column; width: min(720px, 100%); height: min(620px, 100%);
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface);
    }
    .ca-dialog__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .ca-dialog__title { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
    .ca-dialog__frame { flex: 1; }
  `,
})
export class ComplementActionsComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ComplementsService);

  readonly target = input.required<SlotTarget>();
  readonly objectId = input.required<string>();
  /** Clase del botón, para que se vea como los demás de la ficha. */
  readonly buttonClass = input('adm-btn');
  /** Una acción dejó un seguimiento o creó una entrada: la ficha se recarga. */
  readonly changed = output<void>();

  protected readonly actions = computed(() => this.api.slots().actions.filter((a) => a.target === this.target()));
  protected readonly open = signal(false);
  protected readonly active = signal<ComplementSlot | null>(null);

  protected run(a: ComplementSlot): void {
    this.open.set(false);
    this.active.set(a);
  }
}
