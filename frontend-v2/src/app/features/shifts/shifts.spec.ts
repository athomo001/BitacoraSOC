import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ShiftsComponent } from './shifts';

const MATRIX = {
  columns: [
    { date: '2026-09-21', dayShort: 'Lun', isToday: false },
    { date: '2026-09-22', dayShort: 'Mar', isToday: true },
  ],
  rows: [
    {
      userId: 'u1', name: 'Ana Pérez', role: 'Analista N1',
      days: [
        { date: '2026-09-21', condition: 'office', label: 'En Oficina', marker: '' },
        { date: '2026-09-22', condition: 'telework', label: 'Teletrabajo', marker: '🏠' },
      ],
    },
  ],
};

const ADMIN_USER = { id: 'u-admin', username: 'admin', email: 'admin@bitacora.local', role: 'admin', mfaEnabled: false, mustChangePassword: false, active: true, createdAt: new Date().toISOString() };

describe('ShiftsComponent (Dotación)', () => {
  it('abre en "Mi turno": es lo que el analista viene a hacer', async () => {
    const fixture = TestBed.createComponent(ShiftsComponent);
    fixture.detectChanges();
    const active = (fixture.nativeElement as HTMLElement).querySelector('[role="tab"][aria-selected="true"]');
    expect(active?.textContent).toContain('Mi turno');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-my-shift')).toBeTruthy();
  });

  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ShiftsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(ShiftsComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ data: ADMIN_USER });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: 'both', capabilities: [] } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/work-shifts/matrix').flush({ data: MATRIX });
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // "Mi turno" es la pestaña por defecto; estos tests son de Dotación.
    ([...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes('Dotación')) as HTMLElement).click();
    fixture.detectChanges();
    return { fixture, el };
  }

  it('muestra las columnas y filas de la matriz con marcador/label de la condición', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Ana Pérez');
    expect(el.textContent).toContain('Analista N1');
    expect(el.textContent).toContain('Teletrabajo');
    expect(el.textContent).toContain('🏠');
  });

  it('navegar a la semana siguiente vuelve a pedir la matriz con un rango distinto', async () => {
    const { fixture, el } = await render();
    const nextBtn = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Semana siguiente'));
    nextBtn?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await tick();
    const req = httpMock.expectOne((r) => r.url === '/api/work-shifts/matrix');
    // Lunes de la semana siguiente a hoy (antes estaba fijo y se rompía al pasar la fecha).
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() + (monday.getDay() === 0 ? -6 : 1 - monday.getDay()) + 7);
    expect(req.request.params.get('from')).toBe(monday.toISOString().slice(0, 10));
    req.flush({ data: MATRIX });
  });

  it('admin puede editar una celda y guarda la nueva condición', async () => {
    const { fixture, el } = await render();
    const cells = [...el.querySelectorAll('td.shifts__cell')];
    (cells[0] as HTMLElement).click();
    fixture.detectChanges();
    await tick();
    const select = el.querySelector('.shifts__edit select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    select.value = 'vacation';
    select.dispatchEvent(new Event('change'));
    const saveBtn = [...el.querySelectorAll('.shifts__edit button')].find((b) => b.textContent?.includes('Guardar'));
    saveBtn?.dispatchEvent(new Event('click'));
    await tick();
    const req = httpMock.expectOne((r) => r.url === '/api/work-shifts/assignments' && r.method === 'POST');
    expect(req.request.body).toMatchObject({ userId: 'u1', assignedDate: '2026-09-21', condition: 'vacation' });
    req.flush({ data: { id: 'a1', userId: 'u1', assignedDate: '2026-09-21', condition: 'vacation' } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/work-shifts/matrix').flush({ data: MATRIX });
  });
});
