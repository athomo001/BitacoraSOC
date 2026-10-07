import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import { Complement, ComplementStatus, ComplementsService, ManualDraft, UploadResult } from '../../core/complements/complements.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { PreferencesService } from '../../core/preferences/preferences.service';

import '../../core/i18n/packs/admin';
/** Permisos de la Runtime API, con su explicación en lenguaje claro. */
export const SCOPES: readonly { code: string; labelKey: MessageKey }[] = [
  { code: 'READ_CONTEXT', labelKey: 'acomp.scope.READ_CONTEXT' },
  { code: 'READ_LOGS', labelKey: 'acomp.scope.READ_LOGS' },
  { code: 'WRITE_ENTRIES', labelKey: 'acomp.scope.WRITE_ENTRIES' },
  { code: 'READ_STORAGE', labelKey: 'acomp.scope.READ_STORAGE' },
  { code: 'WRITE_STORAGE', labelKey: 'acomp.scope.WRITE_STORAGE' },
  { code: 'WRITE_LOGS', labelKey: 'acomp.scope.WRITE_LOGS' },
];

/**
 * Las colecciones salen de los permisos (en el legacy se elegían aparte y
 * era fácil dejar un permiso sin su colección y que fallara en silencio).
 */
export function collectionsFor(scopes: string[]): string[] {
  const out = new Set<string>();
  if (scopes.includes('WRITE_ENTRIES') || scopes.includes('READ_LOGS')) out.add('entries');
  if (scopes.includes('READ_LOGS')) out.add('audit_log');
  if (scopes.includes('READ_STORAGE') || scopes.includes('WRITE_STORAGE')) out.add('shared_storage');
  return [...out];
}

const ROLES: readonly { code: string; labelKey: MessageKey }[] = [
  { code: 'admin', labelKey: 'acomp.role.admin' },
  { code: 'user', labelKey: 'acomp.role.user' },
  { code: 'auditor', labelKey: 'acomp.role.auditor' },
];

const STATUSES: readonly ComplementStatus[] = ['active', 'maintenance', 'disabled'];

type Flow = null | 'upload' | 'manual';

function emptyManual(): ManualDraft {
  return { slug: '', name: '', baseUrl: '', internalBaseUrl: '', healthPath: '/health', entryPath: '/', scopes: ['READ_CONTEXT', 'WRITE_LOGS'], allowedCollections: [], visibleRoles: [], visiblePermissionGroupIds: [] };
}

/**
 * Administración → Complementos (spec/11 §7) según el artboard aprobado:
 * lista con estado y quién los ve, y a la derecha la ficha del elegido, el
 * flujo "Subir → Revisar → Vista previa → Publicado" o el alta de un
 * servicio. Los cambios de la ficha se guardan al tocarlos.
 */
