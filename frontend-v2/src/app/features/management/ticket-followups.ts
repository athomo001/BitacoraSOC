import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ManagementService, TicketAction } from '../../core/management/management.service';
import { Ticket } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { day, kindKey } from './mgmt-format';
import { ActionDialogComponent, ActionDialogData } from './action-dialog';

import '../../core/i18n/packs/management';

/**
 * Acciones de seguimiento en el panel del ticket (spec/16 §4.4.7): «Desde un
 * ticket» ya no es pestaña de Gestión; la acción sale de aquí y el panel
 * muestra las que ya hay. Solo para quien ve Gestión.
 */
@Component({
  selector: 'app-ticket-followups',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tf" [attr.aria-label]="i18n.t('mg.tp.title')">
      <div class="tf__head">
        <span class="tf__title">{{ i18n.t('mg.tp.title') }}</span>
        <button type="button" class="adm-btn tf__push" (click)="create()"><mat-icon>add_task</mat-icon>{{ i18n.t('mg.tp.new') }}</button>
      </div>
      @for (a of actions(); track a.occurrenceId) {
        <div class="tf__row">
          <mat-icon [class]="a.status === 'done' ? 'text-ok' : a.late ? 'text-bad' : 'text-neutral'">{{ a.status === 'done' ? 'task_alt' : a.late ? 'event_busy' : 'event' }}</mat-icon>
          <span class="tf__name">{{ a.name }}<span class="adm-hint tf__sub">{{ a.who }}@if (a.kind) { · {{ i18n.t(kindKey(a.kind)) }} }</span></span>
          <span class="adm-hint mono" [class.text-bad]="a.late">{{ date(a.due) }}</span>
        </div>
      } @empty {
        <p class="adm-hint tf__none">{{ i18n.t('mg.tp.none') }}</p>
      }
    </section>
  `,
  styles: `
    .tf { display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; border-top: 1px solid var(--border-subtle); }
    .tf__head { display: flex; align-items: center; gap: 8px; }
    .tf__title { color: var(--text-muted); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .tf__push { margin-left: auto; }
    .tf__row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12.5px; }
    .tf__name { min-width: 0; }
    .tf__sub { display: block; }
    .tf__none { margin: 0; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
  `,
})
export class TicketFollowupsComponent {
  readonly ticket = input.required<Ticket>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly prefs = inject(PreferencesService);
  private readonly dialog = inject(Dialog);

  protected readonly kindKey = kindKey;
  protected readonly actions = signal<TicketAction[]>([]);

  constructor() {
    effect(() => void this.load(this.ticket().id));
  }

  private async load(id: string): Promise<void> {
    try {
      const list = await this.api.ticketActions(id);
      if (id === this.ticket().id) this.actions.set(list);
    } catch {
      this.actions.set([]);
    }
  }

  protected date(iso: string): string {
    return day(iso, this.prefs.language());
  }

  protected create(): void {
    const t = this.ticket();
    const data: ActionDialogData = { client: { id: t.clientId, name: t.clientName }, ticket: { id: t.id, number: t.ticketNumber } };
    this.dialog.open<boolean>(ActionDialogComponent, { data, ariaLabel: this.i18n.t('mg.act.follow') }).closed.subscribe((ok) => ok && void this.load(t.id));
  }
}
