import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import type * as Leaflet from 'leaflet';
import { PublicLinksService, PublicTicket, PublicView } from '../../core/public-links/public-links.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { BrandingService } from '../../core/branding/branding.service';
import { formatDuration } from '../../core/tickets/ticket-view';
import { MapCanvasComponent, MapReady } from '../map/map-canvas';

import '../../core/i18n/packs/public-links';

type State = 'loading' | 'ready' | 'unavailable';

/** Las TV y el cliente dejan la página abierta: se actualiza sola. */
const REFRESH_MS = 60_000;
const CLOCK_MS = 15_000;
const SOON_MS = 2 * 3_600_000;
/** En la TV entran estos tickets; el resto se cuenta abajo. */
const TV_TICKETS = 12;

interface TicketRow extends PublicTicket {
  sla: string;
  tone: 'late' | 'soon' | 'ok' | 'hold';
}

/**
 * Enlaces públicos (10h, diseño aprobado por el dueño 2026-10-22): la página
 * sin sesión de `/p/v/:token`. Guardias, Ticketera y Mapa NOC en el tema
 * oscuro, para las TV de la sala; el estado de un cliente en el claro, para
 * mandárselo. El tema va en el propio componente (no cambia la preferencia
 * guardada en el navegador). Un enlace mal escrito, apagado o borrado
 * muestra lo mismo: «Este enlace no está disponible».
 */
