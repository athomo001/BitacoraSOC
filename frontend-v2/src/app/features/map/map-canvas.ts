import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type * as Leaflet from 'leaflet';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { MapTiles } from '../../core/map/map.models';

export type LeafletNs = typeof Leaflet;

/** Lo que recibe la pantalla cuando el mapa está listo para dibujar. */
export interface MapReady {
  L: LeafletNs;
  map: Leaflet.Map;
  /** Un solo lienzo para todos los puntos: cientos de puntos sin trabar el navegador. */
  renderer: Leaflet.Canvas;
}

export const OSM_TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
/** Siluetas de los países (Natural Earth 1:110m, dominio público) para el fondo sin mosaicos. */
const COUNTRIES_URL = '/map/countries-110m.json';

type Polygons = [number, number][][][];

let leaflet: Promise<LeafletNs> | null = null;

/** Leaflet (~42 kB comprimido) se descarga recién al abrir un mapa, una sola vez. */
export function loadLeaflet(): Promise<LeafletNs> {
  leaflet ??= import('leaflet/dist/leaflet-src.esm.js');
  return leaflet;
}

/** Color de un token del tema activo (Leaflet pinta en canvas y necesita el valor). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Mapa base del Mapa (#24) y de Administración → Territorio: carga Leaflet
 * bajo demanda, pone el fondo que eligió el admin (OSM, servidor propio o
 * solo las siluetas) y se ajusta solo al tamaño. Lo que se dibuja encima lo
 * pone cada pantalla con lo que emite `ready`.
 */
@Component({
  selector: 'app-map-canvas',
  standalone: true,
  template: '',
  styleUrl: './map-canvas.css',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'map-canvas' },
})
export class MapCanvasComponent {
  readonly tiles = input<MapTiles | null>(null);
  readonly label = input('');
  readonly ready = output<MapReady>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly http = inject(HttpClient);
  private readonly prefs = inject(PreferencesService);
  private state: MapReady | null = null;
  private landRenderer: Leaflet.Canvas | null = null;
  private background: Leaflet.Layer | null = null;
  private countries: Polygons[] | null = null;
  private destroyed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => (this.destroyed = true));
    afterNextRender(() => void this.init(destroyRef));
    // Cambia el fondo elegido o el tema (las siluetas usan sus colores).
    effect(() => {
      const tiles = this.tiles();
      this.prefs.theme();
      if (this.state) void this.applyBackground(tiles);
    });
  }

  private async init(destroyRef: DestroyRef): Promise<void> {
    const L = await loadLeaflet();
    if (this.destroyed) return;
    const host = this.host.nativeElement;
    const el = document.createElement('div');
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', this.label());
    host.appendChild(el);
    const map = L.map(el, { preferCanvas: true, minZoom: 2, maxZoom: 17, worldCopyJump: true }).setView([0, 0], 2);
    map.attributionControl.setPrefix(false);
    // El fondo va en su propio panel, debajo de los puntos aunque se vuelva a pintar después.
    map.createPane('land').style.zIndex = '250';
    this.landRenderer = L.canvas({ pane: 'land' });
    this.state = { L, map, renderer: L.canvas({ padding: 0.5 }) };
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(host);
    destroyRef.onDestroy(() => {
      resize.disconnect();
      map.remove();
    });
    await this.applyBackground(this.tiles());
    if (!this.destroyed) this.ready.emit(this.state);
  }

  private async applyBackground(tiles: MapTiles | null): Promise<void> {
    const state = this.state;
    if (!state || !tiles) return;
    const { L, map } = state;
    if (this.background) map.removeLayer(this.background);
    this.background = null;
    if (tiles.mode === 'none') {
      this.countries ??= await firstValueFrom(this.http.get<Polygons[]>(COUNTRIES_URL)).catch(() => []);
      const style = { renderer: this.landRenderer ?? undefined, interactive: false, color: cssVar('--map-border'), weight: 0.8, fillColor: cssVar('--map-land'), fillOpacity: 1 };
      this.background = L.layerGroup(this.countries.map((country) => L.polygon(country, style))).addTo(map);
      return;
    }
    const url = tiles.mode === 'custom' && tiles.url ? tiles.url : OSM_TILES_URL;
    this.background = L.tileLayer(url, { maxZoom: 19, attribution: tiles.mode === 'osm' ? OSM_ATTRIBUTION : '' }).addTo(map);
  }
}
