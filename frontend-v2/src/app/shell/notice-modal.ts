import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../core/notifications/notifications.service';
import { I18nService } from '../core/i18n/i18n.service';
import { MarkdownComponent } from '../shared/markdown/markdown';

import '../core/i18n/packs/notifications';

/**
 * Aviso con acuse de lectura (spec/16 §4.5.1): ventana al centro que solo se
 * cierra con «Leído». Varios pendientes salen uno tras otro, el más antiguo
 * primero. Se pone encima de la pantalla sin tocarla: lo que se estaba
 * escribiendo sigue ahí al cerrarla.
 */
@Component({
  selector: 'app-notice-modal',
  standalone: true,
  imports: [MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (current(); as n) {
      <div class="nm" role="presentation">
        <section #box class="nm__box" role="alertdialog" aria-modal="true" [attr.aria-labelledby]="'nm-title-' + n.id" tabindex="-1">
          <header class="nm__head">
            <mat-icon>campaign</mat-icon>
            <h2 class="nm__title" [id]="'nm-title-' + n.id">{{ n.title }}</h2>
            @if (total() > 1) { <span class="nm__count mono">{{ 1 }} / {{ total() }}</span> }
          </header>
          <div class="nm__body">
            <app-markdown [content]="n.body" />
            <span class="nm__from">{{ i18n.tf('nt.ack.from', n.createdByName || '—') }}</span>
          </div>
          <footer class="nm__foot">
            <span class="nm__hint">{{ i18n.t('nt.ack.keep') }}</span>
            <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy()" (click)="read(n.id)"><mat-icon>done</mat-icon>{{ i18n.t('nt.ack.read') }}</button>
          </footer>
        </section>
      </div>
    }
  `,
  styles: `
    .nm { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: rgb(15 20 25 / 45%); }
    .nm__box { display: flex; flex-direction: column; width: 520px; max-width: 100%; max-height: calc(100vh - 32px); border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-surface); box-shadow: 0 24px 48px rgb(0 0 0 / 25%); outline: none; }
    .nm__head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .nm__head mat-icon { color: var(--status-system); }
    .nm__title { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
    .nm__count { color: var(--text-muted); font-size: 12px; }
    .nm__body { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; overflow: auto; font-size: 13px; }
    .nm__from { color: var(--text-muted); font-size: 12px; }
    .nm__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border-subtle); }
    .nm__hint { color: var(--text-muted); font-size: 11.5px; }
  `,
})
export class NoticeModalComponent {
  protected readonly api = inject(NotificationsService);
  protected readonly i18n = inject(I18nService);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  protected readonly busy = signal(false);

  protected readonly current = computed(() => this.api.pendingNotices()[0] ?? null);
  protected readonly total = computed(() => this.api.pendingNotices().length);

  constructor() {
    // El foco va a la ventana para que el teclado no siga en la pantalla de atrás.
    effect(() => {
      if (this.current()) setTimeout(() => this.box()?.nativeElement.focus());
    });
  }

  protected async read(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.readNotice(id);
    } finally {
      this.busy.set(false);
    }
  }
}
