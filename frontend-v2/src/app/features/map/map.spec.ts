import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { MapComponent } from './map';
import { MapCanvasComponent } from './map-canvas';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

/** ?unitId= del enlace «Ver en el mapa» de un ticket. */
let linkParams: Record<string, string> = {};

/** Leaflet no corre en jsdom (sin canvas): el mapa se reemplaza y se prueba el panel. */
@Component({ selector: 'app-map-canvas', standalone: true, template: '' })
class CanvasStubComponent {
  readonly tiles = input<unknown>(null);
  readonly label = input('');
  readonly ready = output<unknown>();
}

const points = [
  { id: 'u1', kind: 'zone', name: 'Valparaíso', parentName: 'Valparaíso', latitude: -33.04, longitude: -71.61, openIncidents: 0, maintenanceUntil: '2026-10-14T21:00:00Z', maintenanceTitle: 'Cambio de equipos', openTickets: 0 },
  { id: 'u2', kind: 'zone', name: 'Calama', parentName: 'Antofagasta', latitude: -22.45, longitude: -68.92, openIncidents: 2, lastIncidentTitle: 'Caída troncal', openTickets: 1, lastTicketTitle: 'TKT-2026-00002 · mori' },
  { id: 'u3', kind: 'zone', name: 'Arica', parentName: 'Arica y Parinacota', latitude: -18.47, longitude: -70.3, openIncidents: 0, openTickets: 0 },
  { id: 'u4', kind: 'zone', name: 'Iquique', parentName: 'Tarapacá', latitude: -20.21, longitude: -70.15, openIncidents: 0, openTickets: 2, lastTicketTitle: 'TKT-2026-00005 · Sin internet en bodega' },
];

describe('MapComponent (#24)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    linkParams = {};
    TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { get queryParamMap() { return convertToParamMap(linkParams); } } } }],
    });
    TestBed.overrideComponent(MapComponent, { remove: { imports: [MapCanvasComponent] }, add: { imports: [CanvasStubComponent] } });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function render(data: unknown[] = points, mode = 'osm') {
    const fixture = TestBed.createComponent(MapComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/config/map-tiles').flush({ data: { mode, url: '' } });
    httpMock.expectOne('/api/map/points').flush({ data });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.mp__row')];
  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

  it('lista los sectores a revisar: primero los incidentes, después los mantenimientos', async () => {
    const { el } = await render();
    expect(rows(el).map((r) => r.querySelector('.mp__row-name')?.textContent?.trim())).toEqual(['Calama', 'Valparaíso']);
    expect(rows(el)[0].textContent).toContain('2 incidentes');
    expect(rows(el)[0].textContent).toContain('Caída troncal');
    expect(rows(el)[1].textContent).toContain('Cambio de equipos');
    expect(el.textContent).toContain('2 puntos');
  });

  it('apagar la capa de mantenimiento la saca de la lista; «Todas» cuenta todas las localidades', async () => {
    const { fixture, el } = await render();
    button(el, 'engineeringMantenimiento').click();
    fixture.detectChanges();
    expect(rows(el)).toHaveLength(1);
    button(el, 'Todas').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('4 puntos');
  });

  it('elegir un sector muestra quién lo cubre, sus incidentes y lleva a Escalamiento', async () => {
    const { fixture, el } = await render();
    rows(el)[0].click();
    httpMock.expectOne('/api/map/units/u2').flush({
      data: {
        incidents: [{ id: 'i1', title: 'Caída troncal', glpiTicket: 'INC-2291', openedAt: new Date().toISOString(), assetName: 'RT-CAL-06' }],
        windows: [],
        teams: [{ id: 't1', name: 'Contratista Fibra Norte', coveredVia: 'Antofagasta' }],
        tickets: [{ id: 'k2', ticketNumber: 'TKT-2026-00002', title: 'mori', priority: 'p3_medium', status: 'new' }],
      },
    });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
    const detail = el.querySelector('.mp__detail')!;
    expect(detail.textContent).toContain('Contratista Fibra Norte');
    expect(detail.textContent).toContain('por Antofagasta');
    expect(detail.textContent).toContain('INC-2291');
    expect(detail.textContent).toContain('RT-CAL-06');
    expect(detail.querySelector('.mp__go')?.getAttribute('href')).toBe('/escalation?territorialUnitId=u2');
    expect(detail.querySelector('.mp__ticket')?.getAttribute('href')).toBe('/tickets?id=k2');
  });

  it('con la Ticketera, la capa de tickets suma las localidades con tickets abiertos (en azul, al final)', async () => {
    TestBed.inject(SystemFeaturesService).apply({ code: 'native_tickets', isEnabled: true });
    const { fixture, el } = await render();
    expect(rows(el).map((r) => r.querySelector('.mp__row-name')?.textContent?.trim())).toEqual(['Calama', 'Valparaíso', 'Iquique']);
    expect(rows(el)[0].textContent).toContain('1 ticket');
    expect(rows(el)[2].querySelector('.mp__bar-tone--tk')).not.toBeNull();
    expect(rows(el)[2].textContent).toContain('TKT-2026-00005 · Sin internet en bodega');
    button(el, 'confirmation_numberTickets abiertos').click();
    fixture.detectChanges();
    expect(rows(el)).toHaveLength(2);
  });

  it('sin la Ticketera no hay capa de tickets', async () => {
    const { el } = await render();
    expect(el.textContent).not.toContain('Tickets abiertos');
    expect(rows(el).map((r) => r.querySelector('.mp__row-name')?.textContent?.trim())).toEqual(['Calama', 'Valparaíso']);
  });

  it('desde un ticket («Ver en el mapa») abre esa localidad', async () => {
    linkParams = { unitId: 'u3' };
    const { el } = await render();
    httpMock.expectOne('/api/map/units/u3').flush({ data: { incidents: [], windows: [], teams: [], tickets: [] } });
    await new Promise((resolve) => setTimeout(resolve));
    expect(el.querySelector('.mp__detail')?.textContent).toContain('Arica');
  });

  it('sin nada que revisar lo dice', async () => {
    const { el } = await render([points[2]], 'none');
    expect(el.textContent).toContain('Nada que revisar con estos filtros.');
  });
});
