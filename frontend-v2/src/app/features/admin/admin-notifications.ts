import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NotifSettings, NotificationsService } from '../../core/notifications/notifications.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/notifications';
import '../../core/i18n/packs/ldap';

/**
 * Administración → Notificaciones (spec/16 §4.5, decisiones del dueño
 * 2026-10-15): la hora del resumen diario (08:00), lo que nadie puede apagar
 * (atrasos y avisos con acuse), cada cuánto se agrupan los avisos iguales y
 * cuántos días guarda la campana (90).
 */
@Component({
  selector: 'app-admin-notifications',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.notifications') }}</h2>
        <p class="adm-muted">{{ i18n.t('ntAdmin.subtitle') }}</p>
      </div>
    </header>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
    @if (s(); as st) {
      <section class="adm-card">
        <div class="adm-card__body an__body">
          <div class="adm-row">
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ntAdmin.digest') }}</span>
              <input class="adm-input mono" type="time" name="digestTime" [value]="st.digestTime" (change)="patch({ digestTime: val($event) })" />
              <span class="adm-hint">{{ i18n.t('ntAdmin.digestHint') }}</span></label>
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ntAdmin.group') }}</span>
              <input class="adm-input mono" type="number" min="0" max="240" name="groupMinutes" [value]="st.groupMinutes" (change)="patch({ groupMinutes: num($event) })" />
              <span class="adm-hint">{{ i18n.t('ntAdmin.groupHint') }}</span></label>
            <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('ntAdmin.retention') }}</span>
              <input class="adm-input mono" type="number" min="7" max="730" name="retentionDays" [value]="st.retentionDays" (change)="patch({ retentionDays: num($event) })" /></label>
          </div>
          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('ntAdmin.locked') }}</span>
            <div class="an__chips">
              @for (k of st.kinds; track k.kind) {
                @if (k.toastAllowed || k.emailAllowed || k.kind === 'notice') {
                  <button type="button" class="seg" [attr.aria-pressed]="st.lockedKinds.includes(k.kind)" [disabled]="k.kind === 'notice'" (click)="toggleLock(k.kind)">{{ i18n.t(kindKey(k.kind)) }}</button>
                }
              }
            </div>
            <span class="adm-hint">{{ i18n.t('ntAdmin.lockedHint') }}</span>
          </div>
          <p class="adm-hint">{{ i18n.t('ntAdmin.noticesHint') }}</p>
          <div class="an__actions">
            @if (notice(); as n) { <span class="pill tone-ok" role="status">{{ n }}</span> }
            <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('ntAdmin.save') }}</button>
          </div>
        </div>
      </section>
    }
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .an__body { display: flex; flex-direction: column; gap: 14px; }
    .an__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .an__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  `,
})
export class AdminNotificationsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(NotificationsService);

  protected readonly s = signal<NotifSettings | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.s.set(await this.api.settings());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.loadError')));
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected num(e: Event): number {
    return Math.round(Number(this.val(e))) || 0;
  }

  protected kindKey(kind: string): MessageKey {
    return `nt.kind.${kind}` as MessageKey;
  }

  protected patch(p: Partial<NotifSettings>): void {
    this.s.update((s) => s && { ...s, ...p });
    this.notice.set(null);
  }

  protected toggleLock(kind: string): void {
    const cur = this.s()?.lockedKinds ?? [];
    this.patch({ lockedKinds: cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind] });
  }

  protected async save(): Promise<void> {
    const s = this.s();
    if (!s || this.busy()) return;
    this.busy.set(true);
    try {
      this.s.set(await this.api.saveSettings({ digestTime: s.digestTime, lockedKinds: s.lockedKinds, groupMinutes: s.groupMinutes, retentionDays: s.retentionDays }));
      this.notice.set(this.i18n.t('ntAdmin.saved'));
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
