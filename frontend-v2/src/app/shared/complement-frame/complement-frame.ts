import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewContainerRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { ComplementSlot, ComplementsService, SlotTarget } from '../../core/complements/complements.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { AuthService } from '../../core/auth/auth.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/complement-features';

/** Más de 100 mensajes en 10 s desconecta el iframe (protección del legacy). */
const MAX_MESSAGES = 100;
const WINDOW_MS = 10_000;

type Outbound = 'CONTEXT_UPDATE' | 'THEME_CHANGE' | 'API_RESPONSE' | 'NOTE_ADDED' | 'ENTRY_CREATED' | 'PRINT';

/**
 * Una ranura de un complemento (10i, spec/11 §12): una página en un módulo,
 * una pestaña en una ficha, una acción o la barra superior. Siempre es un
 * iframe del origen aislado (o del servicio): el complemento nunca ve la
 * sesión. El puente postMessage (version 1) suma al del legacy:
 * API_REQUEST (la app lee /api/v1 como la persona), ADD_NOTE (seguimiento
 * firmado con el complemento en la ficha abierta) y CLOSE (cierra el
 * diálogo de una acción).
 */
@Component({
  selector: 'app-complement-frame',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src(); as s) {
      <!-- sandbox de spec/11 §2: allow-same-origin es seguro porque el origen es el aislado, no el de la app -->
      <iframe #frame class="cf__frame" [src]="s" [title]="label()" (load)="onLoad()"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"
        allow="clipboard-write" referrerpolicy="no-referrer"></iframe>
    } @else if (disconnected()) {
      <p class="cf__msg"><mat-icon>link_off</mat-icon>{{ i18n.t('cf.disconnected') }}</p>
    } @else if (error(); as e) {
      <p class="cf__msg"><mat-icon>error_outline</mat-icon>{{ e }}</p>
    }
  `,
  styles: `
    :host { display: block; position: relative; min-height: 0; }
    .cf__frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
    .cf__msg { display: flex; align-items: center; gap: 8px; margin: 0; padding: 12px; color: var(--text-secondary); }
    .cf__msg mat-icon { width: 18px; height: 18px; font-size: 18px; }
  `,
})
export class ComplementFrameComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ComplementsService);
  private readonly http = inject(HttpClient);
  private readonly prefs = inject(PreferencesService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly slug = input.required<string>();
  /** La ranura aprobada: «page:informe», «panel:reputacion», «action:buscar», «topbar». */
  readonly slot = input.required<string>();
  readonly objectType = input<SlotTarget | undefined>(undefined);
  readonly objectId = input<string | undefined>(undefined);
  /** Título accesible del iframe. */
  readonly label = input('');
  /** El complemento dejó un seguimiento o creó una entrada: la ficha se recarga. */
  readonly changed = output<void>();
  /** El complemento pidió cerrar (diálogo de una acción). */
  readonly closeRequested = output<void>();

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  protected readonly src = signal<SafeResourceUrl | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly disconnected = signal(false);
  private origin = '';
  private settings: Record<string, unknown> = {};
  private timestamps: number[] = [];
  private opening = 0;

  constructor() {
    const onMessage = (event: MessageEvent) => this.onMessage(event);
    window.addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('message', onMessage));
    effect(() => {
      const target = { slug: this.slug(), slot: this.slot(), type: this.objectType(), id: this.objectId() };
      untracked(() => void this.open(target));
    });
    // El tema y la fuente siguen a la app aunque el complemento ya esté abierto.
    effect(() => {
      const payload = { theme: this.prefs.theme(), dyslexiaFont: this.prefs.dyslexiaFont(), language: this.prefs.language() };
      untracked(() => this.post('THEME_CHANGE', payload));
    });
  }

  private async open(t: { slug: string; slot: string; type?: SlotTarget; id?: string }): Promise<void> {
    const run = ++this.opening;
    this.src.set(null);
    this.error.set(null);
    this.disconnected.set(false);
    this.timestamps = [];
    try {
      const res = await this.api.embed(t.slug, { slot: t.slot, objectType: t.type, objectId: t.id });
      if (run !== this.opening) return;
      this.origin = res.origin;
      this.settings = res.settings ?? {};
      this.src.set(this.sanitizer.bypassSecurityTrustResourceUrl(res.url));
    } catch (e) {
      if (run === this.opening) this.error.set(problemDetail(e, this.i18n.t('cf.openError')));
    }
  }

  /**
   * «Descargar PDF» de la app: el iframe es de otro origen y la app no puede
   * leerlo, así que le pide al complemento que abra la impresión (Guardar
   * como PDF) de su propia página.
   */
  print(): void {
    this.post('PRINT', {});
  }

  protected onLoad(): void {
    this.post('CONTEXT_UPDATE', this.context());
  }

  private context(): Record<string, unknown> {
    const user = this.auth.user();
    const type = this.objectType();
    const id = this.objectId();
    return {
      // Sin datos sensibles (spec/11 §6): nombre de usuario y rol.
      user: user ? { username: user.username, role: user.role } : null,
      theme: this.prefs.theme(),
      dyslexiaFont: this.prefs.dyslexiaFont(),
      language: this.prefs.language(),
      slot: this.slot(),
      object: type && id ? { type, id } : null,
      settings: this.settings,
    };
  }

  private post(type: Outbound, payload: Record<string, unknown>): void {
    const win = this.frame()?.nativeElement.contentWindow;
    if (!win || !this.origin || this.disconnected()) return;
    win.postMessage({ type, version: 1, timestamp: Date.now(), payload }, this.origin);
  }

  private onMessage(event: MessageEvent): void {
    const win = this.frame()?.nativeElement.contentWindow;
    if (!win || event.source !== win || event.origin !== this.origin || this.disconnected()) return;
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < WINDOW_MS);
    this.timestamps.push(now);
    if (this.timestamps.length > MAX_MESSAGES) {
      this.disconnected.set(true);
      this.src.set(null);
      return;
    }
    const data = event.data as { type?: unknown; version?: unknown; payload?: Record<string, unknown> } | null;
    if (!data || typeof data !== 'object' || data.version !== 1 || typeof data.type !== 'string') return;
    const payload = data.payload ?? {};
    switch (data.type) {
      case 'REQUEST_CONTEXT':
        this.post('CONTEXT_UPDATE', this.context());
        break;
      case 'API_REQUEST':
        void this.apiRequest(payload);
        break;
      case 'ADD_NOTE':
        void this.addNote(payload);
        break;
      case 'CREATE_ENTRY':
        void this.createEntry(payload);
        break;
      case 'CLOSE':
        this.closeRequested.emit();
        break;
    }
  }

  private async apiRequest(payload: Record<string, unknown>): Promise<void> {
    const id = payload['id'];
    const path = String(payload['path'] ?? '');
    try {
      const body = await firstValueFrom(this.http.post<unknown>(`/api/complements/${this.slug()}/api`, { method: 'GET', path }));
      this.post('API_RESPONSE', { id, ok: true, status: 200, body });
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0;
      this.post('API_RESPONSE', { id, ok: false, status, error: problemDetail(e, this.i18n.t('cf.apiError')) });
    }
  }

  private async addNote(payload: Record<string, unknown>): Promise<void> {
    const id = payload['id'];
    const type = this.objectType();
    const objectId = this.objectId();
    const content = String(payload['content'] ?? '').trim();
    if (!type || !objectId || !content) {
      this.post('NOTE_ADDED', { id, ok: false, error: this.i18n.t('cf.noteNoObject') });
      return;
    }
    try {
      await firstValueFrom(this.http.post(`/api/complements/${this.slug()}/note`, { target: type, id: objectId, content }));
      this.post('NOTE_ADDED', { id, ok: true });
      this.changed.emit();
    } catch (e) {
      this.post('NOTE_ADDED', { id, ok: false, error: problemDetail(e, this.i18n.t('cf.noteError')) });
    }
  }

  private async createEntry(payload: Record<string, unknown>): Promise<void> {
    const content = String(payload['content'] ?? '').trim();
    if (!content) return;
    const entryType = payload['entryType'] === 'incidente' ? 'incidente' : 'operativa';
    const tags = Array.isArray(payload['tags']) ? payload['tags'].map(String) : undefined;
    try {
      await this.api.createEntry(this.slug(), { content, entryType, tags });
      this.post('ENTRY_CREATED', { ok: true });
      this.changed.emit();
    } catch (e) {
      this.post('ENTRY_CREATED', { ok: false, error: problemDetail(e, this.i18n.t('cf.entryError')) });
    }
  }
}

/** Monta la barra superior en el shell, que carga este archivo diferido: 32px fijos. */
export function mountFrame(host: ViewContainerRef, slot: ComplementSlot): void {
  host.clear();
  const ref = host.createComponent(ComplementFrameComponent);
  ref.setInput('slug', slot.slug);
  ref.setInput('slot', slot.key);
  ref.setInput('label', slot.name);
  (ref.location.nativeElement as HTMLElement).style.cssText = 'height: 32px; overflow: hidden; border-bottom: 1px solid var(--border-subtle)';
}
