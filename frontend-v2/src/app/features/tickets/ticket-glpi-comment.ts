import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TicketsService } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/glpi';

/**
 * Comentar un ticket de GLPI desde la app (10d.2, spec/18 §4.3): sale como
 * seguimiento, privado salvo que se marque «Visible para el solicitante».
 */
@Component({
  selector: 'app-ticket-glpi-comment',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="gx" (submit)="$event.preventDefault(); send()">
      <textarea name="glpiComment" [placeholder]="i18n.t('gw.comment.placeholder')" [attr.aria-label]="i18n.t('gw.comment.placeholder')"
        [value]="text()" (input)="text.set(val($event))" (keydown.control.enter)="send()"></textarea>
      <div class="gx__row">
        <label class="gx__check"><input type="checkbox" name="glpiPublic" [checked]="visible()" (change)="visible.set(!visible())" />{{ i18n.t('gw.comment.public') }}</label>
        <span class="gx__hint">{{ i18n.t(visible() ? 'gw.comment.hintPublic' : 'gw.comment.hintPrivate') }}</span>
        <button type="submit" class="gx__btn" [disabled]="busy() || !text().trim()"><mat-icon>send</mat-icon>{{ i18n.t('gw.comment.submit') }}</button>
      </div>
      @if (error(); as e) { <p class="gx__error" role="alert">{{ e }}</p> }
    </form>
  `,
  styles: `
    .gx { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border-subtle); }
    textarea { min-height: 64px; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); font: inherit; font-size: 13px; resize: vertical; }
    .gx__row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .gx__check { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; }
    .gx__hint { color: var(--text-muted); font-size: 11.5px; }
    .gx__btn { display: inline-flex; gap: 6px; align-items: center; margin-left: auto; padding: 6px 12px; border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--accent-contrast); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .gx__btn:disabled { opacity: 0.5; cursor: default; }
    .gx__error { margin: 0; color: var(--status-critical); font-size: 12px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
  `,
})
export class TicketGlpiCommentComponent {
  readonly ticketId = input.required<string>();
  readonly sent = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);

  protected readonly text = signal('');
  protected readonly visible = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected val(e: Event): string {
    return (e.target as HTMLTextAreaElement).value;
  }

  protected async send(): Promise<void> {
    const content = this.text().trim();
    if (!content || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.addComment(this.ticketId(), content, this.visible());
      this.text.set('');
      this.visible.set(false);
      this.sent.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('gw.comment.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
