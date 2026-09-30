import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { ActiveComplement, ComplementsService } from '../../core/complements/complements.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { AuthService } from '../../core/auth/auth.service';
import { problemDetail } from '../../core/http-error';

/** Más de 100 mensajes en 10 s desconecta el iframe (protección del legacy). */
const MAX_MESSAGES = 100;
const WINDOW_MS = 10_000;

type OutboundType = 'CONTEXT_UPDATE' | 'THEME_CHANGE' | 'USER_CHANGE';

/**
 * Complementos (spec/11 §6 y §7) según el artboard aprobado: una pestaña
 * por complemento visible y el iframe en toda el área de trabajo. Un
 * estático se abre con un enlace de un solo uso en el origen aislado (no
 * puede leer la sesión); un servicio, en su propia dirección. El puente
 * postMessage es el del legacy (version 1): valida origen y ventana, y solo
 * acepta REQUEST_CONTEXT y CREATE_ENTRY.
 */
@Component({
  selector: 'app-complements',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './complements.html',
  styleUrl: './complements.css',
})
export class ComplementsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ComplementsService);
  private readonly prefs = inject(PreferencesService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  protected readonly list = this.api.available;
  protected readonly slug = signal<string | null>(null);
  protected readonly src = signal<SafeResourceUrl | null>(null);
  protected readonly origin = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly disconnected = signal(false);

  protected readonly current = computed(() => this.list().find((c) => c.slug === this.slug()) ?? null);
  protected readonly originHost = computed(() => {
    try {
      return this.origin() ? new URL(this.origin()).host : '';
    } catch {
      return '';
    }
  });

  private timestamps: number[] = [];

  constructor() {
    const onMessage = (event: MessageEvent) => this.onMessage(event);
    window.addEventListener('message', onMessage);
    this.destroyRef.onDestroy(() => window.removeEventListener('message', onMessage));
    // El tema y la fuente siguen a la app aunque el complemento ya esté abierto.
    effect(() => {
      const payload = { theme: this.prefs.theme(), dyslexiaFont: this.prefs.dyslexiaFont(), language: this.prefs.language() };
      untracked(() => this.post('THEME_CHANGE', payload));
    });
  }

  async ngOnInit(): Promise<void> {
    const list = await this.api.refresh();
    this.loading.set(false);
    this.route.paramMap.subscribe((params) => {
      const wanted = params.get('slug');
      const target = list.find((c) => c.slug === wanted) ?? this.list()[0];
      if (!target) return;
      if (wanted !== target.slug) {
        void this.router.navigate(['/complements', target.slug], { replaceUrl: true });
        return;
      }
      void this.open(target);
    });
  }

  protected pick(c: ActiveComplement): void {
    void this.router.navigate(['/complements', c.slug]);
  }

  /** En mantenimiento o sin respuesta se muestra el aviso en vez del iframe. */
  protected blocked(c: ActiveComplement | null): 'maintenance' | 'down' | null {
    if (!c) return null;
    if (c.status === 'maintenance') return 'maintenance';
    if (c.circuit === 'OPEN') return 'down';
    return null;
  }

  private async open(c: ActiveComplement): Promise<void> {
    this.slug.set(c.slug);
    this.src.set(null);
    this.error.set(null);
    this.notice.set(null);
    this.disconnected.set(false);
    this.timestamps = [];
    if (this.blocked(c)) return;
    try {
      const { url, origin } = await this.api.embed(c.slug);
      if (this.slug() !== c.slug) return;
      this.origin.set(origin);
      this.src.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('comp.openError')));
    }
  }

  protected reload(): void {
    const c = this.current();
    if (c) void this.open(c);
  }

  protected fullscreen(): void {
    void this.frame()?.nativeElement.requestFullscreen?.();
  }

  /** Al cargar, el complemento recibe el contexto (como registerFrame del legacy). */
  protected onLoad(): void {
    this.post('CONTEXT_UPDATE', this.context());
  }

  private context(): Record<string, unknown> {
    const user = this.auth.user();
    return {
      // Sin datos sensibles (spec/11 §6): nombre de usuario y rol.
      user: user ? { username: user.username, role: user.role } : null,
      theme: this.prefs.theme(),
      dyslexiaFont: this.prefs.dyslexiaFont(),
      language: this.prefs.language(),
    };
  }

  private post(type: OutboundType, payload: Record<string, unknown>): void {
    const win = this.frame()?.nativeElement.contentWindow;
    if (!win || !this.origin() || this.disconnected()) return;
    win.postMessage({ type, version: 1, timestamp: Date.now(), payload }, this.origin());
  }

  private onMessage(event: MessageEvent): void {
    const win = this.frame()?.nativeElement.contentWindow;
    if (!win || event.source !== win || event.origin !== this.origin() || this.disconnected()) return;
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
    if (data.type === 'REQUEST_CONTEXT') {
      this.post('CONTEXT_UPDATE', this.context());
      return;
    }
    if (data.type === 'CREATE_ENTRY') void this.createEntry(data.payload ?? {});
  }

  private async createEntry(payload: Record<string, unknown>): Promise<void> {
    const slug = this.slug();
    const content = String(payload['content'] ?? '').trim();
    if (!slug || !content) return;
    const entryType = payload['entryType'] === 'incidente' ? 'incidente' : 'operativa';
    const tags = Array.isArray(payload['tags']) ? payload['tags'].map(String) : undefined;
    try {
      await this.api.createEntry(slug, { content, entryType, tags });
      this.notice.set(this.i18n.t('comp.entryCreated'));
    } catch (e) {
      this.notice.set(problemDetail(e, this.i18n.t('comp.entryError')));
    }
  }
}
