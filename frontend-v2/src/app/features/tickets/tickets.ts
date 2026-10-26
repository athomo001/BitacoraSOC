import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { SseService } from '../../core/sse/sse.service';
import { QueueSummary, SlaClock, Ticket, TicketFilters, TicketQueue, TicketScope, TicketSource, TicketType, TicketsService } from '../../core/tickets/tickets.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { CLOCK_TONE, PRIORITY_SHORT, PRIORITY_TONE, STATUS_TONE, clockText } from '../../core/tickets/ticket-view';
import { TicketDetailComponent } from './ticket-detail';

import '../../core/i18n/packs/tickets';
import { ComplementPageLinksComponent } from '../../shared/complement-frame/complement-page-links';
/**
 * Ticketera (/tickets, Fase 10) según el diseño aprobado: resumen de la cola
 * arriba, filtros de un clic, tabla densa con prioridad/estado como pastillas
 * del semáforo y barra de SLA, y el detalle fijo a la derecha. Solo existe
 * con `native_tickets` activo (el backend responde 403 si no).
 */
@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [FormsModule, MatIconModule, TicketDetailComponent, ComplementPageLinksComponent],
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
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly features = inject(SystemFeaturesService);

  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly summary = signal<QueueSummary>({ open: 0, breached: 0, paused: 0, resolvedToday: 0 });
  protected readonly selectedId = signal<string | null>(null);

  /** Clic en el número: lo copia (pedido del dueño) y por un momento dice «Copiado». */
  protected readonly copiedNumber = signal<string | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  protected async copyNumber(number: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(number);
      this.copiedNumber.set(number);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedNumber.set(null), 1500);
    } catch {
      this.copiedNumber.set(null);
    }
  }
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly typeFilter = signal<TicketType | null>(null);
  protected readonly openOnly = signal(false);
  /** Origen (spec/18): solo con la sincronización con GLPI encendida. */
  protected readonly glpiOn = computed(() => this.features.isEnabled('glpi_sync'));
  protected readonly sourceFilter = signal<TicketSource | null>(null);
  /** Tickets por área (9.1): qué cola se mira y las áreas del usuario. */
  protected readonly scope = signal<TicketScope | null>(null);
  protected readonly queue = signal<TicketQueue | null>(null);
  protected readonly queues = computed(() => {
    const s = this.scope();
    if (!s) return [];
    const out: { key: TicketQueue; icon: string; label: string }[] = [];
    const resolving = s.myAreas.filter((a) => a.resolves);
    if (resolving.length) {
      out.push({ key: 'mine', icon: 'inbox', label: resolving.length === 1 ? this.i18n.tf('tickets.queue.mine', resolving[0].name) : this.i18n.t('tickets.queue.mineMany') });
    }
    if (s.myAreas.length) {
      out.push({ key: 'asked', icon: 'outbox', label: resolving.length ? this.i18n.t('tickets.queue.askedMine') : this.i18n.tf('tickets.queue.asked', s.myAreas[0].name) });
    }
    if (s.all) out.push({ key: 'all', icon: 'select_all', label: this.i18n.t('tickets.queue.all') });
    return out;
  });
  protected query = '';

  /** Los hijos van justo debajo de su padre cuando los dos están en la página. */
  protected readonly rows = computed(() => {
    const list = this.tickets();
    const ids = new Set(list.map((t) => t.id));
    const childrenOf = new Map<string, Ticket[]>();
    for (const t of list) {
      if (t.parentId && ids.has(t.parentId)) childrenOf.set(t.parentId, [...(childrenOf.get(t.parentId) ?? []), t]);
    }
    const out: Ticket[] = [];
    for (const t of list) {
      if (t.parentId && ids.has(t.parentId)) continue;
      out.push(t, ...(childrenOf.get(t.id) ?? []));
    }
    return out;
  });

  protected readonly priorityShort = PRIORITY_SHORT;
  protected readonly priorityTone = PRIORITY_TONE;
  protected readonly statusTone = STATUS_TONE;

  async ngOnInit(): Promise<void> {
    // "Abrir el ticket" de los correos: /tickets?id=…
    const fromLink = this.route?.snapshot.queryParamMap.get('id');
    if (fromLink) this.selectedId.set(fromLink);
    // Otro analista cambió un ticket: la cola se refresca sola. Se conecta
    // antes de cargar, así el cierre queda registrado aunque el operador se
    // vaya de la pantalla mientras carga.
    const stop = this.sse.connect((eventType) => {
      if (eventType.startsWith('ticket.')) void this.load();
    });
    this.destroyRef.onDestroy(stop);
    try {
      this.scope.set(await this.api.scope());
      // Llegando por un enlace se mira todo lo visible, para encontrar ese ticket.
      this.queue.set(fromLink ? 'all' : (this.queues()[0]?.key ?? null));
    } catch {
      // Sin áreas conocidas se ve lo que el servidor deje ver.
    }
    await this.load();
  }

  protected setQueue(queue: TicketQueue): void {
    this.queue.set(queue);
    this.selectedId.set(null);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    const filters: TicketFilters = {
      ticketType: this.typeFilter() ?? undefined, openOnly: this.openOnly(), q: this.query, queue: this.queue() ?? undefined,
      source: this.glpiOn() ? (this.sourceFilter() ?? undefined) : undefined,
    };
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

  protected setSource(source: TicketSource | null): void {
    this.sourceFilter.set(source);
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

  protected onDeleted(id: string): void {
    this.tickets.update((list) => list.filter((t) => t.id !== id));
    this.selectedId.set(null);
    void this.load();
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
