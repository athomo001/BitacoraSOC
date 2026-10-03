import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ShiftReportData, ShiftReportDialogComponent } from './shift-report-dialog';

const SHIFT = { id: 'ws-1', name: 'Turno Día', startTime: '08:00', endTime: '20:00', timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: ['noc@synet.cl'], active: true };
const PREV = {
  id: 'cl-1', username: 'jgonzalez', shiftStartAt: '2026-09-26T20:00:00Z', shiftEndAt: '2026-09-27T08:00:00Z', closureCheckId: 'prev',
  totalEntries: 4, totalIncidents: 0, servicesDown: [], pendingForNextShift: '- [ ] Seguir 5799\n- [ ] Revisar VPN', acknowledgedAt: null,
  ticketsResolvedCount: 0, slaBreachesCount: 0, sentStatus: 'sent',
};
const CHECK = { id: 'c1', checklistTemplateId: 't', userId: 'u', username: 'ana', workShiftId: 'ws-1', checkType: 'cierre' as const, checkDate: '', hasRedServices: false, services: [] };

describe('Popup de Inicio y Cierre de turno', () => {
  let httpMock: HttpTestingController;
  let closed: unknown;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  function render(data: Partial<ShiftReportData>) {
    localStorage.clear();
    closed = undefined;
    TestBed.configureTestingModule({
      imports: [ShiftReportDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DIALOG_DATA, useValue: { mode: 'inicio', shift: SHIFT, handover: null, closureCheck: null, ...data } },
        { provide: DialogRef, useValue: { close: (v: unknown) => (closed = v) } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ShiftReportDialogComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/shift-checks/stats').flush({
      data: { shiftStartAt: '', totalEntries: 42, totalIncidents: 3, ticketsResolvedCount: 5, slaBreachesCount: 0, inicioWrittenAt: null, cierreWrittenAt: null },
    });
    const el = fixture.nativeElement as HTMLElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    return { fixture, el, type, button };
  }

  it('inicio: trae los pendientes del turno anterior, arma la entrada con vista previa y la guarda', async () => {
    const { fixture, el, type, button } = render({ handover: { previousClosure: PREV, upcomingMaintenanceWindows: [], onCallSummary: [] } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Seguir 5799');
    (el.querySelector('.sr__carried') as HTMLButtonElement).click();
    type('input[name="metric"]', '37x');
    type('textarea[name="tickets"]', '// 5799, DPP, Alta, Nueva ofensa\nesperando logs');
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.sr__entry')?.textContent).toContain('5799 | DPP | Alta | Nueva ofensa');

    button('Guardar inicio de turno').click();
    const req = httpMock.expectOne((r) => r.url === '/api/entries' && r.method === 'POST');
    expect(req.request.body.tags).toEqual(['iniciodeturno']);
    expect(req.request.body.content).toContain('* Tickets totales CDC: 37');
    expect(req.request.body.content).toContain('- [x] Seguir 5799');
    expect(req.request.body.content).toContain('  └ Estado: esperando logs');
    req.flush({ data: { id: 'e1' } });
    await settle();
    expect(closed).toEqual({ inicioSaved: true });
  });

  it('cierre sin checklist: el texto se guarda igual, pero "Cerrar turno" queda deshabilitado', async () => {
    const { fixture, el, button } = render({ mode: 'cierre' });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('42 entradas');
    expect(button('Cerrar turno').disabled).toBe(true);
    button('Guardar en la bitácora').click();
    httpMock.expectOne((r) => r.url === '/api/entries').flush({ data: { id: 'e2' } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Falta cerrar el turno');
  });

  it('cierre con checklist: guarda la entrada #cierredeturno y registra el cierre con pendientes y correo', async () => {
    const { fixture, type, button } = render({ mode: 'cierre', closureCheck: CHECK });
    await settle();
    fixture.detectChanges();
    type('textarea[name="notes"]', 'Troncal volvió 14:10');
    type('textarea[name="pending"]', '- [ ] Revisar QRadar');
    button('Cerrar turno').click();
    const entry = httpMock.expectOne((r) => r.url === '/api/entries');
    expect(entry.request.body.tags).toEqual(['cierredeturno']);
    entry.flush({ data: { id: 'e3' } });
    await settle();
    const close = httpMock.expectOne('/api/shift-checks/close');
    expect(close.request.body).toEqual({ closureCheckId: 'c1', observations: 'Troncal volvió 14:10', pendingForNextShift: '- [ ] Revisar QRadar', notifyEmail: true, syncGlpi: false });
    close.flush({ data: { ...PREV, id: 'cl-2' } });
    await settle();
    expect((closed as { closure: { id: string } }).closure.id).toBe('cl-2');
  });
});
