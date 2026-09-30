import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminShiftRemindersComponent } from './admin-shift-reminders';
import { ShiftReminder, WorkShift } from '../../core/shifts/shifts.service';

const SHIFTS: WorkShift[] = [
  { id: 'dia', name: 'Turno Día', startTime: '08:00', endTime: '20:00', timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: ['a@x.cl', 'b@x.cl'], active: true },
  { id: 'noche', name: 'Turno Noche', startTime: '20:00', endTime: '08:00', timezone: 'America/Santiago', shiftType: 'regular', emailRecipients: [], active: true },
] as WorkShift[];

const PHISHING: ShiftReminder = {
  id: 'r1', label: 'Revisar colas de phishing', reminderText: 'Revisa las colas.', frequencyType: 'hours', intervalHours: 4,
  fixedTimes: [], targetShiftIds: ['dia'], enabled: true, lastSentAt: '2026-09-30T15:00:00Z', lastRecipientsCount: 2, lastStatus: 'sent',
};

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('AdminShiftRemindersComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminShiftRemindersComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(reminders: ShiftReminder[]) {
    const fixture = TestBed.createComponent(AdminShiftRemindersComponent);
    fixture.detectChanges();
    http.expectOne('/api/shift-reminders').flush({ data: reminders });
    http.expectOne((r) => r.url === '/api/work-shifts').flush({ data: SHIFTS });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
    };
    return { fixture, el, button, refresh };
  }

  it('lista con cuándo, turnos y último envío, y abre el primero en el editor', async () => {
    const { el } = await render([PHISHING]);
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).toContain('cada 4 h');
    expect(row.textContent).toContain('Turno Día');
    expect(row.textContent).toContain('2 personas');
    expect((el.querySelector('input[name="label"]') as HTMLInputElement).value).toBe('Revisar colas de phishing');
    // Probar funciona con lo guardado; Guardar espera cambios.
    const [test, save] = ['Probar', 'Guardar'].map((t) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement);
    expect(test.disabled).toBe(false);
    expect(save.disabled).toBe(true);
  });

  it('nuevo a horas fijas: arranca con 09:00, avisa del turno sin destinatarios y crea con el cuerpo completo', async () => {
    const { el, button, refresh } = await render([]);
    expect(el.textContent).toContain('Todavía no hay recordatorios.');
    button('Nuevo recordatorio').click();
    await refresh();

    const label = el.querySelector('input[name="label"]') as HTMLInputElement;
    label.value = 'Checklist de cierre';
    label.dispatchEvent(new Event('input'));
    const text = el.querySelector('textarea[name="text"]') as HTMLTextAreaElement;
    text.value = 'Completa el checklist.';
    text.dispatchEvent(new Event('input'));
    button('A horas fijas').click();
    await refresh();
    expect(el.textContent).toContain('09:00');
    // Sin turnos marcados van todos: el de noche no tiene destinatarios.
    expect(el.textContent).toContain('Turno Noche: sin destinatarios');
    // Probar no se puede hasta guardar.
    expect(button('Probar').disabled).toBe(true);

    button('Guardar').click();
    await refresh();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/shift-reminders');
    expect(req.request.body).toEqual({
      label: 'Checklist de cierre', reminderText: 'Completa el checklist.', frequencyType: 'fixed', intervalHours: 4,
      fixedTimes: ['09:00'], targetShiftIds: [], enabled: true,
    });
    const saved = { ...req.request.body, id: 'r2' };
    req.flush({ data: saved });
    await settle();
    http.expectOne('/api/shift-reminders').flush({ data: [saved] });
    await refresh();
    expect(el.textContent).toContain('Guardado ✓');
  });

  it('eliminar pide confirmación en la página', async () => {
    const { el, refresh } = await render([PHISHING]);
    (el.querySelector('button[aria-label="Eliminar"]') as HTMLButtonElement).click();
    await refresh();
    expect(el.textContent).toContain('¿Eliminar este recordatorio?');
    (el.querySelector('.adm-btn--danger') as HTMLButtonElement).click();
    await refresh();
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/shift-reminders/r1').flush(null);
    await settle();
    http.expectOne('/api/shift-reminders').flush({ data: [] });
    await refresh();
    expect(el.textContent).toContain('Todavía no hay recordatorios.');
  });
});
