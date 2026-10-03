import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MyShiftComponent } from './my-shift';

const ME = { id: 'u-me', username: 'ana.rojas', email: 'ana@bitacora.local', role: 'user', mfaEnabled: false, mustChangePassword: false, active: true, createdAt: '2026-01-01T00:00:00Z' };
// Un solo turno de día completo: la detección por hora siempre cae en él.
const SHIFT = { id: 'ws-1', name: 'Turno Día', startTime: '00:00:00', endTime: '23:59:00', timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: ['noc@synet.cl'], active: true };
const TEMPLATE = {
  id: 'tpl-1',
  name: 'NOC Diaria',
  items: [
    { id: 'troncal', title: 'Enlace Troncal Fibra', itemOrder: 1 },
    { id: 'backup', title: 'Enlace Backup Fibra', itemOrder: 2 },
  ],
};
const CLOSURE = {
  id: 'cl-1', username: 'jgonzalez', shiftStartAt: '2026-09-26T20:00:00Z', shiftEndAt: '2026-09-27T08:00:00Z', closureCheckId: 'prev-check',
  totalEntries: 14, totalIncidents: 2, servicesDown: ['Enlace Troncal Fibra'], observations: null,
  pendingForNextShift: '- [ ] Revisar alarma OTDR', acknowledgedAt: null, ticketsResolvedCount: 3, slaBreachesCount: 0, sentStatus: 'sent',
};
const HANDOVER = {
  previousClosure: CLOSURE,
  upcomingMaintenanceWindows: [{ id: 'mw', title: 'QRadar', startsAt: '2026-09-27T12:00:00Z', endsAt: '2026-09-27T14:00:00Z', suppressNotifications: true }],
  onCallSummary: [{ teamId: 't1', teamName: 'SOC N2', onCallMember: 'Carlos Soto' }],
};

const STATS = {
  shiftStartAt: '2026-09-27T11:00:00Z', totalEntries: 18, totalIncidents: 1, ticketsResolvedCount: 2, slaBreachesCount: 0,
  inicioWrittenAt: '2026-09-27T11:05:00Z', cierreWrittenAt: null,
};

describe('MyShiftComponent (Mi turno)', () => {
  let httpMock: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MyShiftComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(recent: unknown[] = []) {
    const fixture = TestBed.createComponent(MyShiftComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ data: ME });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: 'both', capabilities: [] } });
    httpMock.expectOne('/api/shift-checks/handover').flush({ data: HANDOVER });
    httpMock.expectOne('/api/checklist-templates/active').flush({ data: [TEMPLATE] });
    httpMock.expectOne((r) => r.url === '/api/work-shifts').flush({ data: [SHIFT] });
    httpMock.expectOne((r) => r.url === '/api/shift-checks' && r.method === 'GET').flush({ data: recent });
    await settle();
    httpMock.match((r) => r.url === '/api/shift-checks/stats').forEach((req) => req.flush({ data: STATS }));
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    return { fixture, el, button };
  }

  it('muestra el relevo del turno anterior y lo confirma', async () => {
    const { fixture, el, button } = await render();
    expect(el.textContent).toContain('cierre de jgonzalez');
    expect(el.textContent).toContain('Revisar alarma OTDR');
    expect(el.textContent).toContain('14 entradas');
    expect(el.textContent).toContain('Quedó en rojo: Enlace Troncal Fibra');
    expect(el.textContent).toContain('QRadar');
    expect(el.textContent).toContain('Carlos Soto');
    expect(el.textContent).toContain('Sin revisar');

    button('Confirmar que revisé el relevo').click();
    await settle();
    httpMock.expectOne('/api/shift-checks/closures/cl-1/acknowledge').flush({ data: { ...CLOSURE, acknowledgedAt: '2026-09-27T11:04:00Z', acknowledgedByName: 'ana.rojas' } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Confirmado por ana.rojas');
    expect(button('Confirmar que revisé el relevo')).toBeUndefined();
  });

  it('detecta el momento: si el último check del turno fue un inicio, toca cierre', async () => {
    const { el } = await render([{ id: 'c0', checklistTemplateId: 'tpl-1', userId: 'otro', username: 'otro', workShiftId: 'ws-1', checkType: 'inicio', checkDate: new Date().toISOString(), hasRedServices: false, services: [] }]);
    expect(el.textContent).toContain('Checklist de cierre');
    // Ya no hay un formulario de cierre bloqueado al final: se escribe en el popup.
    expect(el.querySelector('fieldset.ms-closure')).toBeNull();
  });

  it('arriba: botones de Inicio y Cierre de turno con su estado (comentarios del dueño #6/#6.1)', async () => {
    const { el } = await render();
    const bar = [...el.querySelectorAll('.ms-report-bar__btn')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(bar).toEqual(['wb_sunnyInicio de turno hecho', 'nightlightCierre de turno pendiente']);
  });

  it('sugiere la misma causa, la reutiliza y envía el checklist completo', async () => {
    const { fixture, el, button } = await render();
    const redButtons = () => [...el.querySelectorAll('.ms-sema--bad')] as HTMLButtonElement[];
    expect(button('Faltan 2 por evaluar').disabled).toBe(true);

    redButtons()[0].click();
    fixture.detectChanges();
    await settle();
    const first = el.querySelector('textarea') as HTMLTextAreaElement;
    first.value = 'Corte de fibra Km 42';
    first.dispatchEvent(new Event('input'));
    redButtons()[1].click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(el.textContent).toContain('¿Misma causa que Enlace Troncal Fibra?');
    expect(button('Falta justificar 1 en rojo')).toBeTruthy();
    button('Usar esta obs.').click();
    fixture.detectChanges();
    await settle();

    button('Enviar checklist').click();
    await settle();
    const req = httpMock.expectOne((r) => r.url === '/api/shift-checks' && r.method === 'POST');
    expect(req.request.body).toEqual({
      checklistTemplateId: 'tpl-1',
      workShiftId: 'ws-1',
      checkType: 'inicio',
      services: [
        { checklistItemId: 'troncal', serviceTitle: 'Enlace Troncal Fibra', status: 'rojo', observation: 'Corte de fibra Km 42' },
        { checklistItemId: 'backup', serviceTitle: 'Enlace Backup Fibra', status: 'rojo', observation: 'Corte de fibra Km 42' },
      ],
    });
  });

  it('tras guardar el checklist de cierre, ofrece cerrar el turno desde el popup', async () => {
    const { fixture, el, button } = await render([{ id: 'c0', checklistTemplateId: 'tpl-1', userId: 'otro', username: 'otro', workShiftId: 'ws-1', checkType: 'inicio', checkDate: new Date().toISOString(), hasRedServices: false, services: [] }]);
    for (const b of [...el.querySelectorAll('.ms-sema--ok')] as HTMLButtonElement[]) b.click();
    fixture.detectChanges();
    await settle();
    button('Enviar checklist').click();
    await settle();
    httpMock.expectOne((r) => r.url === '/api/shift-checks' && r.method === 'POST').flush({
      data: { id: 'c1', checklistTemplateId: 'tpl-1', userId: 'u-me', username: 'ana.rojas', workShiftId: 'ws-1', checkType: 'cierre', checkDate: new Date().toISOString(), hasRedServices: false, services: [] },
    });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Checklist guardado');
    expect(el.textContent).toContain('escribe el cierre y cierra el turno desde el popup');
    expect(button('Cerrar turno')).toBeTruthy();
  });
});
