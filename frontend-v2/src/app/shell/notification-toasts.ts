import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AppNotification, NotificationsService } from '../core/notifications/notifications.service';
import { I18nService } from '../core/i18n/i18n.service';

import '../core/i18n/packs/notifications';

/** Cuánto queda a la vista un aviso emergente. */
const TOAST_MS = 9000;

/**
 * Avisos emergentes (spec/16 §4.5): abajo a la derecha, con la app abierta.
 * No tapan el trabajo, se van solos y nunca bloquean: «Ver» lleva a lo suyo
 * y «Más tarde» lo deja en la campana.
 */
@Component({
  selector: 'app-notification-toasts',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nt" aria-live="polite">
      @for (n of api.toasts().slice(-3); track n.id) {
        <div class="nt__card" role="status">
          <div class="nt__head"><mat-icon>notifications_active</mat-icon><b>{{ n.title }}</b>
            <button type="button" class="nt__x" [attr.aria-label]="i18n.t('nt.close')" (click)="api.dismissToast(n.id)"><mat-icon>close</mat-icon></button></div>
          @if (n.body) { <span class="nt__body">{{ n.body.length > 160 ? n.body.slice(0, 160) + '…' : n.body }}</span> }
          <span class="nt__actions">
            <button type="button" class="adm-btn" (click)="api.dismissToast(n.id)">{{ i18n.t('nt.later') }}</button>
            @if (n.link) { <button type="button" class="adm-btn adm-btn--primary" (click)="see(n)">{{ i18n.t('nt.see') }}</button> }
          </span>
        </div>
      }
    </div>
  `,
  styles: `
    .nt { position: fixed; right: 16px; bottom: 16px; z-index: 950; display: flex; flex-direction: column; gap: 8px; width: 330px; max-width: calc(100vw - 32px); pointer-events: none; }
    .nt__card { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--border-subtle); border-left: 4px solid var(--accent); border-radius: var(--radius-md); background: var(--bg-surface); box-shadow: 0 12px 30px rgb(0 0 0 / 18%); pointer-events: auto; }
    .nt__head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
    .nt__head mat-icon { width: 18px; height: 18px; font-size: 18px; color: var(--accent); }
    .nt__x { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-left: auto; padding: 0; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
    .nt__x mat-icon { width: 15px; height: 15px; font-size: 15px; color: inherit; }
    .nt__body { color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
    .nt__actions { display: flex; justify-content: flex-end; gap: 6px; }
  `,
})
export class NotificationToastsComponent {
  protected readonly api = inject(NotificationsService);
  protected readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    // Cada aviso nuevo se va solo pasado un rato.
    effect(() => {
      for (const n of this.api.toasts()) {
        if (!this.timers.has(n.id)) {
          this.timers.set(n.id, setTimeout(() => {
            this.timers.delete(n.id);
            this.api.dismissToast(n.id);
          }, TOAST_MS));
        }
      }
    });
    inject(DestroyRef).onDestroy(() => this.timers.forEach((t) => clearTimeout(t)));
  }

  protected async see(n: AppNotification): Promise<void> {
    this.api.dismissToast(n.id);
    await this.api.markRead([n.id]);
    void this.router.navigateByUrl(n.link);
  }
}
