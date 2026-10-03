import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { PublicTicket, TicketsService } from '../../core/tickets/tickets.service';
import { PRIORITY_TONE, PUBLIC_STEPS, Tone, formatDuration, publicProgress } from '../../core/tickets/ticket-view';

type View = 'loading' | 'pin' | 'ready' | 'notFound' | 'error';

const PIN_LENGTH = 6;
/** El cliente deja la pestaña abierta: se refresca sola, sin recargar la página. */
const REFRESH_MS = 60_000;
/** "Actualizado hace…" avanza aunque no llegue nada nuevo. */
const CLOCK_MS = 30_000;

/**
 * Seguimiento público del ticket (`/p/tickets/:token`, spec/06 §6.4) —
 * artboard aprobado "Ticketera: seguimiento público". Sin login ni shell:
 * primero el PIN (solo si el ticket lo tiene), después el estado en 3 pasos
 * que entiende el cliente y los comunicados públicos. Nunca muestra técnicos
 * ni notas internas: el backend ya no los envía (DTO propio).
 */
@Component({
  selector: 'app-public-ticket',
  standalone: true,
  imports: [DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-ticket.html',
  styleUrl: './public-ticket.css',
})
export class PublicTicketComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly prefs = inject(PreferencesService);
  private readonly api = inject(TicketsService);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly view = signal<View>('loading');
  protected readonly ticket = signal<PublicTicket | null>(null);
  protected readonly pin = signal('');
  protected readonly pinWrong = signal(false);
  protected readonly tooMany = signal(false);
  protected readonly busy = signal(false);
  protected readonly now = signal(Date.now());
  /** PIN que ya abrió el ticket: los refrescos lo reutilizan sin volver a pedirlo. */
  private acceptedPin: string | undefined;

  protected readonly steps = PUBLIC_STEPS;
  protected readonly priorityTone = PRIORITY_TONE;

  protected readonly progress = computed(() => {
    const t = this.ticket();
    return t ? publicProgress(t.status) : null;
  });

  /** Casillas del PIN: una por dígito, vacías las que faltan. */
  protected readonly pinDigits = computed(() => Array.from({ length: PIN_LENGTH }, (_, i) => this.pin()[i] ?? ''));

  /** Lo más reciente arriba, como en el artboard (el backend los entrega en orden cronológico). */
  /** Imagen de un comentario público: ruta pública con el mismo PIN aceptado (sin token de sesión). */
  protected imageUrl(id: string): string {
    const pin = this.acceptedPin ? `?pin=${encodeURIComponent(this.acceptedPin)}` : '';
    return `/api/public/tickets/${encodeURIComponent(this.token)}/images/${id}${pin}`;
  }

  protected readonly updates = computed(() => [...(this.ticket()?.publicComments ?? [])].reverse());

  protected readonly updatedText = computed(() => {
    const last = this.ticket()?.lastUpdateAt;
    if (!last) return '';
    const seconds = (this.now() - Date.parse(last)) / 1000;
    return seconds < 60 ? this.i18n.t('publicTicket.updatedNow') : this.i18n.tf('publicTicket.updated', formatDuration(seconds));
  });

  constructor() {
    // Un enlace con token no debe terminar en un buscador.
    const meta = inject(Meta);
    meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });

    const clock = setInterval(() => this.now.set(Date.now()), CLOCK_MS);
    const refresh = setInterval(() => {
      if (this.view() === 'ready') void this.load(this.acceptedPin, true);
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearInterval(refresh);
      meta.removeTag("name='robots'");
    });

    void this.load();
  }

  /** Solo dígitos: lo que no lo sea se borra del campo en el acto. */
  protected onPinInput(input: HTMLInputElement): void {
    const digits = input.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    input.value = digits;
    this.pin.set(digits);
    this.pinWrong.set(false);
  }

  protected submitPin(): void {
    if (this.pin().length === PIN_LENGTH && !this.busy()) void this.load(this.pin());
  }

  protected retry(): void {
    this.view.set('loading');
    void this.load(this.acceptedPin);
  }

  protected toggleTheme(): void {
    this.prefs.theme.set(this.prefs.theme() === 'light' ? 'dark' : 'light');
  }

  protected typeKey(t: PublicTicket): MessageKey {
    return `tickets.type.${t.ticketType}` as MessageKey;
  }

  protected priorityKey(t: PublicTicket): MessageKey {
    return `publicTicket.priority.${t.priority}` as MessageKey;
  }

  /** Color de la barra de cada paso: completo en verde, el actual con el tono del estado. */
  protected barTone(index: number): Tone | 'todo' {
    const p = this.progress();
    if (!p || p.step === null) return 'todo';
    if (p.done || index < p.step) return 'ok';
    return index === p.step ? p.tone : 'todo';
  }

  private async load(pin?: string, silent = false): Promise<void> {
    this.busy.set(true);
    this.tooMany.set(false);
    try {
      this.ticket.set(await this.api.getPublic(this.token, pin));
      this.acceptedPin = pin;
      this.pin.set('');
      this.pinWrong.set(false);
      this.now.set(Date.now());
      this.view.set('ready');
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if (status === 401) {
        // Primera visita a un ticket con PIN: se pide sin marcarlo como error.
        this.pinWrong.set(pin !== undefined);
        this.pin.set('');
        this.ticket.set(null);
        this.view.set('pin');
      } else if (status === 429) {
        this.tooMany.set(true);
        this.view.set('pin');
      } else if (status === 404) {
        this.ticket.set(null);
        this.view.set('notFound');
      } else if (!silent) {
        this.view.set('error');
      }
      // Un refresco que falla por la red deja en pantalla lo último que se vio.
    } finally {
      this.busy.set(false);
    }
  }
}
