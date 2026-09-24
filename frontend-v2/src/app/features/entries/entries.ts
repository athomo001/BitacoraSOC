import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ButtonComponent } from '../../shared/ui/button/button';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { PermissionsService } from '../../core/auth/permissions.service';
import { AuthService } from '../../core/auth/auth.service';
import { problemDetail } from '../../core/http-error';
import { SseService } from '../../core/sse/sse.service';
import { DraftsService } from '../../core/drafts/drafts.service';
import { NotesService } from '../../core/notes/notes.service';
import {
  ENTRY_SCOPE_LABELS,
  ENTRY_TYPE_LABELS,
  Entry,
  EntryComment,
  EntryDetail,
  EntryFilters,
  EntryScope,
  EntryType,
  EntriesService,
} from '../../core/entries/entries.service';

interface ComposeDraft {
  entryType: EntryType;
  scope: EntryScope;
  content: string;
  tags: string;
}

const EMPTY_DRAFT: ComposeDraft = { entryType: 'operativa', scope: 'general', content: '', tags: '' };

/**
 * Muro de Bitácora Operativa (/entries, Fase 9, HU-7 y siguientes). Alcance
 * recortado a lo que pide spec/02-alcance-y-roadmap.md Fase 9 — sin sinergia
 * de ticketing (Fase 10), sin GLPI/defanging/severidad (Backlog Post-Corte):
 * el mockup completo de spec/06-frontend-arquitectura-y-ui.md sección 5 es
 * la visión final, no lo que esta fase construye.
 */
