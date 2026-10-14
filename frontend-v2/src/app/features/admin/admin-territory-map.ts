import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type * as Leaflet from 'leaflet';
import { MapService } from '../../core/map/map.service';
import { MapTiles, MapTilesMode } from '../../core/map/map.models';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { MapCanvasComponent, MapReady, cssVar } from '../map/map-canvas';

import '../../core/i18n/packs/map';

const MODES: { mode: MapTilesMode; label: MessageKey; hint: MessageKey }[] = [
  { mode: 'osm', label: 'mapAdmin.osm', hint: 'mapAdmin.osmHint' },
  { mode: 'custom', label: 'mapAdmin.custom', hint: 'mapAdmin.customHint' },
  { mode: 'none', label: 'mapAdmin.none', hint: 'mapAdmin.noneHint' },
];

/** La lista se corta acá; el resto se encuentra con el buscador del árbol. */
const MAX_LISTED = 40;

/**
 * Administración → Territorio, parte del Mapa (#24, diseño aprobado el
 * 2026-10-14): de dónde sale el fondo y las localidades activas que todavía
 * no tienen coordenadas, para ubicarlas con un clic en el mapa.
 */
@Component({
  selector: 'app-admin-territory-map',
  standalone: true,
  imports: [MatIconModule, MapCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>layers</mat-icon>{{ i18n.t('mapAdmin.tiles') }}</h3></div>
      <div class="adm-card__body tm__opts">
        @for (m of modes; track m.mode) {
          <button type="button" class="tm__opt" [attr.aria-pressed]="draft().mode === m.mode" (click)="setMode(m.mode)">
            <mat-icon>{{ draft().mode === m.mode ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>
            <span><b>{{ i18n.t(m.label) }}</b><span class="adm-hint">{{ i18n.t(m.hint) }}</span></span>
          </button>
        }
        @if (draft().mode === 'custom') {
          <label class="adm-field">
            <span class="adm-label">{{ i18n.t('mapAdmin.url') }}</span>
            <input class="adm-input mono" name="tilesUrl" [value]="draft().url" (input)="setUrl($any($event.target).value)" />
            <span class="adm-hint">{{ i18n.t('mapAdmin.urlHint') }}</span>
          </label>
        }
        <div class="tm__actions">
          <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy()" (click)="saveTiles()"><mat-icon>save</mat-icon>{{ i18n.t('mapAdmin.save') }}</button>
          @if (tilesNotice(); as n) { <span class="pill tone-ok" role="status">{{ n }}</span> }
        </div>
      </div>
    </section>

    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>wrong_location</mat-icon>{{ i18n.t('mapAdmin.missing') }}</h3>
        <span class="pill mono" [class.tone-warn]="missing().length > 0">{{ missing().length }}</span>
        @if (notice(); as n) { <span class="pill tone-ok adm-push" role="status">{{ n }}</span> }
      </div>
      @if (error(); as e) { <p class="adm-error tm__error" role="alert">{{ e }}</p> }
      <div class="tm__grid">
        <div class="tm__list">
          @for (u of listed(); track u.id) {
            <button type="button" class="tm__row" [attr.aria-pressed]="placing()?.id === u.id" (click)="togglePlacing(u)">
              <span class="tm__name">{{ u.name }}<span class="adm-small adm-secondary"> · {{ territory.kindLabel(u.kind) }}</span></span>
              <span class="pill" [class.tone-warn]="placing()?.id !== u.id">{{ i18n.t(placing()?.id === u.id ? 'mapAdmin.clickMap' : 'mapAdmin.place') }}</span>
            </button>
          } @empty {
            <p class="adm-empty">{{ i18n.t('mapAdmin.allPlaced') }}</p>
          }
          @if (missing().length > listed().length) {
            <p class="adm-hint tm__more">{{ i18n.tf('mapAdmin.more', missing().length - listed().length) }}</p>
          }
          <p class="adm-hint tm__more">{{ i18n.t('mapAdmin.missingHint') }}</p>
        </div>
        <div class="tm__mapwrap">
          <app-map-canvas class="tm__map" [class.map-canvas--crosshair]="!!placing()" [tiles]="saved()" [label]="i18n.t('mapAdmin.missing')" (ready)="onReady($event)" />
          @if (placing(); as p) { <span class="tm__placing"><mat-icon>ads_click</mat-icon>{{ i18n.tf('mapAdmin.placing', p.name) }}</span> }
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 16px; align-items: start; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tm__opts { display: flex; flex-direction: column; gap: 8px; }
    .tm__opt { display: flex; gap: 10px; align-items: flex-start; width: 100%; padding: 10px 12px; border: 2px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .tm__opt[aria-pressed="true"] { border-color: var(--accent); }
    .tm__opt[aria-pressed="true"] mat-icon { color: var(--accent); }
    .tm__opt b { display: block; margin-bottom: 2px; }
    .tm__actions { display: flex; align-items: center; gap: 8px; }
    .tm__error { padding: 10px 14px 0; }
    .tm__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); min-height: 360px; }
    .tm__list { max-height: 400px; overflow: auto; border-right: 1px solid var(--border-subtle); }
    .tm__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 14px; border: none; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .tm__row:hover { background: var(--bg-surface-hover); }
    .tm__row[aria-pressed="true"] { background: var(--accent-soft); }
    .tm__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tm__more { padding: 8px 14px; margin: 0; }
    .tm__mapwrap { position: relative; display: flex; min-height: 360px; }
    .tm__map { flex: 1; }
    .tm__placing { position: absolute; top: 10px; left: 50%; z-index: 1000; display: inline-flex; align-items: center; gap: 6px; max-width: calc(100% - 20px); padding: 5px 12px; transform: translateX(-50%); border-radius: var(--radius-pill); background: var(--accent); color: var(--accent-contrast); font-size: 11.5px; font-weight: 600; }
    @media (width <= 1100px) { :host, .tm__grid { grid-template-columns: minmax(0, 1fr); } .tm__list { border-right: none; } }
  `,
})
export class AdminTerritoryMapComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly territory = inject(TerritoryService);
  private readonly api = inject(MapService);
  private readonly prefs = inject(PreferencesService);

  /** Las filas del árbol de Territorio (las mismas que ya cargó la pantalla). */
  readonly units = input<TerritorialUnit[]>([]);
  readonly placed = output<TerritorialUnit>();

  protected readonly modes = MODES;
  protected readonly saved = signal<MapTiles | null>(null);
  protected readonly draft = signal<MapTiles>({ mode: 'osm', url: '' });
  protected readonly busy = signal(false);
  protected readonly tilesNotice = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly placing = signal<TerritorialUnit | null>(null);
  private readonly ready = signal<MapReady | null>(null);
  private layer: Leaflet.LayerGroup | null = null;

  /** Activas sin coordenadas; el país no se ubica (es un área, no un punto). */
  protected readonly missing = computed(() => this.units().filter((u) => u.active && u.kind !== 'country' && (u.latitude == null || u.longitude == null)));
  protected readonly listed = computed(() => this.missing().slice(0, MAX_LISTED));

  constructor() {
    // Las ya ubicadas, de referencia, en gris; se redibujan con el tema.
    effect(() => {
      const ready = this.ready();
      const units = this.units();
      this.prefs.theme();
      if (!ready || !this.layer) return;
      this.layer.clearLayers();
      const color = cssVar('--text-muted');
      for (const u of units) {
        if (u.latitude == null || u.longitude == null || u.kind === 'country') continue;
        ready.L.circleMarker([u.latitude, u.longitude], { renderer: ready.renderer, radius: 3, color, weight: 1, fillColor: color, fillOpacity: 0.5 })
          .bindTooltip(u.name, { direction: 'top', offset: [0, -4] })
          .addTo(this.layer);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const tiles = await this.api.tiles();
      this.saved.set(tiles);
      this.draft.set(tiles);
    } catch {
      this.saved.set({ mode: 'osm', url: '' });
    }
  }

  protected setMode(mode: MapTilesMode): void {
    this.draft.update((d) => ({ ...d, mode }));
  }

  protected setUrl(url: string): void {
    this.draft.update((d) => ({ ...d, url }));
  }

  protected async saveTiles(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.tilesNotice.set(null);
    try {
      const tiles = await this.api.saveTiles(this.draft());
      this.saved.set(tiles);
      this.draft.set(tiles);
      this.tilesNotice.set(this.i18n.t('mapAdmin.saved'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mapAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }

  protected togglePlacing(u: TerritorialUnit): void {
    this.placing.set(this.placing()?.id === u.id ? null : u);
    this.notice.set(null);
  }

  protected onReady(ready: MapReady): void {
    this.layer = ready.L.layerGroup().addTo(ready.map);
    const points = this.units().filter((u) => u.latitude != null && u.longitude != null && u.kind !== 'country');
    if (points.length) ready.map.fitBounds(ready.L.latLngBounds(points.map((u) => [u.latitude, u.longitude] as [number, number])), { padding: [20, 20] });
    ready.map.on('click', (e: Leaflet.LeafletMouseEvent) => void this.place(e.latlng.wrap()));
    this.ready.set(ready);
  }

  private async place(at: Leaflet.LatLng): Promise<void> {
    const unit = this.placing();
    if (!unit) return;
    try {
      const updated = await this.territory.setCoordinates(unit.id, Number(at.lat.toFixed(6)), Number(at.lng.toFixed(6)));
      this.placing.set(null);
      this.notice.set(this.i18n.tf('mapAdmin.placed', unit.name));
      this.placed.emit(updated);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mapAdmin.error')));
    }
  }
}
