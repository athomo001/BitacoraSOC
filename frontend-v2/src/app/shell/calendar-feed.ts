import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { CalendarFeed, CalendarFeedService } from '../core/calendar/calendar-feed.service';
import { I18nService } from '../core/i18n/i18n.service';
import { MessageKey } from '../core/i18n/messages';
import { PreferencesService } from '../core/preferences/preferences.service';
import { problemDetail } from '../core/http-error';
import '../core/i18n/packs/notifications';

type Client = 'web' | 'desk' | 'google';
const STEPS: Record<Client, MessageKey[]> = {
  web: ['nt.cal.web1', 'nt.cal.web2', 'nt.cal.web3'],
  desk: ['nt.cal.desk1', 'nt.cal.desk2', 'nt.cal.desk3'],
  google: ['nt.cal.g1', 'nt.cal.g2', 'nt.cal.g3'],
};

/**
 * Perfil → Calendario (spec/16 §6.1, 9.7, diseño aprobado por el dueño
 * 2026-10-15): el enlace secreto propio para ver los vencimientos de la
 * Agenda en Outlook o Google Calendar. Solo lectura y solo lo que está a
 * nombre de la persona. «Generar uno nuevo» deja inútil el anterior.
 */
@Component({
  selector: 'app-calendar-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cf">
      @if (feed(); as f) {
        <p class="cf__lead">{{ i18n.t('nt.cal.lead') }}</p>
        <div class="field">
          <span>{{ i18n.t('nt.cal.link') }}</span>
          <span class="cf__url">
            <input class="mono" readonly name="calendarUrl" [value]="f.url" (focus)="select($event)" [attr.aria-label]="i18n.t('nt.cal.link')" />
            <button type="button" class="cf__btn" (click)="copy(f.url)">
              <span class="material-icons" aria-hidden="true">{{ copied() ? 'check' : 'content_copy' }}</span>{{ i18n.t(copied() ? 'nt.cal.copied' : 'nt.cal.copy') }}
            </button>
          </span>
          <small class="cf__hint">{{ i18n.t('nt.cal.secret') }}</small>
        </div>
        <button type="button" class="cf__switch" role="switch" [attr.aria-checked]="f.includeWindows" [disabled]="busy()" (click)="toggleWindows(f)">
          <span class="cf__track" [class.cf__track--on]="f.includeWindows"><span></span></span>{{ i18n.t('nt.cal.windows') }}
        </button>
        <span class="cf__meta">{{ i18n.tf('nt.cal.created', when(f.createdAt)) }} · {{ f.lastReadAt ? i18n.tf('nt.cal.lastRead', when(f.lastReadAt)) : i18n.t('nt.cal.neverRead') }}</span>
        <div class="cf__row">
          @if (confirmNew()) {
            <span class="cf__hint">{{ i18n.t('nt.cal.newConfirm') }}</span>
            <button type="button" class="cf__btn" [disabled]="busy()" (click)="create()">{{ i18n.t('nt.cal.newYes') }}</button>
            <button type="button" class="cf__btn" (click)="confirmNew.set(false)">{{ i18n.t('profile.cancel') }}</button>
          } @else {
            <button type="button" class="cf__btn" [disabled]="busy()" (click)="remove()"><span class="material-icons" aria-hidden="true">link_off</span>{{ i18n.t('nt.cal.off') }}</button>
            <button type="button" class="cf__btn" [disabled]="busy()" (click)="confirmNew.set(true)"><span class="material-icons" aria-hidden="true">autorenew</span>{{ i18n.t('nt.cal.new') }}</button>
          }
        </div>
        <div class="cf__how">
          <span class="cf__seg">
            @for (c of clients; track c.id) {
              <button type="button" class="seg" [attr.aria-pressed]="client() === c.id" (click)="client.set(c.id)">{{ i18n.t(c.label) }}</button>
            }
          </span>
          <ol class="cf__steps">
            @for (s of steps(); track s) { <li>{{ i18n.t(s) }}</li> }
          </ol>
          <small class="cf__hint">{{ i18n.t('nt.cal.refresh') }}</small>
        </div>
      } @else if (loaded()) {
        <p class="cf__lead">{{ i18n.t('nt.cal.offLead') }}</p>
        <div class="cf__row"><button type="button" class="cf__btn cf__btn--primary" [disabled]="busy()" (click)="create()">
          <span class="material-icons" aria-hidden="true">add_link</span>{{ i18n.t('nt.cal.create') }}</button></div>
      }
      @if (error(); as e) { <span class="msg msg--error">{{ e }}</span> }
    </div>
  `,
  styles: `
    .cf { display: flex; flex-direction: column; gap: 12px; }
    .cf__lead { margin: 0; color: var(--text-secondary); font-size: 12.5px; }
    .cf__url { display: flex; gap: 6px; }
    .cf__url input { flex: 1; min-width: 0; }
    .cf__hint, .cf__meta { color: var(--text-muted); font-size: 11.5px; }
    .cf__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .cf__btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .cf__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--accent-contrast); }
    .cf__btn .material-icons { font-size: 15px; }
    .cf__switch { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
    .cf__track { position: relative; width: 30px; height: 16px; border-radius: 999px; background: var(--border-subtle); }
    .cf__track span { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg-surface); transition: left 0.15s; }
    .cf__track--on { background: var(--accent); }
    .cf__track--on span { left: 16px; }
    .cf__how { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border-subtle); }
    .cf__seg { display: flex; flex-wrap: wrap; gap: 6px; }
    .cf__steps { display: flex; flex-direction: column; gap: 4px; margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 12.5px; }
    @media (prefers-reduced-motion: reduce) { .cf__track span { transition: none; } }
  `,
})
export class CalendarFeedComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(CalendarFeedService);

  /** El estado que ya leyó el Perfil para decidir si muestra la pestaña. */
  readonly initial = input<CalendarFeed | null>(null);

  protected readonly clients: readonly { id: Client; label: MessageKey }[] = [
    { id: 'web', label: 'nt.cal.outlookWeb' },
    { id: 'desk', label: 'nt.cal.outlookDesk' },
    { id: 'google', label: 'nt.cal.google' },
  ];
  protected readonly feed = signal<CalendarFeed | null>(null);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);
  protected readonly confirmNew = signal(false);
  protected readonly client = signal<Client>('web');
  protected readonly error = signal<string | null>(null);

  protected steps(): MessageKey[] {
    return STEPS[this.client()];
  }

  ngOnInit(): void {
    this.feed.set(this.initial());
    this.loaded.set(true);
  }

  protected when(iso: string): string {
    return new Intl.DateTimeFormat(this.prefs.language() === 'en' ? 'en-US' : 'es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  }

  protected select(e: Event): void {
    (e.target as HTMLInputElement).select();
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      // Sin portapapeles: el enlace queda seleccionable para copiarlo a mano.
    }
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.cal.error')));
    } finally {
      this.busy.set(false);
    }
  }

  protected create(): Promise<void> {
    return this.run(async () => {
      this.feed.set(await this.api.create());
      this.copied.set(false);
      this.confirmNew.set(false);
    });
  }

  protected toggleWindows(f: CalendarFeed): Promise<void> {
    return this.run(async () => this.feed.set(await this.api.setWindows(!f.includeWindows)));
  }

  protected remove(): Promise<void> {
    return this.run(async () => {
      await this.api.remove();
      this.feed.set(null);
    });
  }
}
