import { ChangeDetectionStrategy, Component, HostListener, computed, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AppNotification, NotificationsService } from '../core/notifications/notifications.service';
import { I18nService } from '../core/i18n/i18n.service';
import { PreferencesService } from '../core/preferences/preferences.service';
import { MarkdownComponent } from '../shared/markdown/markdown';

import '../core/i18n/packs/notifications';

const KIND_ICON: Record<string, string> = {
  'agenda.assigned': 'assignment_ind', 'agenda.warn': 'event', 'agenda.due': 'event', 'agenda.late': 'priority_high',
  'agenda.handover': 'swap_horiz', 'agenda.absence': 'person_off', 'ticket.assigned': 'confirmation_number',
  'ticket.derived': 'call_split', 'ticket.comment': 'chat', 'inventory.request': 'inbox', 'glpi.import': 'cloud_off', window: 'engineering', notice: 'campaign',
};
const KIND_TONE: Record<string, string> = {
  'agenda.late': 'tone-bad', 'agenda.due': 'tone-warn', 'agenda.warn': 'tone-warn', window: 'tone-warn', notice: 'tone-system',
  'ticket.assigned': 'tone-info', 'ticket.derived': 'tone-info', 'agenda.assigned': 'tone-accent',
};

/**
 * La campana (spec/16 §4.5, diseño aprobado 2026-10-15): en la barra
 * lateral junto al nombre, con el número de no leídas en vivo. Abre un panel
 * con lo de hoy y lo de antes; cada aviso lleva a lo suyo. Los avisos con
 * acuse quedan aquí para volver a leerlos.
 */
