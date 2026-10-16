import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { MaintenanceWindowsComponent } from './maintenance-windows';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { WindowSeries } from '../../core/escalation/escalation.service';

/** Ventanas que se repiten (9.7, diseño aprobado 2026-10-15). */
const SERIES: WindowSeries = {
  id: 's1', areaId: 'a-inf', targetName: 'Infraestructura', title: 'Respaldo semanal', suppressNotifications: true,
  rule: { kind: 'weekly', weekdays: [0], weekday: 0, start: '02:00', end: '04:00' }, validFrom: '2026-10-15',
  next: [
    { id: 'w1', day: '2099-10-18', startsAt: '2099-10-18T05:00:00Z', endsAt: '2099-10-18T07:00:00Z', active: true },
    { id: 'w2', day: '2099-11-01', startsAt: '2099-11-01T05:00:00Z', endsAt: '2099-11-01T07:00:00Z', active: false, holidayName: 'Todos los Santos' },
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Ventanas de mantenimiento que se repiten (9.7)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MaintenanceWindowsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: ModuleAccessService, useValue: { load: async () => undefined, soc: signal(false), noc: signal(false) } }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(canApproveHoliday: boolean) {
    const fixture = TestBed.createComponent(MaintenanceWindowsComponent);
    fixture.detectChanges();
    await settle();
    http.expectOne('/api/maintenance-windows').flush({ data: [
      { id: 'w1', areaId: 'a-inf', title: 'Respaldo semanal', startsAt: '2099-10-18T05:00:00Z', endsAt: '2099-10-18T07:00:00Z', suppressNotifications: true, active: true, seriesId: 's1' },
      { id: 'x', areaId: 'a-inf', title: 'Cambio de UPS', startsAt: '2099-10-20T17:00:00Z', endsAt: '2099-10-20T19:00:00Z', suppressNotifications: false, active: true },
    ] });
    http.expectOne('/api/maintenance-windows/series').flush({ data: { series: [SERIES], canApproveHoliday } });
    http.match('/api/agenda/meta').forEach((r) => r.flush({ data: { areas: [{ id: 'a-inf', name: 'Infraestructura' }] } }));
    http.match(() => true).forEach((r) => r.flush({ data: [] }));
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('las de una serie van en su serie, no en la tabla de sueltas', async () => {
    const { el } = await render(false);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody')?.textContent).toContain('Cambio de UPS');
    expect(el.textContent).toContain('Cada domingo · 02:00–04:00');
    expect(el.textContent).toContain('No se aplica en feriado');
    // Sin ser jefatura no ofrece aplicarla en feriado; saltar una vez sí.
    expect(button(el, 'Aplicar igual')).toBeUndefined();
    button(el, 'Saltar esta vez').click();
    http.expectOne({ method: 'POST', url: '/api/maintenance-windows/series-windows/w1/skip' }).flush(null);
  });

  it('la jefatura aplica igual la que cae en feriado', async () => {
    const { el } = await render(true);
    button(el, 'Aplicar igual').click();
    http.expectOne({ method: 'POST', url: '/api/maintenance-windows/series-windows/w2/approve' }).flush(null);
  });

  it('«Cada semana» crea una serie con la regla elegida', async () => {
    const { fixture, el } = await render(false);
    button(el, 'Cada semana').click();
    fixture.detectChanges();
    http.match((r) => r.url === '/api/maintenance-windows/series/preview').forEach((r) => r.flush({ data: [] }));
    const select = (name: string, value: string) => {
      const s = el.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
      s.value = value;
      s.dispatchEvent(new Event('change'));
    };
    select('winKind', 'area');
    fixture.detectChanges();
    await settle();
    const title = el.querySelector('input[name="winTitle"]') as HTMLInputElement;
    title.value = 'Parches';
    title.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle();
    select('winTarget', 'a-inf');
    fixture.detectChanges();
    await settle();
    http.match(() => true).forEach((r) => r.flush({ data: [] }));
    expect(button(el, 'Programar').disabled).toBe(false);
    button(el, 'Programar').click();
    const req = http.expectOne({ method: 'POST', url: '/api/maintenance-windows/series' });
    expect(req.request.body).toEqual(expect.objectContaining({
      areaId: 'a-inf', title: 'Parches', suppressNotifications: true,
      rule: { kind: 'weekly', weekdays: [0], weekday: 0, start: '02:00', end: '04:00' },
    }));
    req.flush(null);
  });
});