@Component({
  selector: 'app-admin-complements',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-complements.html',
  styleUrl: './admin-complements.css',
})
export class AdminComplementsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ComplementsService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly prefs = inject(PreferencesService);

  protected readonly scopes = SCOPES;
  protected readonly roles = ROLES;
  protected readonly statuses = STATUSES;
  protected readonly stepLabels: readonly MessageKey[] = ['acomp.step1', 'acomp.step2', 'acomp.step3', 'acomp.step4'];

  protected readonly list = signal<Complement[]>([]);
  protected readonly groups = signal<{ id: string; name: string }[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedSlug = signal<string | null>(null);
  protected readonly detail = signal<Complement | null>(null);
  protected readonly flow = signal<Flow>(null);
  protected readonly tested = signal<string | null>(null);
  protected readonly token = signal<string | null>(null);
  protected readonly confirmRegen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTyped = signal('');
  protected readonly newHost = signal('');

  // Subir ZIP
  protected readonly step = signal(1);
  protected readonly dragging = signal(false);
  protected readonly upload = signal<UploadResult | null>(null);
  protected readonly uploadName = signal('');
  protected readonly uploadError = signal<string | null>(null);
  protected readonly previewSrc = signal<SafeResourceUrl | null>(null);
  protected readonly pubName = signal('');
  protected readonly pubSlug = signal('');
  protected readonly pubHosts = signal<string[]>([]);
  /** Nueva versión de un complemento ya publicado: el identificador no cambia. */
  protected readonly versionOf = signal<string | null>(null);

  // Registrar servicio
  protected readonly manual = signal<ManualDraft>(emptyManual());

  protected readonly selected = computed(() => this.list().find((c) => c.slug === this.selectedSlug()) ?? null);
  protected readonly canDelete = computed(() => this.deleteTyped().trim() === this.detail()?.slug);

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      const [list, groups] = await Promise.all([this.api.list(), this.api.listGroups().catch(() => [])]);
      this.list.set(list);
      this.groups.set(groups.filter((g) => g.active));
      if (list.length) await this.select(list[0].slug);
    });
    this.loading.set(false);
  }

  // ===== Lista y ficha =====

  protected async select(slug: string): Promise<void> {
    this.flow.set(null);
    this.selectedSlug.set(slug);
    this.tested.set(null);
    this.token.set(null);
    this.confirmRegen.set(false);
    this.deleteOpen.set(false);
    this.deleteTyped.set('');
    this.newHost.set('');
    try {
      this.detail.set(await this.api.get(slug));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('acomp.loadError')));
    }
  }

  protected typeLabel(c: Complement): string {
    return this.i18n.t(c.sourceType === 'zip_static' ? 'acomp.type.zip' : 'acomp.type.service');
  }

  protected stateLabel(c: Complement): string {
    if (c.sourceType === 'manual' && c.status === 'active' && c.circuit === 'OPEN') return this.i18n.t('acomp.state.down');
    return this.i18n.t(`acomp.state.${c.status}` as MessageKey);
  }

  protected stateTone(c: Complement): string {
    if (c.sourceType === 'manual' && c.status === 'active' && c.circuit === 'OPEN') return 'tone-bad';
    return c.status === 'active' ? 'tone-ok' : c.status === 'maintenance' ? 'tone-warn' : 'tone-neutral';
  }

  /** "44 KB" o "7,8 MB", con el separador decimal del idioma. */
  protected size(bytes: number): string {
    const locale = this.prefs.language() === 'es' ? 'es-CL' : 'en-US';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
    return `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  }

  protected statusName(s: ComplementStatus): string {
    return this.i18n.t(`acomp.state.${s}` as MessageKey);
  }

  protected statusHint(s: ComplementStatus): string {
    return this.i18n.t(`acomp.stateHint.${s}` as MessageKey);
  }

  protected who(c: Complement): string {
    const names = [
      ...c.visibleRoles.map((r) => this.i18n.t(`acomp.role.${r}` as MessageKey)),
      ...c.visiblePermissionGroupIds.map((id) => this.groups().find((g) => g.id === id)?.name ?? '—'),
    ];
    return names.length ? names.join(', ') : this.i18n.t('acomp.everyone');
  }

  private async save(patch: Partial<Omit<Complement, 'slug'>>): Promise<void> {
    const c = this.detail();
    if (!c) return;
    await this.run(async () => {
      const saved = await this.api.patch(c.slug, patch);
      this.detail.set({ ...saved, entriesCount: c.entriesCount });
      this.list.update((l) => l.map((x) => (x.slug === saved.slug ? saved : x)));
      if (patch.status) void this.api.refresh();
    });
  }

  protected setStatus(status: ComplementStatus): void {
    if (this.detail()?.status !== status) void this.save({ status });
  }

  protected toggleScope(code: string): void {
    const c = this.detail();
    if (!c) return;
    const scopes = c.scopes.includes(code) ? c.scopes.filter((s) => s !== code) : [...c.scopes, code];
    void this.save({ scopes, allowedCollections: collectionsFor(scopes) });
  }

  protected toggleRole(code: string): void {
    const c = this.detail();
    if (!c) return;
    void this.save({ visibleRoles: c.visibleRoles.includes(code) ? c.visibleRoles.filter((r) => r !== code) : [...c.visibleRoles, code] });
  }

  protected toggleGroup(id: string): void {
    const c = this.detail();
    if (!c) return;
    const ids = c.visiblePermissionGroupIds;
    void this.save({ visiblePermissionGroupIds: ids.includes(id) ? ids.filter((g) => g !== id) : [...ids, id] });
  }

  protected addHost(): void {
    const c = this.detail();
    const host = this.newHost().trim();
    if (!c || !host) return;
    this.newHost.set('');
    void this.save({ connectHosts: [...c.connectHosts, host] });
  }

  protected removeHost(host: string): void {
    const c = this.detail();
    if (c) void this.save({ connectHosts: c.connectHosts.filter((h) => h !== host) });
  }

  protected async test(): Promise<void> {
    const c = this.detail();
    if (!c) return;
    await this.run(async () => {
      const r = await this.api.test(c.slug);
      if (c.sourceType === 'zip_static') this.tested.set(this.i18n.tf(r.ok ? 'acomp.testFilesOk' : 'acomp.testFilesBad', r.files ?? 0));
      else this.tested.set(r.ok ? this.i18n.tf('acomp.testOk', r.latencyMs ?? 0) : this.i18n.tf('acomp.testBad', r.detail ?? ''));
      const fresh = await this.api.get(c.slug);
      this.detail.set(fresh);
      this.list.update((l) => l.map((x) => (x.slug === fresh.slug ? fresh : x)));
    });
  }

  protected async regenerate(): Promise<void> {
    const c = this.detail();
    if (!c) return;
    await this.run(async () => {
      this.token.set(await this.api.regenerateToken(c.slug));
      this.confirmRegen.set(false);
      this.detail.set(await this.api.get(c.slug));
    });
  }

  protected async copyToken(): Promise<void> {
    const t = this.token();
    if (t) await navigator.clipboard?.writeText(t).catch(() => undefined);
  }

  protected async remove(): Promise<void> {
    const c = this.detail();
    if (!c || !this.canDelete()) return;
    await this.run(async () => {
      await this.api.remove(c.slug);
      const list = await this.api.list();
      this.list.set(list);
      this.detail.set(null);
      this.selectedSlug.set(null);
      void this.api.refresh();
      if (list.length) await this.select(list[0].slug);
    });
  }

  // ===== Subir ZIP =====

  protected startUpload(versionOf: string | null = null): void {
    this.flow.set('upload');
    this.step.set(1);
    this.upload.set(null);
    this.uploadError.set(null);
    this.previewSrc.set(null);
    this.versionOf.set(versionOf);
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.sendFile(file);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.sendFile(file);
  }

  private async sendFile(file: File): Promise<void> {
    this.uploadError.set(null);
    this.uploadName.set(file.name);
    this.busy.set(true);
    try {
      const result = await this.api.upload(file);
      this.accept(result);
    } catch (e) {
      // 422: se analizó pero no se publica como estático; igual se muestra el análisis.
      const body = e instanceof HttpErrorResponse ? (e.error?.data as UploadResult | undefined) : undefined;
      if (body?.analysis) this.accept(body);
      else this.uploadError.set(problemDetail(e, this.i18n.t('acomp.uploadError')));
    } finally {
      this.busy.set(false);
    }
  }

  private accept(result: UploadResult): void {
    this.upload.set(result);
    const existing = this.versionOf() ? this.list().find((c) => c.slug === this.versionOf()) : null;
    this.pubName.set(existing?.name ?? result.analysis.suggestedName);
    this.pubSlug.set(existing?.slug ?? result.analysis.suggestedSlug);
    this.pubHosts.set(existing?.connectHosts ?? []);
    this.step.set(2);
  }

  protected async toPreview(): Promise<void> {
    const up = this.upload();
    if (!up) return;
    await this.run(async () => {
      this.previewSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(await this.api.previewUrl(up.uploadId)));
      this.step.set(3);
    });
  }

  protected toggleHost(host: string): void {
    this.pubHosts.update((h) => (h.includes(host) ? h.filter((x) => x !== host) : [...h, host]));
  }

  protected async publish(): Promise<void> {
    const up = this.upload();
    if (!up) return;
    await this.run(async () => {
      const existing = this.list().find((c) => c.slug === this.pubSlug());
      const saved = await this.api.publish(up.uploadId, {
        slug: this.pubSlug().trim(), name: this.pubName().trim(), connectHosts: this.pubHosts(),
        visibleRoles: existing?.visibleRoles ?? [], visiblePermissionGroupIds: existing?.visiblePermissionGroupIds ?? [],
      });
      this.list.set(await this.api.list());
      this.selectedSlug.set(saved.slug);
      this.step.set(4);
      void this.api.refresh();
    });
  }

  protected closeFlow(): void {
    const slug = this.selectedSlug() ?? this.list()[0]?.slug;
    this.flow.set(null);
    if (slug) void this.select(slug);
  }

  // ===== Registrar servicio =====

  protected startManual(): void {
    this.manual.set(emptyManual());
    this.flow.set('manual');
  }

  protected editManual(patch: Partial<ManualDraft>): void {
    this.manual.update((m) => ({ ...m, ...patch }));
  }

  protected toggleManualScope(code: string): void {
    const s = this.manual().scopes;
    this.editManual({ scopes: s.includes(code) ? s.filter((x) => x !== code) : [...s, code] });
  }

  protected async register(): Promise<void> {
    const m = this.manual();
    await this.run(async () => {
      const r = await this.api.register({ ...m, slug: m.slug.trim(), name: m.name.trim(), allowedCollections: collectionsFor(m.scopes) });
      this.list.set(await this.api.list());
      await this.select(r.complement.slug);
      this.token.set(r.applicationToken);
      void this.api.refresh();
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('acomp.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
