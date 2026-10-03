import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionsService } from '../../core/auth/permissions.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { appendSnippet, openMarkdownHelp } from '../../shared/markdown/markdown-help-dialog';
import { SlaClock, Ticket, TicketDetail, TicketImage, TicketPerson, TicketStatus, TicketsService } from '../../core/tickets/tickets.service';
import { AuthImgDirective } from '../../shared/ui/auth-img';
import { downloadFile } from '../../core/download';
import { HttpClient } from '@angular/common/http';
import { OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { resolverTeams } from '../../core/tickets/ticket-view';
import { CLOCK_TONE, PRIORITY_SHORT, PRIORITY_TONE, STATUS_TONE, clockText, formatDuration, publicTrackingUrl, transitionAction } from '../../core/tickets/ticket-view';

type Tab = 'activity' | 'images' | 'tasks' | 'entries';

/** Tope del diseño aprobado (comentario del dueño #14); el backend también lo exige. */
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface PendingImage {
  id: string;
  fileName: string;
  previewUrl: string;
  sizeBytes: number;
}

interface GalleryImage extends TicketImage {
  authorName: string;
  isPublic: boolean;
}

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
  imports: [DatePipe, FormsModule, MatIconModule, MarkdownComponent, AuthImgDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ticket-detail.html',
  styleUrl: './ticket-detail.css',
})
export class TicketDetailComponent {
  readonly ticketId = input.required<string>();
  /** El ticket cambió (estado, SLA, actividad): la lista lo refresca. */
  readonly changed = output<Ticket>();
  /** Un admin lo eliminó: la lista lo saca y deja de mostrarlo. */
  readonly deleted = output<string>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);
  private readonly auth = inject(AuthService);
  private readonly perms = inject(PermissionsService);
  private readonly injector = inject(Injector);
  private readonly http = inject(HttpClient);
  /** Eliminar un ticket mal creado: solo admin (pedido del dueño: cancelar = borrar). */
  protected readonly canDelete = this.perms.isAdmin;
  protected readonly confirmDelete = signal(false);
  private readonly orgs = inject(OrganizationsService);
  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly people = signal<TicketPerson[]>([]);
  /** Quienes todavía no están entre los resolutores. */
  protected readonly addable = computed(() => {
    const ids = new Set((this.detail()?.resolvers ?? []).map((r) => r.userId));
    return this.people().filter((p) => !ids.has(p.userId));
  });

  protected readonly detail = signal<TicketDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly tab = signal<Tab>('activity');
  protected readonly copied = signal(false);
  protected readonly taskPresets = TASK_PRESETS;

  protected comment = '';
  /** Por defecto interno: publicar al cliente es una decisión explícita por comentario. */
  protected readonly commentPublic = signal(false);
  /** Imágenes subidas para el comentario en curso (comentario del dueño #14). */
  protected readonly pending = signal<PendingImage[]>([]);
  protected readonly uploading = signal(0);
  protected readonly dragging = signal(false);
  protected readonly imageError = signal<string | null>(null);
  /** Imagen abierta en el visor. */
  protected readonly viewing = signal<GalleryImage | null>(null);
  /** Todas las imágenes del ticket, de la más nueva a la más vieja. */
  protected readonly gallery = computed<GalleryImage[]>(() => {
    const d = this.detail();
    if (!d) return [];
    return d.comments
      .flatMap((c) => c.images.map((i) => ({ ...i, authorName: c.authorName, isPublic: c.isPublic })))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
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
    void this.loadPickers();
  }

  /** Equipos y personas para cambiar el resolutor; sin ellos el detalle igual se ve. */
  private async loadPickers(): Promise<void> {
    try {
      const [teams, people] = await Promise.all([this.orgs.listTeams(), this.api.assignees()]);
      this.teams.set(resolverTeams(teams));
      this.people.set(people);
    } catch {
      // Sin listas no se puede cambiar el equipo ni sumar gente; el resto funciona.
    }
  }

  protected async setTeam(teamId: string): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t || !teamId || teamId === t.assignedTeamId) return;
    await this.run(() => this.api.setTeam(t.id, teamId));
  }

  protected async addResolver(userId: string): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t || !userId) return;
    await this.run(() => this.api.addResolver(t.id, userId));
  }

  protected async removeResolver(userId: string): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t) return;
    await this.run(() => this.api.removeResolver(t.id, userId));
  }

  protected hasTeam(id: string): boolean {
    return this.teams().some((t) => t.id === id);
  }

  protected personName(p: TicketPerson): string {
    return p.fullName || p.username;
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

  /** Guía de formato (comentario del dueño #9). */
  protected async openFormat(): Promise<void> {
    const snippet = await openMarkdownHelp(this.injector);
    if (snippet) this.comment = appendSnippet(this.comment, snippet);
  }

  protected async remove(): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t) return;
    await this.run(async () => {
      await this.api.remove(t.id);
      this.confirmDelete.set(false);
      this.deleted.emit(t.id);
    });
  }

  protected async addComment(): Promise<void> {
    const t = this.detail()?.ticket;
    const content = this.comment.trim();
    const images = this.pending();
    if (!t || (!content && !images.length) || this.uploading()) return;
    await this.run(async () => {
      await this.api.addComment(t.id, content, this.commentPublic(), images.map((i) => i.id));
      images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      this.pending.set([]);
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

  // ----- Imágenes (comentario del dueño #14) -----

  protected imageSrc(imageId: string): string {
    return this.api.imageUrl(this.ticketId(), imageId);
  }

  protected onPickImages(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.addFiles([...(input.files ?? [])]);
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.addFiles([...(event.dataTransfer?.files ?? [])]);
  }

  protected onDragOver(event: DragEvent): void {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  /** Pegar una captura (Ctrl+V) en la caja del comentario. */
  protected onPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void this.addFiles(files);
  }

  private async addFiles(files: File[]): Promise<void> {
    const t = this.detail()?.ticket;
    if (!t) return;
    this.imageError.set(null);
    const room = MAX_IMAGES - this.pending().length - this.uploading();
    const valid = files.filter((f) => IMAGE_TYPES.has(f.type) && f.size <= MAX_IMAGE_BYTES);
    if (valid.length < files.length) this.imageError.set(this.i18n.t('tickets.images.invalid'));
    if (valid.length > room) this.imageError.set(this.i18n.tf('tickets.images.tooMany', MAX_IMAGES));
    for (const file of valid.slice(0, Math.max(room, 0))) {
      this.uploading.update((n) => n + 1);
      try {
        const img = await this.api.uploadImage(t.id, file);
        this.pending.update((list) => [...list, { id: img.id, fileName: img.fileName, sizeBytes: img.sizeBytes, previewUrl: URL.createObjectURL(file) }]);
      } catch (error) {
        this.imageError.set(problemDetail(error, this.i18n.t('tickets.images.uploadError')));
      } finally {
        this.uploading.update((n) => n - 1);
      }
    }
  }

  protected async removePending(img: PendingImage): Promise<void> {
    this.pending.update((list) => list.filter((i) => i.id !== img.id));
    URL.revokeObjectURL(img.previewUrl);
    try {
      await this.api.removePendingImage(this.ticketId(), img.id);
    } catch {
      // Si falla, el servidor la limpia sola al día siguiente.
    }
  }

  protected openImage(img: TicketImage): void {
    this.viewing.set(this.gallery().find((g) => g.id === img.id) ?? null);
  }

  /** Al abrir el visor toma el foco: Esc y las flechas funcionan de inmediato. */
  private readonly viewerEl = viewChild<ElementRef<HTMLElement>>('viewer');
  private readonly focusViewer = effect(() => this.viewerEl()?.nativeElement.focus());

  protected stepImage(delta: number): void {
    const list = this.gallery();
    const i = list.findIndex((g) => g.id === this.viewing()?.id);
    if (i < 0 || !list.length) return;
    this.viewing.set(list[(i + delta + list.length) % list.length]);
  }

  protected async downloadImage(img: TicketImage): Promise<void> {
    await downloadFile(this.http, this.imageSrc(img.id), img.fileName);
  }

  protected sizeLabel(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}
