import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { PublicViewComponent } from './public-view';
import { PublicView } from '../../core/public-links/public-links.service';

const URL = '/api/public/views/tok';
const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Enlaces públicos: la vista sin sesión (10h)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token: 'tok' }) } } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function render(respond: (req: ReturnType<HttpTestingController['expectOne']>) => void) {
    const fixture = TestBed.createComponent(PublicViewComponent);
    fixture.detectChanges();
    respond(httpMock.expectOne(URL));
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const view = (v: Partial<PublicView>): PublicView => ({ kind: 'guards', name: 'TV', generatedAt: new Date().toISOString(), ...v });

  it('guardias: quién está, hasta cuándo, quién sigue y la que está sin cubrir', async () => {
    const { el } = await render((r) =>
      r.flush({
        data: view({
          guards: [
            { area: 'SOC', guards: [{ label: 'Guardia N2', people: ['Camila Soto'], until: iso(2 * HOUR), next: ['Diego Fuentes'], mustBeCovered: true }] },
            { area: 'TI', guards: [{ label: 'Guardia TI', people: [], next: ['Sofía Lagos'], nextFrom: iso(26 * HOUR), mustBeCovered: true }] },
          ],
        }),
      }),
    );
    expect(el.getAttribute('data-theme')).toBe('dark');
    expect(el.querySelector('.gd__person')?.textContent).toContain('Camila Soto');
    expect(el.textContent).toContain('Hasta hoy');
    expect(el.textContent).toContain('Diego Fuentes');
    expect(el.querySelector('.gd__uncovered')?.textContent).toContain('Sin cubrir');
    expect(el.textContent).toContain('desde mañana');
  });

  it('ticketera: el SLA vencido, el que vence pronto, en pausa y los sin asignar', async () => {
    const { el } = await render((r) =>
      r.flush({
        data: view({
          kind: 'tickets',
          areaNames: ['SOC'],
          tickets: [
            { number: 'TKT-1', title: 'Bloqueo VPN', client: 'Mundo', assignee: 'Camila', dueAt: iso(-HOUR - 12 * 60_000), onHold: false },
            { number: 'TKT-2', title: 'Malware', client: 'Clínica', assignee: '', dueAt: iso(35 * 60_000), onHold: false },
            { number: 'TKT-3', title: 'Proveedor', client: 'Banco', assignee: 'Diego', dueAt: iso(5 * HOUR), onHold: true },
          ],
        }),
      }),
    );
    expect(el.querySelector('.tv__title')?.textContent).toContain('Tickets abiertos de SOC');
    const counts = el.querySelector('.tk__counts')?.textContent?.replace(/\s+/g, ' ');
    expect(counts).toContain('3 abiertos');
    expect(counts).toContain('1 sin asignar');
    expect(counts).toContain('1 con el SLA vencido');
    expect(counts).toContain('1 vencen en menos de 2 horas');
    const slas = [...el.querySelectorAll('.tk__sla')].map((s) => s.textContent?.trim());
    expect(slas[0]).toMatch(/^Vencido 1 h 1[12] min$/);
    expect(slas[2]).toBe('En pausa');
    expect(el.textContent).toContain('Sin asignar');
  });

  it('cliente: en claro, con el resumen, sus servicios y lo programado', async () => {
    const { el } = await render((r) =>
      r.flush({
        data: view({
          kind: 'client',
          client: {
            name: 'Mundo',
            services: [{ name: 'Firewall', incidentSince: iso(-HOUR) }, { name: 'SIEM' }],
            windows: [{ title: 'Firmware', startsAt: iso(48 * HOUR), endsAt: iso(50 * HOUR), service: '' }],
            recent: [],
          },
        }),
      }),
    );
    expect(el.getAttribute('data-theme')).toBe('light');
    expect(el.querySelector('.cl__state')?.textContent).toContain('Un servicio tiene un incidente en curso');
    expect(el.querySelector('.cl__lead')?.textContent).toContain('Estamos trabajando en Firewall. El resto de sus servicios funciona con normalidad.');
    expect(el.textContent).toContain('Funciona con normalidad');
    expect(el.textContent).toContain('Afecta a todos sus servicios');
    expect(el.textContent).toContain('Sin incidentes en los últimos 7 días.');
  });

  it('un enlace apagado, borrado o mal escrito dice lo mismo', async () => {
    const { el } = await render((r) => r.flush({ detail: 'x' }, { status: 404, statusText: 'Not Found' }));
    expect(el.textContent).toContain('Este enlace no está disponible');
  });
});
