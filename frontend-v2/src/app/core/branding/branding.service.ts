import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Las 6 paletas del correo de incidente del legacy (incidentReport.js). */
export const INCIDENT_PALETTES = ['cdc-verde', 'noche-azul', 'slate-pro', 'carbon', 'indigo', 'bosque'] as const;
export type IncidentPalette = (typeof INCIDENT_PALETTES)[number];

/** Color de encabezado de cada paleta (mismos valores del legacy). */
export const PALETTE_HEADER: Record<IncidentPalette, string> = {
  'cdc-verde': '#155F50',
  'noche-azul': '#1B3A5C',
  'slate-pro': '#2E3D56',
  carbon: '#2D2D2D',
  indigo: '#2D2080',
  bosque: '#2D4A33',
};

export interface Branding {
  appTitle: string;
  hasLogo: boolean;
  logoName?: string;
  hasFavicon: boolean;
  faviconUrl?: string;
  titleFont: 'inter' | 'custom';
  fontName?: string;
  incidentPalette: IncidentPalette;
  bulletinColor: string;
  loginTheme?: string;
  version: number;
  updatedAt?: string;
}

const DEFAULT: Branding = { appTitle: 'Bitácora Ops', hasLogo: false, hasFavicon: false, titleFont: 'inter', incidentPalette: 'cdc-verde', bulletinColor: '#EF5350', version: 0 };

/**
 * Marca de la instalación (comentario del dueño #8): nombre en la barra, el
 * login y la pestaña; favicon (el propio, el externo o el logo); y la fuente
 * del título. Se aplica al cargar y cada vez que llega "config.branding.updated"
 * por SSE, así un cambio se ve al instante en todas las pestañas.
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);

  readonly brand = signal<Branding>(DEFAULT);
  readonly appTitle = computed(() => this.brand().appTitle);
  /** URL del logo con la versión, para que el navegador no muestre uno viejo. */
  readonly logoUrl = computed(() => (this.brand().hasLogo ? `/api/branding/logo?v=${this.brand().version}` : null));
  private loading: Promise<void> | null = null;

  /** Carga la marca una vez (la API es pública: sirve también para el login). */
  load(): Promise<void> {
    this.loading ??= this.refresh();
    return this.loading;
  }

  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<Branding>>('/api/branding'));
      this.apply(res.data);
    } catch {
      this.apply(this.brand());
    }
  }

  /** Aplica una marca recibida (respuesta de un cambio o aviso por SSE). */
  apply(brand: Branding): void {
    this.brand.set({ ...DEFAULT, ...brand });
    const b = this.brand();
    this.title.setTitle(b.appTitle);
    this.setFavicon(b);
    this.setTitleFont(b);
  }

  private setFavicon(b: Branding): void {
    const href = b.faviconUrl || (b.hasFavicon || b.hasLogo ? `/api/branding/favicon?v=${b.version}` : 'favicon.ico');
    let link = this.document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'icon';
      this.document.head.appendChild(link);
    }
    link.removeAttribute('type');
    link.href = href;
  }

  private setTitleFont(b: Branding): void {
    const root = this.document.documentElement;
    let style = this.document.getElementById('brand-font') as HTMLStyleElement | null;
    if (b.titleFont !== 'custom') {
      style?.remove();
      root.style.removeProperty('--app-title-font');
      return;
    }
    if (!style) {
      style = this.document.createElement('style');
      style.id = 'brand-font';
      this.document.head.appendChild(style);
    }
    style.textContent = `@font-face { font-family: 'BrandTitle'; src: url('/api/branding/font?v=${b.version}'); font-display: swap; }`;
    root.style.setProperty('--app-title-font', `'BrandTitle', var(--font-ui)`);
  }

  async update(patch: Partial<Pick<Branding, 'appTitle' | 'titleFont' | 'incidentPalette' | 'bulletinColor' | 'loginTheme' | 'faviconUrl'>>): Promise<Branding> {
    const res = await firstValueFrom(this.http.patch<ApiEnvelope<Branding>>('/api/branding', patch));
    this.apply(res.data);
    return res.data;
  }

  /** Sube el logo, el favicon o la fuente del título. */
  async upload(kind: 'logo' | 'favicon' | 'font', file: File): Promise<Branding> {
    const form = new FormData();
    form.append('file', file);
    const res = await firstValueFrom(this.http.put<ApiEnvelope<Branding>>(`/api/branding/${kind}`, form));
    this.apply(res.data);
    return res.data;
  }

  async remove(kind: 'logo' | 'favicon' | 'font'): Promise<Branding> {
    const res = await firstValueFrom(this.http.delete<ApiEnvelope<Branding>>(`/api/branding/${kind}`));
    this.apply(res.data);
    return res.data;
  }
}
