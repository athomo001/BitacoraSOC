import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import type * as Leaflet from 'leaflet';
import { MapService } from '../../core/map/map.service';
import { MapAsset, MapAssetStatus, MapPoint, MapSpot, MapTiles, MapUnitDetail } from '../../core/map/map.models';
import { affected, groupSpots, reasons, spotTitle, spotTone, tipElement } from './asset-layer';
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
  /** Capa «Equipos»: los del Inventario con coordenadas, agrupados por punto. */
  protected readonly assets = signal<MapAsset[]>([]);
  protected readonly showAssets = signal(true);
  /** Cliente: '' todos, 'internal' los sin cliente, o el id del cliente. */
  protected readonly clientFilter = signal('');
  protected readonly clientOptions = computed(() => {
    const byId = new Map<string, string>();
    for (const a of this.assets()) if (a.clientId) byId.set(a.clientId, a.clientName ?? '');
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly spotTitle = spotTitle;
  protected readonly spotTone = spotTone;
  protected readonly selectedSpot = signal<string | null>(null);
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
  protected readonly spots = computed<MapSpot[]>(() => {
    const c = this.clientFilter();
    return groupSpots(this.assets().filter((a) => !c || (c === 'internal' ? !a.clientId : a.clientId === c)));
  });
  /** Los puntos con equipos afectados o en mantenimiento también van a «revisar». */
  protected readonly reviewSpots = computed(() =>
    this.showAssets()
      ? this.spots().filter((s) => spotTone(s) !== 'ok').sort((a, b) => (spotTone(a) === 'bad' ? 0 : 1) - (spotTone(b) === 'bad' ? 0 : 1) || spotTitle(a).localeCompare(spotTitle(b)))
      : [],
  );
  protected readonly spot = computed(() => this.spots().find((s) => s.key === this.selectedSpot()) ?? null);
  protected readonly shownCount = computed(() => (this.showAll() ? this.points().length : this.review().length));

  constructor() {
    effect(() => {
      // Redibuja con cada cambio de datos, filtros, selección o tema.
      this.points();
      this.showAll();
      this.review();
      this.selectedId();
      this.spots();
      this.showAssets();
      this.selectedSpot();
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
    // Desde el Inventario («Ver en el mapa»): el punto de ese equipo.
    const assetLink = this.route.snapshot.queryParamMap.get('assetId');
    const spot = assetLink ? this.spots().find((s) => s.assets.some((a) => a.id === assetLink)) : undefined;
    if (spot) this.selectSpot(spot, true);
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
      const [points, assets] = await Promise.all([this.api.points(), this.api.assets().catch(() => [])]);
      this.points.set(points);
      this.assets.set(assets);
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
    const p = this.selected() ?? this.spot();
    if (p) {
      this.fitted = true;
      ready.map.setView([p.latitude, p.longitude], this.spot() ? 14 : 8);
    }
    this.ready.set(ready);
  }

  protected select(p: MapPoint, fly: boolean): void {
    this.selectedSpot.set(null);
    this.selectedId.set(p.id);
    this.detail.set(null);
    void this.loadDetail(p.id);
    const ready = this.ready();
    if (fly && ready) {
      const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
      ready.map.flyTo([p.latitude, p.longitude], Math.max(ready.map.getZoom(), 8), { duration: instant ? 0 : 0.8, animate: !instant });
    }
  }

  /** Un punto con equipos: la lista de lo que hay ahí, con su enlace al Inventario. */
  protected selectSpot(s: MapSpot, fly: boolean): void {
    this.selectedId.set(null);
    this.detail.set(null);
    this.selectedSpot.set(s.key);
    const ready = this.ready();
    if (fly && ready) {
      const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
      ready.map.flyTo([s.latitude, s.longitude], Math.max(ready.map.getZoom(), 14), { duration: instant ? 0 : 0.8, animate: !instant });
    }
  }

  /** Elegir un cliente: solo sus equipos, y el mapa se acerca a ellos. */
  protected setClient(value: string): void {
    this.clientFilter.set(value);
    this.selectedSpot.set(null);
    const ready = this.ready();
    const spots = this.spots();
    if (ready && spots.length) {
      ready.map.fitBounds(ready.L.latLngBounds(spots.map((s) => [s.latitude, s.longitude] as [number, number])), { padding: [32, 32], maxZoom: 14 });
    }
  }

  protected reasonsOf(a: MapAsset) {
    return reasons(a, this.i18n, (iso) => this.when(iso));
  }

  /** «2 de 5 equipos afectados» o el primer motivo, para la fila de «revisar». */
  protected spotWhat(s: MapSpot): string {
    const hit = affected(s);
    return hit.length === 1 ? this.reasonsOf(hit[0])[0]?.text ?? '' : this.i18n.tf('map.assetsAffected', hit.length);
  }

  protected spotCount(s: MapSpot): string {
    return this.i18n.tf(s.assets.length === 1 ? 'map.assetOne' : 'map.assetMany', s.assets.length);
  }

  protected clearSelection(): void {
    this.selectedSpot.set(null);
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
    const colors = { bad: cssVar('--status-critical'), warn: cssVar('--status-warning'), ticket: cssVar('--status-carrier'), ok: cssVar('--status-ok'), dot: cssVar('--text-muted'), ring: cssVar('--bg-surface'), accent: cssVar('--accent') };
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
    // Los equipos: verdes encima de las localidades tranquilas, los afectados
    // con un halo como las localidades marcadas.
    if (this.showAssets()) {
      const tones: Record<MapAssetStatus, string> = { ok: colors.ok, warn: colors.warn, bad: colors.bad };
      const spots = [...this.spots()].sort((a, b) => (spotTone(a) === 'ok' ? 0 : 1) - (spotTone(b) === 'ok' ? 0 : 1));
      for (const s of spots) {
        const tone = spotTone(s);
        const isSelected = s.key === this.selectedSpot();
        if (tone !== 'ok') {
          L.circleMarker([s.latitude, s.longitude], { renderer, radius: isSelected ? 14 : 11, stroke: false, fillColor: tones[tone], fillOpacity: 0.18, interactive: false }).addTo(layer);
        }
        L.circleMarker([s.latitude, s.longitude], { renderer, radius: isSelected ? 7 : tone === 'ok' ? 5 : 6, color: isSelected ? colors.accent : colors.ring, weight: isSelected ? 3 : 1.5, fillColor: tones[tone], fillOpacity: 1 })
          .bindTooltip(() => tipElement(s, this.i18n, (iso) => this.when(iso)), { direction: 'top', offset: [0, -6], className: 'mp-tip' })
          .on('click', () => this.selectSpot(s, false))
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
    const all = [...this.points(), ...(this.showAssets() ? this.spots() : [])];
    if (!this.fitted && all.length && !this.selectedId() && !this.selectedSpot()) {
      this.fitted = true;
      map.fitBounds(L.latLngBounds(all.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [24, 24], maxZoom: 9 });
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
