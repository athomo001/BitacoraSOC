import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ShiftHistoryComponent } from './shift-history';

const CHECKS = [
  {
    id: 'c2', checklistTemplateId: 't', userId: 'u1', username: 'jgonzalez', workShiftId: 'ws-1', checkType: 'cierre', checkDate: '2026-09-26T22:52:00Z', hasRedServices: true,
    services: [
      { id: 's1', serviceTitle: 'Conectividad Sede Norte', status: 'rojo', isComputed: true },
      { id: 's2', serviceTitle: 'Router Principal', status: 'rojo', isComputed: false, observation: 'Sin respuesta SNMP' },
    ],
  },
  { id: 'c1', checklistTemplateId: 't', userId: 'u2', username: 'ana.rojas', workShiftId: 'ws-1', checkType: 'inicio', checkDate: '2026-09-26T11:03:00Z', hasRedServices: false, services: [] },
];

describe('ShiftHistoryComponent', () => {
  let httpMock: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ShiftHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('muestra totales, el resultado de cada check y el detalle de los rojos al abrir la fila', async () => {
    const fixture = TestBed.createComponent(ShiftHistoryComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/work-shifts').flush({ data: [{ id: 'ws-1', name: 'Turno Día', startTime: '08:00', endTime: '20:00', timezone: 'x', shiftType: 'regular', emailRecipients: [], active: true }] });
    await settle();
    httpMock.expectOne((r) => r.url === '/api/shift-checks').flush({ data: CHECKS });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const stats = [...el.querySelectorAll('.sh__stat strong')].map((s) => s.textContent?.trim());
    expect(stats).toEqual(['2', '1', '1']); // el grupo calculado no cuenta dos veces
    expect(el.textContent).toContain('Turno Día');
    expect(el.textContent).toContain('1 en rojo');
    expect(el.textContent).toContain('Todo verde');
    expect(el.textContent).not.toContain('Sin respuesta SNMP');

    (el.querySelector('tr.sh__row') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Router Principal');
    expect(el.textContent).toContain('Sin respuesta SNMP');
  });

  it('filtrar por turno vuelve a pedir la primera página de ese turno', async () => {
    const fixture = TestBed.createComponent(ShiftHistoryComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/work-shifts').flush({ data: [{ id: 'ws-1', name: 'Turno Día', startTime: '08:00', endTime: '20:00', timezone: 'x', shiftType: 'regular', emailRecipients: [], active: true }] });
    await settle();
    httpMock.expectOne((r) => r.url === '/api/shift-checks').flush({ data: CHECKS });
    await settle();
    fixture.detectChanges();
    await settle();

    const select = (fixture.nativeElement as HTMLElement).querySelector('select') as HTMLSelectElement;
    select.value = 'ws-1';
    select.dispatchEvent(new Event('change'));
    await settle();
    const req = httpMock.expectOne((r) => r.url === '/api/shift-checks');
    expect(req.request.params.get('workShiftId')).toBe('ws-1');
    expect(req.request.params.get('page')).toBe('1');
  });
});
