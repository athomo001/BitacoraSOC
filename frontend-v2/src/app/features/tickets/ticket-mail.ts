import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TicketDetail, TicketMail, TicketMailStatus, TicketMails, TicketNotifyChange, TicketsService } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/tickets';

const STATUS_LOOK: Record<TicketMailStatus, { icon: string; tone: string }> = {
  sent: { icon: 'check_circle', tone: 'ok' },
  pending: { icon: 'schedule', tone: 'neutral' },
  waiting: { icon: 'hourglass_top', tone: 'info' },
  failed: { icon: 'error', tone: 'bad' },
  no_recipients: { icon: 'block', tone: 'warn' },
};

/**
 * Avisos por correo dentro del ticket (spec/15 §5, canvas "Ticketera: avisos
 * por correo"): "Afecta al cliente", a quién se le avisa (Para/CC, editable
 * solo para este ticket) y los correos enviados con "Reenviar". Con los
 * avisos apagados en Administración → Ticketera no aparece.
 */
@Component({
  selector: 'app-ticket-mail',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mails(); as m) {
      @if (m.mailEnabled) {
        <section class="tm" [attr.aria-label]="i18n.t('tkmail.title')">
          <div class="tm__row"><span class="tm__label">{{ i18n.t('tkmail.title') }}</span></div>
          @if (m.clientEnabled) {
            <label class="tm__affects">
              <input type="checkbox" [checked]="m.affectsClient" [disabled]="busy()" (change)="save({ affectsClient: !m.affectsClient })" />
              <strong>{{ i18n.t('tkmail.affects') }}</strong>
              <span class="tm__muted">· {{ detail().ticket.clientName }}</span>
            </label>
            @if (m.affectsClient) {
              <span class="tm__muted">{{ i18n.t('tkmail.affectsHint') }}</span>
              <div class="tm__to">
                <span class="tm__label">{{ i18n.t('tkmail.notifyTo') }}</span>
                @for (e of m.to; track e) {
                  <span class="tm__chip"><b>{{ i18n.t('tkmail.to') }}</b> <span class="mono">{{ e }}</span>
                    <button type="button" [disabled]="busy()" [attr.aria-label]="i18n.t('tkmail.remove') + ' ' + e" (click)="removeRecipient('to', e)"><mat-icon>close</mat-icon></button>
                  </span>
                }
                @for (e of m.cc; track e) {
                  <span class="tm__chip"><b>{{ i18n.t('tkmail.cc') }}</b> <span class="mono">{{ e }}</span>
                    <button type="button" [disabled]="busy()" [attr.aria-label]="i18n.t('tkmail.remove') + ' ' + e" (click)="removeRecipient('cc', e)"><mat-icon>close</mat-icon></button>
                  </span>
                }
                @if (!m.to.length && !m.cc.length) {
                  <span class="pill tone-warn"><mat-icon>warning</mat-icon>{{ i18n.t('tkmail.none') }}</span>
                }
              </div>
              <div class="tm__add">
                <span class="tm__seg" role="group" [attr.aria-label]="i18n.t('tkmail.notifyTo')">
                  <button type="button" class="seg" [attr.aria-pressed]="addAs() === 'to'" (click)="addAs.set('to')">{{ i18n.t('tkmail.to') }}</button>
                  <button type="button" class="seg" [attr.aria-pressed]="addAs() === 'cc'" (click)="addAs.set('cc')">{{ i18n.t('tkmail.cc') }}</button>
                </span>
                <input class="adm-input" type="email" [placeholder]="i18n.t('tkmail.addPlaceholder')" [attr.aria-label]="i18n.t('tkmail.add')" [ngModel]="newEmail()" (ngModelChange)="newEmail.set($event)" (keydown.enter)="$event.preventDefault(); addRecipient()" />
                <button type="button" class="adm-btn" [disabled]="busy() || !newEmail().trim()" (click)="addRecipient()"><mat-icon>add</mat-icon>{{ i18n.t('tkmail.add') }}</button>
                @if (m.custom) {
                  <span class="pill tone-system">{{ i18n.t('tkmail.custom') }}</span>
                  <button type="button" class="adm-btn" [disabled]="busy()" (click)="save({ reset: true })">{{ i18n.t('tkmail.reset') }}</button>
                }
              </div>
            }
          }
          <span class="tm__label">{{ i18n.t('tkmail.sent') }}</span>
          @for (mail of m.items; track mail.id) {
            <div class="tm__log">
              <span class="mono tm__muted">{{ (mail.sentAt ?? mail.createdAt) | date: 'dd/MM HH:mm' }}</span>
              <span>{{ i18n.t(eventKey(mail.event)) }}</span>
              <span class="tm__muted" [title]="recipientsTitle(mail)">{{ i18n.tf('tkmail.recipients', mail.to.length + mail.cc.length) }}</span>
              <span class="pill" [class]="'pill tone-' + look(mail).tone" [title]="mail.error ?? ''"><mat-icon>{{ look(mail).icon }}</mat-icon>{{ i18n.t(statusKey(mail.status)) }}</span>
              @if (mail.status === 'failed') {
                <button type="button" class="adm-btn" [disabled]="busy()" (click)="retry(mail)">{{ i18n.t('tkmail.retry') }}</button>
              }
            </div>
          } @empty {
            <span class="tm__muted">{{ i18n.t('tkmail.empty') }}</span>
          }
          @if (error(); as e) { <p class="msg msg--error" role="alert">{{ e }}</p> }
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; }
    mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .tm { display: flex; flex-direction: column; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--border-subtle); }
    .tm__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .tm__label { color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .tm__muted { color: var(--text-muted); font-size: 11px; }
    .tm__affects { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .tm__affects input { accent-color: var(--accent); }
    .tm__to, .tm__add { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .tm__add .adm-input { flex: 1; min-width: 180px; }
    .tm__seg { display: inline-flex; gap: 2px; }
    .tm__chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; font-size: 12px; }
    .tm__chip b { color: var(--text-muted); font-size: 10.5px; }
    .tm__chip button { display: inline-grid; place-items: center; width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; }
    .tm__chip button:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
    .tm__log { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; }
  `,
})
export class TicketMailComponent {
  /** El detalle del ticket: cada vez que cambia (un comentario, un estado) se recargan los avisos. */
  readonly detail = input.required<TicketDetail>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);

  protected readonly mails = signal<TicketMails | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly newEmail = signal('');
  protected readonly addAs = signal<'to' | 'cc'>('to');

  constructor() {
    effect(() => {
      const id = this.detail().ticket.id;
      this.detail(); // también al cambiar el contenido del mismo ticket
      void this.load(id);
    });
  }

  protected eventKey(event: string): MessageKey {
    return `tkmail.ev.${event}` as MessageKey;
  }

  protected statusKey(status: TicketMailStatus): MessageKey {
    return `tkmail.st.${status}` as MessageKey;
  }

  protected look(mail: TicketMail): { icon: string; tone: string } {
    return STATUS_LOOK[mail.status];
  }

  protected recipientsTitle(mail: TicketMail): string {
    return [...mail.to, ...mail.cc.map((e) => 'CC ' + e)].join(', ');
  }

  private async load(id: string): Promise<void> {
    try {
      this.mails.set(await this.api.mails(id));
      this.error.set(null);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('tkmail.error')));
    }
  }

  protected async save(change: TicketNotifyChange): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.mails.set(await this.api.setNotify(this.detail().ticket.id, change));
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('tkmail.error')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async addRecipient(): Promise<void> {
    const m = this.mails();
    const email = this.newEmail().trim();
    if (!m || !email) return;
    const to = this.addAs() === 'to' ? [...m.to, email] : m.to;
    const cc = this.addAs() === 'cc' ? [...m.cc, email] : m.cc;
    await this.save({ to, cc });
    if (!this.error()) this.newEmail.set('');
  }

  protected async removeRecipient(kind: 'to' | 'cc', email: string): Promise<void> {
    const m = this.mails();
    if (!m) return;
    await this.save({ to: kind === 'to' ? m.to.filter((e) => e !== email) : m.to, cc: kind === 'cc' ? m.cc.filter((e) => e !== email) : m.cc });
  }

  protected async retry(mail: TicketMail): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.retryMail(this.detail().ticket.id, mail.id);
      await this.load(this.detail().ticket.id);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('tkmail.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
