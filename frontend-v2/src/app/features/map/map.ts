import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import type * as Leaflet from 'leaflet';
import { MapService } from '../../core/map/map.service';
import { MapPoint, MapTiles, MapUnitDetail } from '../../core/map/map.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { PRIORITY_SHORT, PRIORITY_TONE } from '../../core/tickets/ticket-view';
import { TicketPriority } from '../../core/tickets/tickets.service';
import { problemDetail } from '../../core/http-error';
import { MapCanvasComponent, MapReady, cssVar } from './map-canvas';

import '../../core/i18n/packs/map';

type Tone = 'bad' | 'warn' | 'ticket';

const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, ticket: 2 };

/** Cada 60 s, y solo con la pestaña a la vista: el mapa no trabaja de fondo. */
const REFRESH_MS = 60_000;

/**
 * Mapa (#24, diseño aprobado el 2026-10-14): las localidades del Territorio
 * en un mapa y, a la derecha, los sectores a revisar: incidentes de
 * escalamiento abiertos (rojo) y ventanas de mantenimiento activas (ámbar).
 * Elegir una muestra quién la cubre y lleva a Escalamiento. Módulo NOC.
 */
@Component({
  selector: 'app-map',
  standalone: true,
  imports: [MatIconModule, RouterLink, MapCanvasComponent],
  templateUrl: './map.html',
  styleUrl: './map.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(MapService);
  private readonly prefs = inject(PreferencesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly features = inject(SystemFeaturesService);
  /** La capa de tickets solo existe con la Ticketera encendida. */
  protected readonly ticketsOn = computed(() => this.features.isEnabled('native_tickets'));
  protected readonly priorityShort = PRIORITY_SHORT as Record<string, string>;
  protected readonly priorityTone = PRIORITY_TONE as Record<string, string>;

  protected readonly points = signal<MapPoint[]>([]);
  protected readonly tiles = signal<MapTiles | null>(null);
  protected readonly showAll = signal(false);
  protected readonly showIncidents = signal(true);
  protected readonly showMaintenance = signal(true);
  protected readonly showTickets = signal(true);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<MapUnitDetail | null>(null);
  protected readonly error = signal('');
  protected readonly loaded = signal(false);

  private readonly ready = signal<MapReady | null>(null);
  private layer: Leaflet.LayerGroup | null = null;
  private fitted = false;

  /** Manda lo más grave entre las capas encendidas: incidente (rojo), mantenimiento (ámbar), ticket (azul). */
  protected tone(p: MapPoint): Tone | null {
    if (p.openIncidents > 0 && this.showIncidents()) return 'bad';
    if (p.maintenanceUntil && this.showMaintenance()) return 'warn';
    if (p.openTickets > 0 && this.showTickets() && this.ticketsOn()) return 'ticket';
    return null;
  }

  /** Lo que hay en la localidad según las capas encendidas (para la lista). */
  protected marks(p: MapPoint): { tone: Tone; text: string }[] {
    const out: { tone: Tone; text: string }[] = [];
    if (p.openIncidents > 0 && this.showIncidents()) out.push({ tone: 'bad', text: this.i18n.tf(p.openIncidents === 1 ? 'map.incidentOne' : 'map.incidentMany', p.openIncidents) });
    if (p.maintenanceUntil && this.showMaintenance()) out.push({ tone: 'warn', text: this.i18n.t('map.maintenance') });
    if (p.openTickets > 0 && this.showTickets() && this.ticketsOn()) out.push({ tone: 'ticket', text: this.i18n.tf(p.openTickets === 1 ? 'map.ticketOne' : 'map.ticketMany', p.openTickets) });
    return out;
  }

  /** Clase de la píldora: el azul de ticket es el tono «info». */
  protected pillTone(tone: Tone): string {
    return tone === 'ticket' ? 'info' : tone;
  }

  /** La línea gris de la fila: lo más grave que haya. */
  protected what(p: MapPoint): string {
    const tone = this.tone(p);
    return (tone === 'bad' ? p.lastIncidentTitle : tone === 'warn' ? p.maintenanceTitle : p.lastTicketTitle) ?? '';
  }

  protected readonly review = computed(() =>
    this.points()
      .filter((p) => this.tone(p))
      .sort((a, b) => TONE_ORDER[this.tone(a) as Tone] - TONE_ORDER[this.tone(b) as Tone] || a.name.localeCompare(b.name)),
  );
  protected readonly selected = computed(() => this.points().find((p) => p.id === this.selectedId()) ?? null);
  protected readonly shownCount = computed(() => (this.showAll() ? this.points().length : this.review().length));

  constructor() {
    effect(() => {
      // Redibuja con cada cambio de datos, filtros, selección o tema.
      this.points();
      this.showAll();
      this.review();
      this.selectedId();
      this.prefs.theme();
      this.draw();
    });
  }

  async ngOnInit(): Promise<void> {
    this.api.tiles().then((t) => this.tiles.set(t), () => this.tiles.set({ mode: 'osm', url: '' }));
    await this.refresh();
    // Desde un ticket («Ver en el mapa»): abre esa localidad.
    const fromLink = this.route.snapshot.queryParamMap.get('unitId');
    const linked = fromLink ? this.points().find((p) => p.id === fromLink) : undefined;
    if (linked) this.select(linked, true);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void this.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  protected async refresh(): Promise<void> {
    try {
      this.points.set(await this.api.points());
      this.error.set('');
      const id = this.selectedId();
      if (id) void this.loadDetail(id);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('map.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected onReady(ready: MapReady): void {
    this.layer = ready.L.layerGroup().addTo(ready.map);
    // Llegó desde un ticket con la localidad ya elegida: el mapa abre ahí.
    const p = this.selected();
    if (p) {
      this.fitted = true;
      ready.map.setView([p.latitude, p.longitude], 8);
    }
    this.ready.set(ready);
  }

  protected select(p: MapPoint, fly: boolean): void {
    this.selectedId.set(p.id);
    this.detail.set(null);
    void this.loadDetail(p.id);
    const ready = this.ready();
    if (fly && ready) {
      const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
      ready.map.flyTo([p.latitude, p.longitude], Math.max(ready.map.getZoom(), 8), { duration: instant ? 0 : 0.8, animate: !instant });
    }
  }

  protected clearSelection(): void {
    this.selectedId.set(null);
    this.detail.set(null);
  }

  private async loadDetail(id: string): Promise<void> {
    try {
      const d = await this.api.unit(id);
      if (this.selectedId() === id) this.detail.set(d);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('map.loadError')));
    }
  }

  private draw(): void {
    const ready = this.ready();
    const layer = this.layer;
    if (!ready || !layer) return;
    const { L, map, renderer } = ready;
    layer.clearLayers();
    const colors = { bad: cssVar('--status-critical'), warn: cssVar('--status-warning'), ticket: cssVar('--status-carrier'), dot: cssVar('--text-muted'), ring: cssVar('--bg-surface'), accent: cssVar('--accent') };
    const flagged: MapPoint[] = [];
    for (const p of this.points()) {
      if (this.tone(p)) {
        flagged.push(p);
      } else if (this.showAll()) {
        L.circleMarker([p.latitude, p.longitude], { renderer, radius: 3.5, color: colors.dot, weight: 1, fillColor: colors.dot, fillOpacity: 0.55 })
          .bindTooltip(p.name, { direction: 'top', offset: [0, -4] })
          .on('click', () => this.select(p, false))
          .addTo(layer);
      }
    }
    // Los marcados van al final: quedan encima de los grises.
    for (const p of flagged) {
      const color = colors[this.tone(p) as Tone];
      const isSelected = p.id === this.selectedId();
      L.circleMarker([p.latitude, p.longitude], { renderer, radius: isSelected ? 15 : 12, stroke: false, fillColor: color, fillOpacity: 0.18, interactive: false }).addTo(layer);
      L.circleMarker([p.latitude, p.longitude], { renderer, radius: 6.5, color: isSelected ? colors.accent : colors.ring, weight: isSelected ? 3 : 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(p.name, { direction: 'top', offset: [0, -6] })
        .on('click', () => this.select(p, false))
        .addTo(layer);
    }
    if (!this.fitted && this.points().length && !this.selectedId()) {
      this.fitted = true;
      map.fitBounds(L.latLngBounds(this.points().map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [24, 24], maxZoom: 9 });
    }
  }

  /** "08:42" si es de hoy; si no, "13-10 08:42". */
  protected when(iso: string): string {
    const d = new Date(iso);
    const locale = this.prefs.language() === 'en' ? 'en-GB' : 'es-CL';
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return time;
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) + ' ' + time;
  }
}
