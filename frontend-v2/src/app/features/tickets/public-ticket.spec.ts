import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { PublicTicketComponent } from './public-ticket';
import { PublicTicket } from '../../core/tickets/tickets.service';

const URL = '/api/public/tickets/tok';

const TICKET: PublicTicket = {
  ticketNumber: 'TKT-2026-00042', title: 'Corte de enlace troncal de fibra', ticketType: 'incident', status: 'pending_vendor',
  priority: 'p1_critical', clientName: 'Red Bancaria Austral', openAt: '2026-09-27T03:10:00Z', lastUpdateAt: new Date(Date.now() - 120_000).toISOString(),
  publicComments: [
    { author: 'Mesa de Operaciones', content: 'Recibimos el incidente.', createdAt: '2026-09-27T03:15:00Z' },
    { author: 'Mesa de Operaciones', content: 'La cuadrilla está en el sitio.', createdAt: '2026-09-27T03:35:00Z' },
  ],
};

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('PublicTicketComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicTicketComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token: 'tok' }) } } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function render() {
    const fixture = TestBed.createComponent(PublicTicketComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function flush(fixture: { detectChanges(): void }, respond: (req: ReturnType<HttpTestingController['expectOne']>) => void, pin?: string) {
    const req = httpMock.expectOne((r) => r.url === URL && r.params.get('pin') === (pin ?? null));
    respond(req);
    await settle();
    fixture.detectChanges();
  }

  function typePin(el: HTMLElement, value: string) {
    const input = el.querySelector<HTMLInputElement>('.pt__pin-input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('sin PIN muestra el estado en 3 pasos y los comunicados, lo más reciente arriba', async () => {
    const { fixture, el } = await render();
    await flush(fixture, (r) => r.flush({ data: TICKET }));

    expect(el.querySelector('.pt__title')?.textContent).toContain('Corte de enlace troncal de fibra');
    expect(el.textContent).toContain('Prioridad crítica');
    expect(el.textContent).toContain('Red Bancaria Austral · Incidente');
    expect(el.querySelector('.pt__updated')?.textContent).toContain('Actualizado hace 2 min');
    const steps = el.querySelectorAll('.pt__step');
    expect(steps).toHaveLength(3);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(el.querySelector('.pt__callout')?.textContent).toContain('En espera de un tercero.');
    const updates = el.querySelectorAll('.pt__text');
    expect(updates[0].textContent).toContain('La cuadrilla está en el sitio.');
    expect(updates[1].textContent).toContain('Recibimos el incidente.');
  });

  it('pide el PIN sin marcar error y, con uno incorrecto, avisa y deja reintentar', async () => {
    const { fixture, el } = await render();
    await flush(fixture, (r) => r.flush({ detail: 'PIN requerido' }, { status: 401, statusText: 'Unauthorized' }));
    expect(el.textContent).toContain('Ingresa el PIN de seguimiento');
    expect(el.querySelector('.pt__error')).toBeNull();

    typePin(el, '12a34');
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('.pt__pin-input')!.value).toBe('1234');
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);

    typePin(el, '123456');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush(fixture, (r) => r.flush({ detail: 'PIN incorrecto' }, { status: 401, statusText: 'Unauthorized' }), '123456');
    expect(el.querySelector('.pt__error')?.textContent).toContain('El PIN no coincide');

    typePin(el, '482913');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush(fixture, (r) => r.flush({ data: TICKET }), '482913');
    expect(el.querySelector('.pt__title')).not.toBeNull();
  });

  it('avisa cuando se superan los intentos de PIN', async () => {
    const { fixture, el } = await render();
    await flush(fixture, (r) => r.flush({}, { status: 429, statusText: 'Too Many Requests' }));
    expect(el.querySelector('.pt__error')?.textContent).toContain('Demasiados intentos');
  });

  it('un enlace inexistente o desactivado no deja ver nada', async () => {
    const { fixture, el } = await render();
    await flush(fixture, (r) => r.flush({}, { status: 404, statusText: 'Not Found' }));
    expect(el.textContent).toContain('Este enlace no está disponible');
    expect(el.querySelector('.pt__status')).toBeNull();
  });

  it('un ticket cancelado no muestra barra de avance', async () => {
    const { fixture, el } = await render();
    await flush(fixture, (r) => r.flush({ data: { ...TICKET, status: 'cancelled', publicComments: [] } }));
    expect(el.querySelector('.pt__steps')).toBeNull();
    expect(el.querySelector('.pt__callout')?.textContent).toContain('Cancelado.');
    expect(el.textContent).toContain('Aún no hay comunicados');
  });
});
