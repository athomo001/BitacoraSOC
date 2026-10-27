import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NotifPrefs, NotificationsService } from '../core/notifications/notifications.service';
import { I18nService } from '../core/i18n/i18n.service';
import { MessageKey } from '../core/i18n/messages';
import { problemDetail } from '../core/http-error';

import '../core/i18n/packs/notifications';
import '../core/i18n/packs/ldap';

/**
 * Mi perfil → Notificaciones (spec/16 §4.5): cada persona elige qué le llega
 * como aviso emergente y por correo, el resumen diario y las notificaciones
 * del navegador. Lo que el admin fijó sale con candado y no se apaga.
 */
@Component({
  selector: 'app-notification-prefs',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (p(); as prefs) {
      <div class="np">
        <div class="np__row np__row--head"><span>{{ i18n.t('nt.prefs.what') }}</span><span>{{ i18n.t('nt.prefs.toast') }}</span><span>{{ i18n.t('nt.prefs.email') }}</span></div>
        @for (k of prefs.kinds; track k.kind) {
          <div class="np__row">
            <span>{{ i18n.t(kindKey(k.kind)) }}
              @if (k.locked) { <mat-icon class="np__lock" [attr.title]="i18n.t('nt.prefs.locked')" [attr.aria-label]="i18n.t('nt.prefs.locked')">lock</mat-icon> }</span>
            <span>@if (k.toastAllowed) { <input type="checkbox" [attr.aria-label]="i18n.t('nt.prefs.toast')" [checked]="!!k.myToast" [disabled]="k.locked" (change)="set(k.kind, 'myToast')" /> } @else { — }</span>
            <span>@if (k.emailAllowed) { <input type="checkbox" [attr.aria-label]="i18n.t('nt.prefs.email')" [checked]="!!k.myEmail" [disabled]="k.locked" (change)="set(k.kind, 'myEmail')" /> } @else { — }</span>
          </div>
        }
        <label class="np__switch"><input type="checkbox" [checked]="prefs.digest" (change)="toggleDigest()" />
          <span><b>{{ i18n.t('nt.prefs.digest') }}</b> <span class="np__hint">{{ i18n.tf('nt.prefs.digestHint', prefs.digestTime) }}</span></span></label>
        <label class="np__switch"><input type="checkbox" [checked]="prefs.browser" (change)="toggleBrowser()" />
          <span><b>{{ i18n.t('nt.prefs.browser') }}</b> <span class="np__hint">{{ denied() ? i18n.t('nt.prefs.browserDenied') : i18n.t('nt.prefs.browserHint') }}</span></span></label>
        <p class="np__hint">{{ i18n.t('nt.prefs.bellAlways') }}</p>
        <div class="np__foot">
          @if (msg(); as m) { <span class="np__msg" role="status">{{ m }}</span> }
          <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('nt.prefs.save') }}</button>
        </div>
      </div>
    } @else if (error(); as e) {
      <p class="adm-error" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .np { display: flex; flex-direction: column; gap: 4px; }
    .np__row { display: grid; grid-template-columns: minmax(0, 1fr) 80px 80px; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12.5px; }
    .np__row > span:not(:first-child) { text-align: center; }
    .np__row--head { color: var(--text-muted); font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .np__lock { width: 13px; height: 13px; font-size: 13px; color: var(--text-muted); vertical-align: -2px; }
    .np__switch { display: flex; align-items: flex-start; gap: 8px; padding-top: 10px; font-size: 12.5px; }
    .np__hint { color: var(--text-muted); font-size: 11.5px; }
    .np__foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 10px; }
    .np__msg { color: var(--status-ok); font-size: 12px; }
  `,
})
export class NotificationPrefsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(NotificationsService);

  protected readonly p = signal<NotifPrefs | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly msg = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly denied = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.p.set(await this.api.prefs());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.loadError')));
    }
  }

  protected kindKey(kind: string): MessageKey {
    return `nt.kind.${kind}` as MessageKey;
  }

  protected set(kind: string, field: 'myToast' | 'myEmail'): void {
    this.p.update((p) => p && { ...p, kinds: p.kinds.map((k) => (k.kind === kind ? { ...k, [field]: !k[field] } : k)) });
    this.msg.set(null);
  }

  protected toggleDigest(): void {
    this.p.update((p) => p && { ...p, digest: !p.digest });
    this.msg.set(null);
  }

  protected async toggleBrowser(): Promise<void> {
    const p = this.p();
    if (!p) return;
    if (!p.browser) {
      const ok = await this.api.askBrowserPermission();
      this.denied.set(!ok);
      if (!ok) return;
    }
    this.p.set({ ...p, browser: !p.browser });
    this.msg.set(null);
  }

  protected async save(): Promise<void> {
    const p = this.p();
    if (!p || this.busy()) return;
    this.busy.set(true);
    const kinds: Record<string, { toast?: boolean; email?: boolean }> = {};
    for (const k of p.kinds) {
      if (!k.locked) kinds[k.kind] = { toast: k.myToast, email: k.myEmail };
    }
    try {
      this.p.set(await this.api.savePrefs(kinds, p.digest, p.browser));
      this.msg.set(this.i18n.t('nt.prefs.saved'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
