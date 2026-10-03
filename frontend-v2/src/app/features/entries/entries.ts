import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { AuthImgDirective } from '../../shared/ui/auth-img';
import { PermissionsService } from '../../core/auth/permissions.service';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { AuthService } from '../../core/auth/auth.service';
import { problemDetail } from '../../core/http-error';
import { SseService } from '../../core/sse/sse.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { DraftsService } from '../../core/drafts/drafts.service';
import { appendSnippet, openMarkdownHelp } from '../../shared/markdown/markdown-help-dialog';
import { NotesService } from '../../core/notes/notes.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { Asset, EscalationService, SocService } from '../../core/escalation/escalation.service';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { defang } from '../../core/entries/defang';
import { Entry, EntryComment, EntryDetail, EntryFilters, EntryScope, EntryType, EntriesService } from '../../core/entries/entries.service';

interface ComposeDraft {
  entryType: EntryType;
  scope: EntryScope;
  content: string;
  tags: string;
  ticketNumber: string;
  /** "svc:<id>" o "asset:<id>" — el cliente/servicio (SOC) o activo (NOC) de la entrada; vacío = ninguno. */
  target?: string;
  createTicket?: boolean;
  ticketTeamId?: string;
  ticketClientId?: string;
}

const EMPTY_DRAFT: ComposeDraft = { entryType: 'operativa', scope: 'general', content: '', tags: '', ticketNumber: '', target: '', createTicket: false, ticketTeamId: '', ticketClientId: '' };

type SidePanel = 'none' | 'detail' | 'notes';

const TYPE_TONE: Record<EntryType, string> = { incidente: 'tone-bad', ofensa: 'tone-warn', operativa: 'tone-ok' };
const SCOPE_TONE: Record<EntryScope, string> = { noc: 'tone-info', soc: 'tone-system', general: 'tone-neutral' };
const SCOPE_ICON: Record<EntryScope, string> = { noc: 'public', soc: 'shield', general: 'settings' };

/** La primera línea del contenido, sin marcas de Markdown, como resumen de la fila. */
function summaryOf(content: string): string {
  const first = content.split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim();
}

/**
 * Bitácora (/entries, Fase 9, HU-7 y siguientes) según el artboard aprobado
 * "Shell principal": filtro rápido de ámbito y tipo arriba, tabla densa
 * (hora, ámbito, tipo, cliente, resumen) y el redactor fijo abajo (ámbito,
 * motivo, cliente/log source, texto, crear ticket, defang de IoCs, Ctrl+Enter
 * para guardar, Alt+N para escribir). El detalle y las notas (pizarrón y
 * libreta) se abren en un panel lateral. Solo aparecen los ámbitos SOC/NOC
 * que aplican al usuario.
 */
