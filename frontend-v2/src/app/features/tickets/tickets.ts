import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { SseService } from '../../core/sse/sse.service';
import { QueueSummary, SlaClock, Ticket, TicketFilters, TicketType, TicketsService } from '../../core/tickets/tickets.service';
import { CLOCK_TONE, PRIORITY_SHORT, PRIORITY_TONE, STATUS_TONE, clockText } from '../../core/tickets/ticket-view';
import { TicketDetailComponent } from './ticket-detail';

/**
 * Ticketera (/tickets, Fase 10) según el diseño aprobado: resumen de la cola
 * arriba, filtros de un clic, tabla densa con prioridad/estado como pastillas
 * del semáforo y barra de SLA, y el detalle fijo a la derecha. Solo existe
 * con `native_tickets` activo (el backend responde 403 si no).
 */
@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [FormsModule, MatIconModule, TicketDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tickets.html',
  styleUrl: './tickets.css',
})
export class TicketsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);
  private readonly sse = inject(SseService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly summary = signal<QueueSummary>({ open: 0, breached: 0, paused: 0, resolvedToday: 0 });
  protected readonly selectedId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly typeFilter = signal<TicketType | null>(null);
  protected readonly openOnly = signal(false);
  protected query = '';

  protected readonly priorityShort = PRIORITY_SHORT;
  protected readonly priorityTone = PRIORITY_TONE;
  protected readonly statusTone = STATUS_TONE;

  async ngOnInit(): Promise<void> {
    await this.load();
    // Otro analista cambió un ticket: la cola se refresca sola.
    const stop = this.sse.connect((eventType) => {
      if (eventType.startsWith('ticket.')) void this.load();
    });
    this.destroyRef.onDestroy(stop);
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    const filters: TicketFilters = { ticketType: this.typeFilter() ?? undefined, openOnly: this.openOnly(), q: this.query };
    try {
      const result = await this.api.list(filters);
      this.tickets.set(result.items);
      this.summary.set(result.summary);
      if (!this.selectedId() && result.items.length > 0) this.selectedId.set(result.items[0].id);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('tickets.error.load')));
    } finally {
      this.loading.set(false);
    }
  }

  protected setType(type: TicketType | null): void {
    this.typeFilter.set(type);
    void this.load();
  }

  protected toggleOpenOnly(): void {
    this.openOnly.update((on) => !on);
    void this.load();
  }

  protected onChanged(updated: Ticket): void {
    this.tickets.update((list) => list.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    void this.load(); // el resumen de la cola también cambia
  }

  protected async openNew(): Promise<void> {
    const [{ Dialog }, { NewTicketDialogComponent }] = await Promise.all([import('@angular/cdk/dialog'), import('./new-ticket-dialog')]);
    const ref = this.injector.get(Dialog).open<string | undefined>(NewTicketDialogComponent, { ariaLabel: this.i18n.t('tickets.newDialog.title') });
    ref.closed.subscribe((id) => {
      if (!id) return;
      this.selectedId.set(id);
      void this.load();
    });
  }

  protected typeKey(t: Ticket): MessageKey {
    return `tickets.type.${t.ticketType}` as MessageKey;
  }

  protected statusKey(t: Ticket): MessageKey {
    return `tickets.status.${t.status}` as MessageKey;
  }

  protected slaLabel(clock: SlaClock | undefined): string {
    if (!clock) return '—';
    const text = clockText(clock);
    // En la tabla la columna es angosta: la pausa va en su forma corta.
    return this.i18n.tf(clock.state === 'paused' ? 'tickets.sla.pausedShort' : text.key, text.value);
  }

  protected slaTone(clock: SlaClock | undefined): string {
    return clock ? CLOCK_TONE[clock.state] : 'neutral';
  }
}
