import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminShiftAlertsComponent } from './admin-shift-alerts';

/** Administración → Turnos → Avisos (paridad con el legacy, 2026-10-16). */
const CONFIG = {
  checklistEnabled: true, checklistTime: '09:30', checklistTeamId: 't-n1', checklistCargos: ['N2'],
  guardEnabled: false, guardDaysAhead: 7, guardCargos: ['N2'],
  guards: [
    { cycleId: 'c-n2', teamId: 't-n2', name: 'N2', remindUncovered: true },
    { cycleId: 'c-n1', teamId: 't-n1', name: 'N1_NO_HABIL', remindUncovered: true },
    { cycleId: 'c-infra', teamId: 't-infra', name: 'Infra', remindUncovered: false },
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Administración → Turnos → Avisos', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminShiftAlertsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  it('muestra los dos avisos y guarda lo cambiado', async () => {
    const fixture = TestBed.createComponent(AdminShiftAlertsComponent);
    fixture.detectChanges();
    http.expectOne('/api/config/shift-alerts').flush({ data: CONFIG });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Checklist no realizado');
    expect(el.textContent).toContain('Guardia sin cubrir');
    expect(button(el, 'Guardar').disabled).toBe(true);

    const toggle = el.querySelector('input[name="grEnabled"]') as HTMLInputElement;
    toggle.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    button(el, 'Infra').click();
    fixture.detectChanges();
    expect(button(el, 'Guardar').disabled).toBe(false);
    button(el, 'Guardar').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/config/shift-alerts' });
    expect(req.request.body).toEqual({
      checklistEnabled: true, checklistTime: '09:30', checklistTeamId: 't-n1', checklistCargos: ['N2'],
      guardEnabled: true, guardDaysAhead: 7, guardCargos: ['N2'], remindCycleIds: ['c-n1', 'c-n2', 'c-infra'],
    });
    req.flush({ data: { ...CONFIG, guardEnabled: true } });
  });
});
