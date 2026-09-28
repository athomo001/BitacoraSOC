import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { SlaClock, Ticket, TicketDetail, TicketStatus, TicketsService } from '../../core/tickets/tickets.service';
import { CLOCK_TONE, PRIORITY_SHORT, PRIORITY_TONE, STATUS_TONE, clockText, formatDuration, publicTrackingUrl, transitionAction } from '../../core/tickets/ticket-view';

type Tab = 'activity' | 'tasks' | 'entries';

/** Minutos predefinidos para registrar trabajo con un clic (mockup aprobado). */
const TASK_PRESETS = [15, 30, 60] as const;

/**
 * Detalle del ticket seleccionado (panel derecho de la Ticketera, diseño
 * aprobado): dos relojes de SLA, solo las transiciones válidas que calcula
 * el backend, actividad pública/interna, trabajo y bitácora vinculada, y el
 * enlace de seguimiento público con su PIN.
 */
@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ticket-detail.html',
  styleUrl: './ticket-detail.css',
})
export class TicketDetailComponent {
  readonly ticketId = input.required<string>();
  /** El ticket cambió (estado, SLA, actividad): la lista lo refresca. */
  readonly changed = output<Ticket>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);
  private readonly auth = inject(AuthService);

  protected readonly detail = signal<TicketDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly tab = signal<Tab>('activity');
  protected readonly copied = signal(false);
  protected readonly taskPresets = TASK_PRESETS;

  protected comment = '';
  /** Por defecto interno: publicar al cliente es una decisión explícita por comentario. */
  protected readonly commentPublic = signal(false);
  protected taskContent = '';
  protected readonly taskMinutes = signal<number>(30);

  protected readonly priorityShort = PRIORITY_SHORT;
  protected readonly priorityTone = PRIORITY_TONE;
  protected readonly statusTone = STATUS_TONE;

  protected readonly actions = computed(() => {
    const t = this.detail()?.ticket;
    return t ? t.allowedTransitions.map((to) => transitionAction(t.status, to)) : [];
  });

  protected readonly publicUrl = computed(() => {
    const token = this.detail()?.publicTrackingToken;
    return token ? publicTrackingUrl(window.location.origin, token) : null;
  });

  constructor() {
    effect(() => {
      const id = this.ticketId();
      void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    try {
      const detail = await this.api.get(id);
      if (id === this.ticketId()) this.detail.set(detail);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('tickets.error.load')));
    }
  }

  protected typeKey(t: Ticket): MessageKey {
    return `tickets.type.${t.ticketType}` as MessageKey;
  }

  protected statusKey(status: TicketStatus): MessageKey {
    return `tickets.status.${status}` as MessageKey;
  }

  protected levelKey(level: string): MessageKey {
    return `tickets.level.${level}` as MessageKey;
  }

  protected urgencyKey(level: string): MessageKey {
    return `tickets.urgency.${level}` as MessageKey;
  }

  /** Un SLA cumplido se muestra con la barra llena en verde, como en el mockup. */
  protected meterPercent(clock: SlaClock): number {
    return clock.state === 'met' ? 100 : clock.percent;
  }

  protected clockLabel(clock: SlaClock): string {
    const text = clockText(clock);
    return this.i18n.tf(text.key, text.value);
  }

  protected clockTone(clock: SlaClock): string {
    return CLOCK_TONE[clock.state];
  }

  protected duration(seconds: number): string {
    return formatDuration(seconds);
  }

  protected async transition(to: TicketStatus): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t) return;
    await this.run(async () => {
      // "Tomar": el ticket queda asignado a quien lo toma.
      const updated = await this.api.transition(t.id, to, to === 'assigned' ? this.auth.user()?.id : undefined);
      this.changed.emit(updated);
    });
  }

  protected async addComment(): Promise<void> {
    const t = this.detail()?.ticket;
    const content = this.comment.trim();
    if (!t || !content) return;
    await this.run(async () => {
      await this.api.addComment(t.id, content, this.commentPublic());
      this.comment = '';
      this.commentPublic.set(false);
      this.tab.set('activity');
    });
  }

  protected async addTask(): Promise<void> {
    const t = this.detail()?.ticket;
    const content = this.taskContent.trim();
    if (!t || !content) return;
    await this.run(async () => {
      await this.api.addTask(t.id, content, this.taskMinutes() * 60);
      this.taskContent = '';
    });
  }

  protected async regeneratePin(): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t) return;
    await this.run(() => this.api.regeneratePin(t.id));
  }

  protected async copyLink(): Promise<void> {
    const url = this.publicUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Sin portapapeles (contexto no seguro): el enlace queda visible para copiarlo a mano.
    }
  }

  /** Ejecuta una acción, recarga el detalle y avisa a la lista. */
  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      await this.load(this.ticketId());
      const t = this.detail()?.ticket;
      if (t) this.changed.emit(t);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('tickets.error.action')));
    } finally {
      this.busy.set(false);
    }
  }
}
