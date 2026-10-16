import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AdminShiftsComponent } from './admin-shifts';

const shift = (id: string, name: string) => ({
  id, name, startTime: '08:00', endTime: '20:00', timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: ['soc@x.cl'], active: true,
});

describe('AdminShiftsComponent (turnos de trabajo)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminShiftsComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('las flechas cambian el orden de los turnos y lo guardan (como el legacy)', async () => {
    const fixture = TestBed.createComponent(AdminShiftsComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/teams').flush({ data: [] });
    httpMock.expectOne((r) => r.url === '/api/work-shifts').flush({ data: [shift('a', 'Día'), shift('b', 'Noche'), shift('c', 'Apoyo')] });
    httpMock.expectOne('/api/work-shifts/notification-schedules').flush({ data: [] });
    await tick();
    const el = fixture.nativeElement as HTMLElement;
    const tab = [...el.querySelectorAll('.seg')].find((b) => b.textContent?.includes('Turnos')) as HTMLButtonElement;
    tab.click();
    fixture.detectChanges();
    const up = el.querySelector('button[aria-label="Subir Apoyo"]') as HTMLButtonElement;
    expect((el.querySelector('button[aria-label="Subir Día"]') as HTMLButtonElement).disabled).toBe(true);
    up.click();
    await tick();
    const req = httpMock.expectOne('/api/work-shifts/reorder');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ ids: ['a', 'c', 'b'] });
    req.flush({ data: [shift('a', 'Día'), shift('c', 'Apoyo'), shift('b', 'Noche')] });
    await tick();
    fixture.detectChanges();
    const names = [...el.querySelectorAll('.adm-table strong')].map((s) => s.textContent);
    expect(names.slice(0, 3)).toEqual(['Día', 'Apoyo', 'Noche']);
  });
});