@Component({
  selector: 'app-entries',
  standalone: true,
  imports: [FormsModule, DatePipe, ButtonComponent, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './entries.html',
  styleUrl: './entries.css',
})
export class EntriesComponent implements OnInit {
  protected readonly typeLabels = ENTRY_TYPE_LABELS;
  protected readonly scopeLabels = ENTRY_SCOPE_LABELS;
  protected readonly types: EntryType[] = ['operativa', 'incidente', 'ofensa'];
  protected readonly scopes: EntryScope[] = ['soc', 'noc', 'general'];

  private readonly api = inject(EntriesService);
  private readonly drafts = inject(DraftsService);
  private readonly notesApi = inject(NotesService);
  private readonly sse = inject(SseService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly perms = inject(PermissionsService);

  protected readonly filterScope = signal<EntryScope | ''>('');
  protected readonly filterType = signal<EntryType | ''>('');
  protected readonly filterTag = signal('');
  protected readonly filterQ = signal('');
  protected readonly filterFrom = signal('');
  protected readonly filterTo = signal('');

  protected readonly entries = signal<Entry[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selected = signal<EntryDetail | null>(null);
  protected readonly newComment = signal('');

  protected readonly draft = signal<ComposeDraft>({ ...EMPTY_DRAFT });
  protected readonly composeImage = signal<{ url: string; previewUrl: string } | null>(null);
  protected readonly uploadingImage = signal(false);
  protected readonly saving = signal(false);

  protected readonly deploymentBanner = signal<{ version: string; message: string } | null>(null);

  protected readonly adminNotes = signal('');
  protected readonly personalNotes = signal('');
  protected readonly notesSaved = signal<{ admin?: boolean; personal?: boolean }>({});
  private adminNotesTimer?: ReturnType<typeof setTimeout>;
  private personalNotesTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    await this.perms.load();
    await this.load();

    try {
      const [admin, personal] = await Promise.all([this.notesApi.getAdmin(), this.notesApi.getPersonal()]);
      this.adminNotes.set(admin.content);
      this.personalNotes.set(personal.content);
    } catch {
      // sin notas todavía: se queda en blanco
    }

    // Restaura el borrador de la última sesión (HU-7d) antes de empezar el autosave.
    try {
      const pending = await this.drafts.list<ComposeDraft>('entry');
      const own = pending.find((d) => d.draftKey === 'new');
      if (own?.content?.content) this.draft.set(own.content);
    } catch {
      // sin borrador pendiente
    }

    // Solo el cajón de redacción usa el autosave genérico (entry_drafts,
    // HU-7d): las notas ya tienen su propio almacenamiento durable
    // (admin_notes/personal_notes) — acá solo falta debouncear el PUT, no
    // respaldarlo aparte en un borrador.
    const stopAutosaveEntry = this.drafts.autosave('entry', 'new', () => this.draft());
    const stopSse = this.sse.connect((eventType, data) => {
      if (eventType === 'deployment_ready') {
        const payload = data as { version: string; message: string };
        this.deploymentBanner.set(payload);
      }
    });
    this.destroyRef.onDestroy(() => {
      stopAutosaveEntry();
      clearTimeout(this.adminNotesTimer);
      clearTimeout(this.personalNotesTimer);
      stopSse();
    });
  }

  private filters(): EntryFilters {
    return {
      scope: this.filterScope() || undefined,
      type: this.filterType() || undefined,
      tag: this.filterTag().trim() || undefined,
      q: this.filterQ().trim() || undefined,
      from: this.filterFrom() || undefined,
      to: this.filterTo() || undefined,
    };
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.list(this.filters());
      this.entries.set(res.items);
      this.total.set(res.total);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron cargar las entradas.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected clearFilters(): void {
    this.filterScope.set('');
    this.filterType.set('');
    this.filterTag.set('');
    this.filterQ.set('');
    this.filterFrom.set('');
    this.filterTo.set('');
    void this.load();
  }

  protected async select(entry: Entry): Promise<void> {
    this.error.set(null);
    try {
      this.selected.set(await this.api.get(entry.id));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo abrir la entrada.'));
    }
  }

  protected closeDetail(): void {
    this.selected.set(null);
    this.newComment.set('');
  }

  protected canModify(entry: Entry): boolean {
    return this.perms.isAdmin() || entry.authorUsername === this.auth.user()?.username;
  }

  protected async remove(entry: Entry): Promise<void> {
    if (!confirm('¿Borrar esta entrada? No queda en papelera — se borra de verdad, pero la auditoría conserva el registro.')) return;
    try {
      await this.api.remove(entry.id);
      if (this.selected()?.id === entry.id) this.closeDetail();
      await this.load();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo borrar la entrada.'));
    }
  }

  protected async addComment(): Promise<void> {
    const entry = this.selected();
    const comment = this.newComment().trim();
    if (!entry || !comment) return;
    try {
      const created: EntryComment = await this.api.addComment(entry.id, comment);
      this.selected.set({ ...entry, comments: [...entry.comments, created] });
      this.newComment.set('');
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo agregar el comentario.'));
    }
  }

  protected updateDraft(patch: Partial<ComposeDraft>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
  }

  protected async onPaste(event: ClipboardEvent): Promise<void> {
    const file = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .find((f): f is File => f !== null);
    if (!file) return;
    event.preventDefault();
    await this.uploadImage(file);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await this.uploadImage(file);
  }

  private async uploadImage(file: File): Promise<void> {
    this.uploadingImage.set(true);
    this.error.set(null);
    try {
      const result = await this.api.uploadImage(file);
      this.composeImage.set({ url: result.imageUrl, previewUrl: URL.createObjectURL(file) });
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo subir la imagen.'));
    } finally {
      this.uploadingImage.set(false);
    }
  }

  protected removeImage(): void {
    const img = this.composeImage();
    if (img) URL.revokeObjectURL(img.previewUrl);
    this.composeImage.set(null);
  }

  protected async submitEntry(): Promise<void> {
    const d = this.draft();
    if (!d.content.trim() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.create({
        entryType: d.entryType,
        scope: d.scope,
        content: d.content.trim(),
        tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
        imageUrl: this.composeImage()?.url,
      });
      this.draft.set({ ...EMPTY_DRAFT });
      this.removeImage();
      await this.load();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo guardar la entrada.'));
    } finally {
      this.saving.set(false);
    }
  }

  /** Autosave/debounce de 3s (spec/04-contratos-api.md): no dispara un PUT por cada tecla. */
  protected onAdminNotesChange(value: string): void {
    this.adminNotes.set(value);
    clearTimeout(this.adminNotesTimer);
    this.adminNotesTimer = setTimeout(() => void this.saveAdminNotes(), 3000);
  }

  protected onPersonalNotesChange(value: string): void {
    this.personalNotes.set(value);
    clearTimeout(this.personalNotesTimer);
    this.personalNotesTimer = setTimeout(() => void this.savePersonalNotes(), 3000);
  }

  private async saveAdminNotes(): Promise<void> {
    try {
      await this.notesApi.putAdmin(this.adminNotes());
      this.notesSaved.update((s) => ({ ...s, admin: true }));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo guardar el pizarrón.'));
    }
  }

  private async savePersonalNotes(): Promise<void> {
    try {
      await this.notesApi.putPersonal(this.personalNotes());
      this.notesSaved.update((s) => ({ ...s, personal: true }));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo guardar la libreta.'));
    }
  }

  protected async exportCsv(): Promise<void> {
    const token = this.auth.token();
    const url = this.api.exportUrl(this.filters());
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) {
      this.error.set('No se pudo exportar el CSV.');
      return;
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'entries.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  protected dismissBanner(): void {
    this.deploymentBanner.set(null);
  }
}