@Component({
  selector: 'app-entries',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule, MarkdownComponent, AuthImgDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './entries.html',
  styleUrl: './entries.css',
})
export class EntriesComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly types: EntryType[] = ['operativa', 'incidente', 'ofensa'];
  protected readonly typeTone = TYPE_TONE;
  protected readonly scopeTone = SCOPE_TONE;
  protected readonly scopeIcon = SCOPE_ICON;

  private readonly api = inject(EntriesService);
  private readonly drafts = inject(DraftsService);
  private readonly injector = inject(Injector);
  private readonly notesApi = inject(NotesService);
  private readonly sse = inject(SseService);
  private readonly auth = inject(AuthService);
  private readonly features = inject(SystemFeaturesService);
  private readonly escalation = inject(EscalationService);
  private readonly orgs = inject(OrganizationsService);
  private readonly modules = inject(ModuleAccessService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly perms = inject(PermissionsService);
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  /** Vincular o crear un ticket solo existe con la ticketera activa (el backend responde 403 si no). */
  protected readonly ticketsEnabled = computed(() => this.features.isEnabled('native_tickets'));
  /** SOC/NOC solo si aplican al usuario; General siempre. */
  protected readonly scopes = computed<EntryScope[]>(() => [...(this.modules.soc() ? (['soc'] as const) : []), ...(this.modules.noc() ? (['noc'] as const) : []), 'general']);

  protected readonly filterScope = signal<EntryScope | ''>('');
  protected readonly filterType = signal<EntryType | ''>('');
  protected readonly filterTag = signal('');
  protected readonly filterQ = signal('');
  protected readonly filterFrom = signal('');
  protected readonly filterTo = signal('');
  protected readonly moreFilters = signal(false);

  protected readonly entries = signal<Entry[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly panel = signal<SidePanel>('none');
  protected readonly selected = signal<EntryDetail | null>(null);
  protected readonly newComment = signal('');
  protected readonly confirmDelete = signal(false);

  protected readonly draft = signal<ComposeDraft>({ ...EMPTY_DRAFT });
  protected readonly composeImage = signal<{ url: string; previewUrl: string } | null>(null);
  protected readonly uploadingImage = signal(false);
  protected readonly saving = signal(false);

  protected readonly deploymentBanner = signal<{ version: string; message: string } | null>(null);

  protected readonly adminNotes = signal('');
  protected readonly personalNotes = signal('');
  protected readonly notesTab = signal<'admin' | 'personal'>('admin');
  protected readonly notesSaved = signal<{ admin?: boolean; personal?: boolean }>({});
  private adminNotesTimer?: ReturnType<typeof setTimeout>;
  private personalNotesTimer?: ReturnType<typeof setTimeout>;

  // Catálogos para "Cliente / Log source" y para crear un ticket desde la entrada.
  protected readonly services = signal<SocService[]>([]);
  protected readonly assets = signal<Asset[]>([]);
  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly clients = signal<Organization[]>([]);

  /** Nombre del cliente o activo de cada fila. */
  protected readonly targetNames = computed(() => {
    const map = new Map<string, string>();
    for (const s of this.services()) map.set('svc:' + s.id, s.organizationName ? `${s.organizationName} · ${s.name}` : s.name);
    for (const a of this.assets()) map.set('asset:' + a.id, a.name);
    return map;
  });

  /** Opciones del selector según el ámbito elegido: servicios (SOC), activos (NOC) o ambos (General). */
  protected readonly targetOptions = computed(() => {
    const scope = this.draft().scope;
    const svc = scope !== 'noc' ? this.services().map((s) => ({ id: 'svc:' + s.id, label: `${s.organizationName ? s.organizationName + ' · ' : ''}${s.name}` })) : [];
    const ast = scope !== 'soc' ? this.assets().map((a) => ({ id: 'asset:' + a.id, label: `${a.name} (${a.code})` })) : [];
    return [...svc, ...ast];
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.perms.load(), this.modules.load()]);
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
      if (own?.content?.content) this.draft.set({ ...EMPTY_DRAFT, ...own.content });
    } catch {
      // sin borrador pendiente
    }
    void this.loadCatalogs();

    const stopAutosaveEntry = this.drafts.autosave('entry', 'new', () => this.draft());
    const stopSse = this.sse.connect((eventType, data) => {
      if (eventType === 'deployment_ready') {
        this.deploymentBanner.set(data as { version: string; message: string });
      }
    });
    this.destroyRef.onDestroy(() => {
      stopAutosaveEntry();
      clearTimeout(this.adminNotesTimer);
      clearTimeout(this.personalNotesTimer);
      stopSse();
    });
  }

  /** Los catálogos son un extra: si alguno falla, la bitácora sigue funcionando. */
  private async loadCatalogs(): Promise<void> {
    const safe = async <T>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        // sin permiso o sin datos: el selector queda sin esas opciones
      }
    };
    await Promise.all([
      this.modules.soc() ? safe(this.escalation.listServices(), (v) => this.services.set(v)) : null,
      this.modules.noc() ? safe(this.escalation.listAssets(), (v) => this.assets.set(v)) : null,
      this.ticketsEnabled() ? safe(this.orgs.listTeams(), (v) => this.teams.set(v)) : null,
      this.ticketsEnabled() ? safe(this.orgs.list({ clients: true, active: true }), (v) => this.clients.set(v)) : null,
    ]);
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
      this.error.set(problemDetail(error, this.i18n.t('entries.loadError')));
    } finally {
      this.loading.set(false);
    }
  }

  /** Los filtros rápidos (ámbito y tipo) aplican al clic. */
  protected quickFilter<T>(target: { set(value: T): void }, value: T): void {
    target.set(value);
    void this.load();
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

  protected hasFilters(): boolean {
    return !!(this.filterScope() || this.filterType() || this.filterTag() || this.filterQ() || this.filterFrom() || this.filterTo());
  }

  protected summary(entry: Entry): string {
    return summaryOf(entry.content);
  }

  protected targetName(entry: Entry): string {
    const key = entry.serviceId ? 'svc:' + entry.serviceId : entry.assetId ? 'asset:' + entry.assetId : '';
    return key ? (this.targetNames().get(key) ?? '—') : '—';
  }

  protected typeKey(t: EntryType): MessageKey {
    return `entries.type.${t}` as MessageKey;
  }

  protected typeHintKey(t: EntryType): MessageKey {
    return `entries.typeHint.${t}` as MessageKey;
  }

  protected scopeKey(s: EntryScope): MessageKey {
    return `entries.scope.${s}` as MessageKey;
  }

  // ===== Panel lateral =====

  protected async select(entry: Entry): Promise<void> {
    this.error.set(null);
    this.confirmDelete.set(false);
    try {
      this.selected.set(await this.api.get(entry.id));
      this.panel.set('detail');
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.openError')));
    }
  }

  protected closePanel(): void {
    this.panel.set('none');
    this.selected.set(null);
    this.newComment.set('');
    this.confirmDelete.set(false);
  }

  protected toggleNotes(): void {
    if (this.panel() === 'notes') this.closePanel();
    else {
      this.selected.set(null);
      this.panel.set('notes');
    }
  }

  protected canModify(entry: Entry): boolean {
    return this.perms.isAdmin() || entry.authorUsername === this.auth.user()?.username;
  }

  protected async remove(entry: Entry): Promise<void> {
    try {
      await this.api.remove(entry.id);
      this.closePanel();
      await this.load();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.deleteError')));
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
      this.error.set(problemDetail(error, this.i18n.t('entries.commentError')));
    }
  }

  // ===== Redactor =====

  protected updateDraft(patch: Partial<ComposeDraft>): void {
    this.draft.update((d) => {
      const next = { ...d, ...patch };
      // Cambiar de ámbito puede dejar un cliente/activo que ya no corresponde.
      if (patch.scope && next.target && !this.targetOptionsFor(patch.scope).some((o) => o === next.target)) next.target = '';
      return next;
    });
  }

  private targetOptionsFor(scope: EntryScope): string[] {
    return [...(scope !== 'noc' ? this.services().map((s) => 'svc:' + s.id) : []), ...(scope !== 'soc' ? this.assets().map((a) => 'asset:' + a.id) : [])];
  }

  /** Guía de formato (comentario del dueño #9): lo elegido se suma al final de la entrada. */
  protected async openFormat(): Promise<void> {
    const snippet = await openMarkdownHelp(this.injector);
    if (snippet) this.updateDraft({ content: appendSnippet(this.draft().content, snippet) });
  }

  protected defangDraft(): void {
    this.updateDraft({ content: defang(this.draft().content) });
  }

  /** Crear ticket pide equipo y, si no hay un servicio elegido, el cliente. */
  protected readonly ticketProblem = computed(() => {
    const d = this.draft();
    if (!d.createTicket) return null;
    if (!d.ticketTeamId) return this.i18n.t('entries.ticketNeedsTeam');
    if (!d.target?.startsWith('svc:') && !d.ticketClientId) return this.i18n.t('entries.ticketNeedsClient');
    return null;
  });

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.composer()?.nativeElement.focus();
    }
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
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.uploadImage(file);
  }

  private async uploadImage(file: File): Promise<void> {
    this.uploadingImage.set(true);
    this.error.set(null);
    try {
      const result = await this.api.uploadImage(file);
      this.composeImage.set({ url: result.imageUrl, previewUrl: URL.createObjectURL(file) });
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.imageError')));
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
    if (!d.content.trim() || this.saving() || this.ticketProblem()) return;
    this.saving.set(true);
    this.error.set(null);
    const serviceId = d.target?.startsWith('svc:') ? d.target.slice(4) : undefined;
    const assetId = d.target?.startsWith('asset:') ? d.target.slice(6) : undefined;
    const tickets = this.ticketsEnabled();
    try {
      await this.api.create({
        entryType: d.entryType,
        scope: d.scope,
        content: d.content.trim(),
        tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
        serviceId,
        assetId,
        imageUrl: this.composeImage()?.url,
        ticketNumber: tickets && !d.createTicket ? d.ticketNumber.trim() || undefined : undefined,
        ...(tickets && d.createTicket
          ? { createTicket: true, ticketType: 'incident', assignedTeamId: d.ticketTeamId, clientId: serviceId ? undefined : d.ticketClientId }
          : {}),
      });
      this.draft.set({ ...EMPTY_DRAFT, scope: d.scope });
      this.removeImage();
      await this.load();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.saveError')));
    } finally {
      this.saving.set(false);
    }
  }

  // ===== Notas =====

  /** Autosave/debounce de 3s (spec/04-contratos-api.md): no dispara un PUT por cada tecla. */
  protected onAdminNotesChange(value: string): void {
    this.adminNotes.set(value);
    this.notesSaved.update((s) => ({ ...s, admin: false }));
    clearTimeout(this.adminNotesTimer);
    this.adminNotesTimer = setTimeout(() => void this.saveAdminNotes(), 3000);
  }

  protected onPersonalNotesChange(value: string): void {
    this.personalNotes.set(value);
    this.notesSaved.update((s) => ({ ...s, personal: false }));
    clearTimeout(this.personalNotesTimer);
    this.personalNotesTimer = setTimeout(() => void this.savePersonalNotes(), 3000);
  }

  private async saveAdminNotes(): Promise<void> {
    try {
      await this.notesApi.putAdmin(this.adminNotes());
      this.notesSaved.update((s) => ({ ...s, admin: true }));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.boardError')));
    }
  }

  private async savePersonalNotes(): Promise<void> {
    try {
      await this.notesApi.putPersonal(this.personalNotes());
      this.notesSaved.update((s) => ({ ...s, personal: true }));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.notebookError')));
    }
  }

  protected async exportCsv(): Promise<void> {
    try {
      await this.api.downloadCsv(this.filters());
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('entries.exportError')));
    }
  }

  protected dismissBanner(): void {
    this.deploymentBanner.set(null);
  }
}
