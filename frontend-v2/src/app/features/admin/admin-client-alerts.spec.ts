import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminClientAlertsComponent, fromLocalInput, toLocalInput } from './admin-client-alerts';

const RULE = {
  id: 'a1', organizationId: 'o1', organizationName: 'JUNJI', name: 'Fuera de horario', enabled: true,
  contexts: ['report', 'copy-report'], timezone: 'America/Santiago', priority: 100, holidayDates: [],
  windows: [{ mode: 'outside_business_hours', startTime: '09:00', endTime: '18:00', daysOfWeek: [], holidayOnly: false }],
  channels: ['email'], message: 'Llamar antes al encargado.', requiresAck: true,
};

describe('AdminClientAlertsComponent (Avisos por cliente)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminClientAlertsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve));
  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text)) as HTMLButtonElement;

  async function render() {
    const fixture = TestBed.createComponent(AdminClientAlertsComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/client-alerts').flush({ data: [RULE] });
    httpMock.expectOne((r) => r.url === '/api/organizations').flush({ data: [{ id: 'o1', name: 'JUNJI', code: 'JUNJI', type: 'client', active: true }] });
    httpMock.expectOne('/api/report-operation-types').flush({ data: [{ id: 't1', name: 'Ofensas', infoDefault: 'Texto.', enabled: true }] });
    await tick();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lista los avisos y los tipos de operación', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('JUNJI');
    expect(el.textContent).toContain('Fuera de horario');
    expect(el.textContent).toContain('Ofensas');
  });

  it('editar y guardar manda la regla completa (PUT) conservando lo que no se edita', async () => {
    const { fixture, el } = await render();
    (el.querySelector('tbody tr') as HTMLElement).click();
    fixture.detectChanges();
    button(el, 'Entre horas').click();
    fixture.detectChanges();
    button(el, 'Guardar').click();
    await tick();
    const req = httpMock.expectOne('/api/client-alerts/a1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.windows[0].mode).toBe('between_hours');
    expect(req.request.body.channels).toEqual(['email']);
    expect(req.request.body.message).toBe('Llamar antes al encargado.');
    req.flush({ data: { ...RULE, windows: req.request.body.windows } });
    await tick();
  });

  it('el interruptor activa o pausa sin abrir el editor', async () => {
    const { el } = await render();
    (el.querySelector('tbody input[role="switch"]') as HTMLInputElement).click();
    await tick();
    const req = httpMock.expectOne('/api/client-alerts/a1');
    expect(req.request.body.enabled).toBe(false);
    req.flush({ data: { ...RULE, enabled: false } });
  });

  it('las fechas de vigencia van y vuelven en hora local', () => {
    const iso = fromLocalInput('2026-10-05T09:30');
    expect(iso).not.toBeNull();
    expect(toLocalInput(iso)).toBe('2026-10-05T09:30');
    expect(fromLocalInput('')).toBeNull();
  });
});