@Component({
  selector: 'app-public-view',
  standalone: true,
  imports: [MapCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-view.html',
  styleUrl: './public-view.css',
  // Sin encapsular: los rótulos del mapa los crea Leaflet. Todo cuelga de .pv.
  encapsulation: ViewEncapsulation.None,
  host: { '[attr.data-theme]': 'theme()', class: 'pv' },
})
export class PublicViewComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(PublicLinksService);
  private readonly prefs = inject(PreferencesService);
  protected readonly brandTitle = inject(BrandingService).appTitle;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly state = signal<State>('loading');
  protected readonly view = signal<PublicView | null>(null);
  protected readonly stale = signal(false);
  protected readonly now = signal(Date.now());
  /** Diferencia con el reloj del servidor: la TV puede tener la hora corrida. */
  private skew = 0;
  private map: MapReady | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private fitted = false;

  protected readonly theme = computed(() => (this.view()?.kind === 'client' ? 'light' : 'dark'));
  protected readonly clock = computed(() => this.time(new Date(this.now())));
  protected readonly today = computed(() => new Date(this.now()).toLocaleDateString(this.locale(), { weekday: 'long', day: 'numeric', month: 'long' }));
  protected readonly updated = computed(() => {
    const v = this.view();
    return v ? this.time(new Date(v.generatedAt)) : '';
  });

  protected readonly tickets = computed<TicketRow[]>(() => {
    const now = this.now() + this.skew;
    return (this.view()?.tickets ?? []).map((t) => {
      if (t.onHold) return { ...t, sla: this.i18n.t('pv.onHold'), tone: 'hold' };
      if (!t.dueAt) return { ...t, sla: this.i18n.t('pv.noSla'), tone: 'ok' };
      const left = new Date(t.dueAt).getTime() - now;
      const text = formatDuration(left / 1000);
      if (left < 0) return { ...t, sla: this.i18n.tf('pv.overdue', text), tone: 'late' };
      return { ...t, sla: text, tone: left < SOON_MS ? 'soon' : 'ok' };
    });
  });
  protected readonly ticketsShown = computed(() => this.tickets().slice(0, TV_TICKETS));
  protected readonly ticketCounts = computed(() => {
    const rows = this.tickets();
    return {
      open: rows.length,
      unassigned: rows.filter((r) => !r.assignee).length,
      late: rows.filter((r) => r.tone === 'late').length,
      soon: rows.filter((r) => r.tone === 'soon').length,
    };
  });

  protected readonly client = computed(() => {
    const c = this.view()?.client;
    if (!c) return null;
    const incidents = c.services.filter((s) => s.incidentSince);
    const maintenance = c.services.filter((s) => !s.incidentSince && s.maintenanceUntil);
    const names = (list: { name: string }[]) => list.map((s) => s.name).join(', ');
    let tone: 'ok' | 'incident' | 'maintenance' = 'ok';
    let title = this.i18n.t('pv.client.ok');
    let lead = this.i18n.t('pv.client.quiet');
    if (incidents.length) {
      tone = 'incident';
      title = incidents.length === 1 ? this.i18n.t('pv.client.incident') : this.i18n.tf('pv.client.incidents', incidents.length);
      lead = this.i18n.tf(incidents.length === c.services.length ? 'pv.client.workingAll' : 'pv.client.working', names(incidents));
    } else if (maintenance.length) {
      tone = 'maintenance';
      title = this.i18n.t('pv.client.maintenance');
      lead = this.i18n.tf('pv.client.maintenanceText', names(maintenance));
    }
    return {
      ...c,
      tone,
      title,
      lead,
      services: c.services.map((s) => ({
        name: s.name,
        tone: s.incidentSince ? 'incident' : s.maintenanceUntil ? 'maintenance' : 'ok',
        state: s.incidentSince
          ? this.i18n.tf('pv.client.stateIncident', this.time(new Date(s.incidentSince)))
          : s.maintenanceUntil
            ? this.i18n.tf('pv.client.stateMaintenance', this.time(new Date(s.maintenanceUntil)))
            : this.i18n.t('pv.client.stateOk'),
      })),
      windows: c.windows.map((w) => ({
        title: w.title,
        when: `${this.day(w.startsAt)}, ${this.time(new Date(w.startsAt))} – ${this.time(new Date(w.endsAt))}`,
        affects: this.i18n.tf('pv.client.affects', w.service || this.i18n.t('pv.client.allServices')),
      })),
      recent: c.recent.map((r) => ({
        title: this.i18n.tf('pv.client.resolved', r.service),
        when: `${this.day(r.openedAt)}, ${this.time(new Date(r.openedAt))} – ${this.time(new Date(r.closedAt))}`,
        lasted: this.i18n.tf('pv.client.lasted', formatDuration((new Date(r.closedAt).getTime() - new Date(r.openedAt).getTime()) / 1000)),
      })),
    };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    void this.load();
    const refresh = setInterval(() => void this.load(), REFRESH_MS);
    const tick = setInterval(() => this.now.set(Date.now()), CLOCK_MS);
    destroyRef.onDestroy(() => {
      clearInterval(refresh);
      clearInterval(tick);
    });
    // El mapa se vuelve a pintar con cada actualización.
    effect(() => {
      this.view();
      this.drawMap();
    });
  }

  /** «hoy 20:00», «mañana 08:00» o «el lunes 09:00». */
  protected when(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const days = Math.round((startOfDay(d) - startOfDay(new Date(this.now()))) / 86_400_000);
    const time = this.time(d);
    const en = this.prefs.language() === 'en';
    if (days === 0) return `${en ? 'today' : 'hoy'} ${time}`;
    if (days === 1) return `${en ? 'tomorrow' : 'mañana'} ${time}`;
    return `${d.toLocaleDateString(this.locale(), days < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' })} ${time}`;
  }

  protected time(d: Date): string {
    return d.toLocaleTimeString(this.locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  private day(iso: string): string {
    return new Date(iso).toLocaleDateString(this.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  private locale(): string {
    return this.prefs.language() === 'en' ? 'en-US' : 'es-CL';
  }

  private async load(): Promise<void> {
    try {
      const v = await this.api.view(this.token);
      this.skew = new Date(v.generatedAt).getTime() - Date.now();
      this.view.set(v);
      this.state.set('ready');
      this.stale.set(false);
      this.now.set(Date.now());
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) {
        this.state.set('unavailable');
        this.view.set(null);
      } else if (this.state() === 'ready') {
        this.stale.set(true); // la TV sigue mostrando lo último y lo dice
      } else {
        this.state.set('unavailable');
      }
    }
  }

  protected onMapReady(ready: MapReady): void {
    this.map = ready;
    this.layer = ready.L.layerGroup().addTo(ready.map);
    this.drawMap();
  }

  private drawMap(): void {
    const data = this.view()?.map;
    if (!this.map || !this.layer || !data) return;
    const { L, map, renderer } = this.map;
    const css = getComputedStyle(this.host.nativeElement);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const bad = color('--status-critical');
    const warn = color('--status-warning');
    const dot = color('--text-muted');
    const ring = color('--bg-app');
    this.layer.clearLayers();
    const quiet = data.points.filter((p) => !p.openIncidents && !p.maintenanceUntil);
    const flagged = data.points.filter((p) => p.openIncidents || p.maintenanceUntil);
    for (const p of quiet) {
      L.circleMarker([p.latitude, p.longitude], { renderer, radius: 4, color: dot, weight: 1, fillColor: dot, fillOpacity: 0.5, interactive: false }).addTo(this.layer);
    }
    for (const p of flagged) {
      const fill = p.openIncidents ? bad : warn;
      L.circleMarker([p.latitude, p.longitude], { renderer, radius: 18, stroke: false, fillColor: fill, fillOpacity: 0.2, interactive: false }).addTo(this.layer);
      L.circleMarker([p.latitude, p.longitude], { renderer, radius: 9, color: ring, weight: 3, fillColor: fill, fillOpacity: 1, interactive: false })
        .bindTooltip(p.name, { permanent: true, direction: 'right', offset: [12, 0], className: 'pv__map-label' })
        .addTo(this.layer);
    }
    if (!this.fitted && data.points.length) {
      this.fitted = true;
      map.fitBounds(L.latLngBounds(data.points.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [48, 48], maxZoom: 9 });
    }
  }
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
