import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminTerritoryMapComponent } from './admin-territory-map';
import { MapCanvasComponent } from '../map/map-canvas';
import { TerritorialUnit } from '../../core/territory/territory.models';

/** Leaflet no corre en jsdom (sin canvas): el mapa se reemplaza. */
@Component({ selector: 'app-map-canvas', standalone: true, template: '' })
class CanvasStubComponent {
  readonly tiles = input<unknown>(null);
  readonly label = input('');
  readonly ready = output<unknown>();
}

const unit = (id: string, name: string, kind: TerritorialUnit['kind'], coords: boolean, active = true): TerritorialUnit => ({
  id,
  name,
  kind,
  code: id,
  path: id,
  parentId: null,
  depth: 0,
  active,
  ...(coords ? { latitude: -33, longitude: -70 } : {}),
});

describe('AdminTerritoryMapComponent (#24)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminTerritoryMapComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.overrideComponent(AdminTerritoryMapComponent, { remove: { imports: [MapCanvasComponent] }, add: { imports: [CanvasStubComponent] } });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function render() {
    const fixture = TestBed.createComponent(AdminTerritoryMapComponent);
    fixture.componentRef.setInput('units', [
      unit('c', 'Chile', 'country', false),
      unit('a', 'Calama', 'zone', true),
      unit('b', 'Nodo Chiguayante 2', 'site', false),
      unit('d', 'Sitio dado de baja', 'site', false, false),
    ]);
    fixture.detectChanges();
    httpMock.expectOne('/api/config/map-tiles').flush({ data: { mode: 'osm', url: '' } });
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('servidor propio: pide la dirección y la guarda', async () => {
    const { fixture, el } = await render();
    button(el, 'Servidor propio').click();
    fixture.detectChanges();
    const url = el.querySelector<HTMLInputElement>('input[name="tilesUrl"]')!;
    url.value = 'https://mapas.local/{z}/{x}/{y}.png';
    url.dispatchEvent(new Event('input'));
    button(el, 'Guardar fondo').click();
    const req = httpMock.expectOne('/api/config/map-tiles');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ mode: 'custom', url: 'https://mapas.local/{z}/{x}/{y}.png' });
    req.flush({ data: req.request.body });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Fondo guardado.');
  });

  it('lista solo las activas sin coordenadas (no el país) y ubica la elegida con un clic en el mapa', async () => {
    const { fixture, el } = await render();
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.tm__row')];
    expect(rows.map((r) => r.querySelector('.tm__name')?.firstChild?.textContent)).toEqual(['Nodo Chiguayante 2']);
    let placed: TerritorialUnit | undefined;
    fixture.componentInstance.placed.subscribe((u) => (placed = u));
    rows[0].click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Haz clic donde está Nodo Chiguayante 2');

    // El clic en el mapa llega como coordenadas (Leaflet no corre en jsdom).
    const cmp = fixture.componentInstance as unknown as { place(at: { lat: number; lng: number }): Promise<void> };
    const done = cmp.place({ lat: -36.84999987, lng: -73.0333333 });
    const req = httpMock.expectOne('/api/territorial-units/b');
    expect(req.request.body).toEqual({ latitude: -36.85, longitude: -73.033333 });
    req.flush({ data: { ...unit('b', 'Nodo Chiguayante 2', 'site', false), latitude: -36.85, longitude: -73.033333 } });
    await done;
    fixture.detectChanges();
    expect(placed?.latitude).toBe(-36.85);
    expect(el.textContent).toContain('Nodo Chiguayante 2 quedó ubicada.');
  });
});