@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="nb__btn" [class.nb__btn--on]="open()" [attr.aria-expanded]="open()"
      [attr.aria-label]="api.unread() ? i18n.tf('nt.bellCount', api.unread()) : i18n.t('nt.bell')" [attr.title]="i18n.t('nt.bell')" (click)="toggle()">
      <mat-icon>notifications</mat-icon>
      @if (api.unread()) { <span class="nb__badge mono">{{ api.unread() > 99 ? '99+' : api.unread() }}</span> }
    </button>
    @if (open()) {
      <section class="nb__drawer" role="dialog" [attr.aria-label]="i18n.t('nt.bell')">
        <header class="nb__head">
          <h2 class="nb__title"><mat-icon>notifications</mat-icon>{{ i18n.t('nt.bell') }}</h2>
          <button type="button" class="nb__icon" [attr.aria-label]="i18n.t('nt.prefs')" [attr.title]="i18n.t('nt.prefs')" (click)="openPrefs.emit(); open.set(false)"><mat-icon>tune</mat-icon></button>
          <button type="button" class="nb__icon" [attr.aria-label]="i18n.t('nt.close')" (click)="open.set(false)"><mat-icon>close</mat-icon></button>
        </header>
        <div class="nb__bar">
          <button type="button" class="seg" [attr.aria-pressed]="filter() === 'unread'" (click)="filter.set('unread')">{{ i18n.t('nt.unread') }} <span class="mono">{{ api.unread() }}</span></button>
          <button type="button" class="seg" [attr.aria-pressed]="filter() === 'all'" (click)="filter.set('all')">{{ i18n.t('nt.all') }}</button>
          <button type="button" class="adm-btn nb__readall" [disabled]="!api.unread()" (click)="readAll()">{{ i18n.t('nt.readAll') }}</button>
        </div>
        <div class="nb__list">
          @for (g of groups(); track g.key) {
            <div class="nb__grp">{{ i18n.t(g.key === 'today' ? 'nt.today' : 'nt.earlier') }}</div>
            @for (n of g.items; track n.id) {
              <button type="button" class="nb__item" [class.nb__item--unread]="!n.readAt" (click)="openItem(n)">
                <span class="nb__ic {{ tone(n.kind) }}"><mat-icon>{{ icon(n.kind) }}</mat-icon></span>
                <span class="nb__text">
                  <span class="nb__t">{{ n.title }}</span>
                  @if (n.kind === 'notice' && expanded() === n.id) {
                    <app-markdown class="app-markdown--compact" [content]="n.body" />
                  } @else if (n.body) {
                    <span class="nb__s">{{ n.body.length > 140 ? n.body.slice(0, 140) + '…' : n.body }}</span>
                  }
                </span>
                <span class="nb__when mono">{{ when(n) }}</span>
              </button>
            }
          } @empty {
            <p class="nb__empty"><mat-icon>done_all</mat-icon>{{ i18n.t('nt.empty') }}</p>
          }
        </div>
        @if (api.canSendNotices()) {
          <footer class="nb__foot">
            <button type="button" class="adm-btn" (click)="go('/notices')"><mat-icon>campaign</mat-icon>{{ i18n.t('nt.sendNotice') }}</button>
          </footer>
        }
      </section>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .nb__btn { position: relative; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .nb__btn mat-icon { width: 19px; height: 19px; font-size: 19px; }
    .nb__btn:hover, .nb__btn--on { background: var(--bg-surface-hover); color: var(--text-primary); }
    .nb__btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .nb__badge { position: absolute; top: -2px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--status-critical); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
    .nb__drawer { position: fixed; top: 0; bottom: 0; left: 224px; z-index: 900; display: flex; flex-direction: column; width: 380px; max-width: calc(100vw - 224px); border-right: 1px solid var(--border-subtle); background: var(--bg-surface); box-shadow: 8px 0 24px rgb(0 0 0 / 12%); }
    .nb__head { display: flex; align-items: center; gap: 4px; padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); }
    .nb__title { display: inline-flex; flex: 1; align-items: center; gap: 6px; margin: 0; font-size: 14px; font-weight: 600; }
    .nb__icon { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .nb__icon:hover { background: var(--bg-surface-hover); }
    .nb__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); }
    .nb__readall { margin-left: auto; }
    .nb__list { flex: 1; overflow: auto; }
    .nb__grp { padding: 8px 14px 4px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .nb__item { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; width: 100%; padding: 10px 14px; border: none; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .nb__item:hover { background: var(--bg-surface-hover); }
    .nb__item--unread { background: var(--accent-soft); }
    .nb__item--unread .nb__t { font-weight: 600; }
    .nb__ic { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; }
    .nb__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .nb__t { font-size: 12.5px; }
    .nb__s { color: var(--text-muted); font-size: 11.5px; overflow-wrap: anywhere; }
    .nb__when { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
    .nb__empty { display: flex; align-items: center; gap: 8px; margin: 0; padding: 18px 16px; color: var(--text-secondary); }
    .nb__foot { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border-subtle); }
    @media (width <= 900px) {
      .nb__drawer { left: 56px; max-width: calc(100vw - 56px); }
    }
  `,
})
export class NotificationsBellComponent {
  protected readonly api = inject(NotificationsService);
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly router = inject(Router);

  readonly openPrefs = output<void>();
  protected readonly open = signal(false);
  protected readonly filter = signal<'unread' | 'all'>('unread');
  protected readonly expanded = signal<string | null>(null);

  protected readonly groups = computed(() => {
    const list = this.api.items().filter((n) => this.filter() === 'all' || !n.readAt);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = list.filter((n) => new Date(n.updatedAt) >= start);
    const earlier = list.filter((n) => new Date(n.updatedAt) < start);
    return [{ key: 'today', items: today }, { key: 'earlier', items: earlier }].filter((g) => g.items.length);
  });

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }

  protected toggle(): void {
    this.open.set(!this.open());
    if (this.open()) void this.api.refresh(false);
  }

  protected icon(kind: string): string {
    return KIND_ICON[kind] ?? 'notifications';
  }

  protected tone(kind: string): string {
    return KIND_TONE[kind] ?? 'tone-neutral';
  }

  protected when(n: AppNotification): string {
    const d = new Date(n.updatedAt);
    const lang = this.prefs.language() === 'en' ? 'en-US' : 'es-CL';
    const sameDay = d.toDateString() === new Date().toDateString();
    return new Intl.DateTimeFormat(lang, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(d);
  }

  protected async openItem(n: AppNotification): Promise<void> {
    if (!n.readAt) await this.api.markRead([n.id]);
    if (n.kind === 'notice' || !n.link) {
      this.expanded.set(this.expanded() === n.id ? null : n.id);
      return;
    }
    this.go(n.link);
  }

  protected go(link: string): void {
    this.open.set(false);
    void this.router.navigateByUrl(link);
  }

  protected readAll(): void {
    void this.api.markRead([]);
  }
}
