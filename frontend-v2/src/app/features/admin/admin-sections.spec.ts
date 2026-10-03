import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminShiftsComponent } from './admin-shifts';
import { AdminFeaturesComponent } from './admin-features';
import { AdminModulesComponent } from './admin-modules';

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Administración re-vestida', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminShiftsComponent, AdminFeaturesComponent, AdminModulesComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('Turnos: avisa del turno sin destinatarios y editarlo manda un PATCH con los correos', async () => {
    const fixture = TestBed.createComponent(AdminShiftsComponent);
    fixture.detectChanges();
    http.expectOne('/api/teams').flush({ data: [] });
    http.expectOne((r) => r.url === '/api/work-shifts').flush({
      data: [{ id: 'w2', name: 'Turno Noche', startTime: '20:00', endTime: '08:00', timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: [], active: true }],
    });
    http.expectOne('/api/work-shifts/notification-schedules').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Sin destinatarios');

    (el.querySelector('.adm-row-click') as HTMLElement).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Editar turno');
    const emails = el.querySelector('input[name="wsEmails"]') as HTMLInputElement;
    emails.value = 'jefe@empresa.cl, noc@empresa.cl';
    emails.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('form.sa__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const patch = http.expectOne((r) => r.method === 'PATCH' && r.url === '/api/work-shifts/w2');
    expect(patch.request.body).toMatchObject({ name: 'Turno Noche', emailRecipients: ['jefe@empresa.cl', 'noc@empresa.cl'] });
    patch.flush({ data: {} });
    await settle();
    http.expectOne((r) => r.url === '/api/work-shifts').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado ✓');
  });

  it('Funcionalidades: la Ticketera no se repite (está en Módulos); las post-corte van sin interruptor', async () => {
    const fixture = TestBed.createComponent(AdminFeaturesComponent);
    fixture.detectChanges();
    http.expectOne('/api/system-features').flush({
      data: [
        { code: 'native_tickets', name: 'x', isEnabled: false, configPayload: {}, updatedAt: '' },
        { code: 'allow_purge', name: 'x', isEnabled: false, configPayload: {}, updatedAt: '' },
        { code: 'glpi_sync', name: 'x', isEnabled: false, configPayload: {}, updatedAt: '' },
      ],
    });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.ft__row');
    expect(rows.length).toBe(2);
    expect(el.textContent).not.toContain('Ticketera');
    expect(rows[0].querySelector('input[role="switch"]')).not.toBeNull();
    expect(rows[1].textContent).toContain('Post-corte');
    expect(rows[1].querySelector('input[role="switch"]')).toBeNull();

    (rows[0].querySelector('input[role="switch"]') as HTMLInputElement).dispatchEvent(new Event('change'));
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url === '/api/system-features/allow_purge');
    expect(req.request.body).toEqual({ isEnabled: true });
    req.flush({ data: { code: 'allow_purge', name: 'x', isEnabled: true, configPayload: {}, updatedAt: '' } });
  });

  it('Módulos: SOC, NOC y Ticketera juntos; guardar la Ticketera la enciende sin tocar SOC/NOC', async () => {
    const fixture = TestBed.createComponent(AdminModulesComponent);
    fixture.detectChanges();
    http.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, socEnabled: true, nocEnabled: false } });
    http.expectOne('/api/system-features').flush({
      data: [{ code: 'native_tickets', name: 'x', isEnabled: false, configPayload: {}, updatedAt: '' }],
    });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = [...el.querySelectorAll('.adm-switch-row')];
    expect(rows.map((r) => r.querySelector('.adm-strong')?.textContent?.trim())).toEqual(['SOC', 'NOC', 'Ticketera']);

    (rows[2].querySelector('input') as HTMLInputElement).dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (el.querySelector('.adm-btn--primary') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url === '/api/system-features/native_tickets');
    expect(req.request.body).toEqual({ isEnabled: true });
    req.flush({ data: { code: 'native_tickets', name: 'x', isEnabled: true, configPayload: {}, updatedAt: '' } });
    http.expectNone('/api/config/modules');
  });
});
