import { TestBed } from '@angular/core/testing';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminGuardsComponent } from './admin-guards';
import { GuardTimeline } from '../../core/shifts/guards.service';

const DAY = 86_400_000;

function timeline(now: number, withSwap = false, blocked = false): GuardTimeline {
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    from: iso(now - 30 * DAY),
    to: iso(now + 30 * DAY),
    now: iso(now),
    guards: [
      {
        cycleId: 'c2', teamId: 't2', label: 'N2', mustBeCovered: true, changeDay: 1, changeTime: '09:00', timezone: 'America/Santiago', area: 'soc', areaName: 'SOC',
        members: [{ teamMemberId: 'm1', name: 'Ana Rojas', userId: 'u1' }, { teamMemberId: 'm2', name: 'Beto Soto', userId: 'u2' }],
      },
      {
        cycleId: 'c4', teamId: 't4', label: 'TI', mustBeCovered: false, changeDay: 1, changeTime: '09:00', timezone: 'America/Santiago', area: 'ti', areaName: 'TI',
        members: [{ teamMemberId: 'm5', name: 'Pablo E', userId: 'u5' }],
      },
    ],
    slots: [
      { id: 's1', cycleId: 'c2', teamMemberId: 'm1', name: 'Ana Rojas', userId: 'u1', startsAt: iso(now - DAY), endsAt: iso(now + 2 * DAY), paused: false, blocked },
      { id: 's2', cycleId: 'c2', teamMemberId: 'm2', name: 'Beto Soto', userId: 'u2', startsAt: iso(now + 3 * DAY), endsAt: iso(now + 10 * DAY), paused: false },
    ],
    overrides: withSwap
      ? [{ id: 'o1', cycleId: 'c2', originalTeamMemberId: 'm1', replacementTeamMemberId: 'm2', name: 'Beto Soto', startsAt: iso(now), endsAt: iso(now + DAY), reason: 'Licencia' }]
      : [],
    absences: [],
    workShifts: [{ id: 'w1', name: 'Turno Día', startTime: '08:00' }],
    editableAreas: ['soc', 'ti'],
  };
}

describe('AdminGuardsComponent (línea de tiempo de guardias)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminGuardsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(withSwap = false, blocked = false) {
    const now = Date.now();
    const fixture = TestBed.createComponent(AdminGuardsComponent);
    fixture.detectChanges();
    const reqs = httpMock.match((r) => r.url === '/api/guards');
    expect(reqs.length).toBe(2);
    reqs.forEach((r: TestRequest) => r.flush({ data: timeline(now, withSwap, blocked) }));
    await tick();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, now };
  }

  it('muestra quién está ahora, el siguiente y el hueco de N2', async () => {
    const { el } = await render();
    const cards = el.querySelectorAll('.gd__card');
    expect(cards[0].textContent).toContain('Ana Rojas');
    expect(cards[0].textContent).toContain('Beto Soto');
    expect(cards[1].textContent).toContain('Sin guardia ahora');
    expect(el.querySelectorAll('.gd__gap').length).toBeGreaterThan(0);
    expect(el.querySelector('.gd__issue')?.textContent).toContain('N2 sin nadie');
  });

  it('el turno de alguien desactivado queda pendiente: no está de guardia y la guardia queda sin cubrir', async () => {
    const { el } = await render(false, true);
    const cards = el.querySelectorAll('.gd__card');
    expect(cards[0].textContent).not.toContain('Ana Rojas');
    expect(el.querySelector('.gd__bar--paused')?.textContent).toContain('Pendiente · Ana Rojas desactivado');
    expect(el.querySelectorAll('.gd__gap').length).toBeGreaterThan(0);
  });

  it('un clic en un reemplazo lo abre para editarlo y borrarlo', async () => {
    const { fixture, el } = await render(true);
    (el.querySelector('.gd__bar--swap-edit') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('.gd__panel')?.textContent).toContain('Ana Rojas');
    const reason = el.querySelector('input[name="swapReason"]') as HTMLInputElement;
    expect(reason.value).toBe('Licencia');
    reason.value = 'Licencia médica';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.gd__panel-foot .adm-btn--primary') as HTMLButtonElement).click();
    await tick();
    const put = httpMock.expectOne('/api/rotation-overrides/o1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toMatchObject({ replacementTeamMemberId: 'm2', reason: 'Licencia médica' });
    put.flush({ data: {} });
    await tick();
    httpMock.match((r) => r.url === '/api/guards').forEach((r) => r.flush({ data: timeline(Date.now(), true) }));
    await tick();
    fixture.detectChanges();
    (el.querySelector('.gd__bar--swap-edit') as HTMLButtonElement).click();
    fixture.detectChanges();
    const del = el.querySelector('.gd__panel-foot .adm-btn--danger') as HTMLButtonElement;
    del.click();
    fixture.detectChanges();
    expect(del.textContent).toContain('Seguro');
    del.click();
    await tick();
    const req = httpMock.expectOne('/api/rotation-overrides/o1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('TI no es "siempre cubierta": no marca huecos en su fila', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('.gd__row');
    expect(rows[1].querySelectorAll('.gd__gap').length).toBe(0);
  });

  it('cubrir un hueco abre el panel con la revisión y crea la guardia', async () => {
    const { fixture, el } = await render();
    (el.querySelector('.gd__issue button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.gd__panel')).not.toBeNull();
    expect(el.querySelector('.gd__check')?.textContent).toContain('Elige a la persona');
    (el.querySelectorAll('.gd__person')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    const save = el.querySelector('.gd__panel-foot .adm-btn--primary') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    await tick();
    const req = httpMock.expectOne('/api/guards/slots');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ cycleId: 'c2', teamMemberId: 'm1' });
    req.flush({ data: {} });
  });

  it('la rotación arma la vista previa y la envía con el orden elegido', async () => {
    const { fixture, el, now } = await render();
    const rotate = [...el.querySelectorAll('.gd__tools button')].find((b) => b.textContent?.includes('Generar rotación')) as HTMLButtonElement;
    rotate.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.gd__preview').length).toBe(4);
    expect(el.querySelectorAll('.gd__preview')[1].textContent).toContain('Beto Soto');
    (el.querySelector('.gd__panel-foot .adm-btn--primary') as HTMLButtonElement).click();
    await tick();
    const req = httpMock.expectOne('/api/guards/rotation');
    expect(req.request.body).toMatchObject({ cycleId: 'c2', teamMemberIds: ['m1', 'm2'], daysEach: 7, count: 4 });
    expect(Date.parse(req.request.body.startsAt)).toBe(now + 10 * DAY);
    req.flush({ data: {} });
  });

  it('configurar enlaza el turno de trabajo para la hora de cambio', async () => {
    const { fixture, el } = await render();
    (el.querySelector('.gd__cfg') as HTMLButtonElement).click();
    fixture.detectChanges();
    const select = el.querySelectorAll('.gd__panel select')[1] as HTMLSelectElement;
    select.value = 'w1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('.gd__panel')?.textContent).toContain('08:00');
    (el.querySelector('.gd__panel-foot .adm-btn--primary') as HTMLButtonElement).click();
    await tick();
    const req = httpMock.expectOne('/api/guards/c2');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ mustBeCovered: true, changeDay: 1, workShiftId: 'w1' });
    req.flush({ data: {} });
  });

  it('nueva asignación también marca condiciones: licencia de varios días en Dotación', async () => {
    const { fixture, el } = await render();
    const open = [...el.querySelectorAll('.gd__tools button')].find((b) => b.textContent?.includes('Nueva asignación')) as HTMLButtonElement;
    open.click();
    fixture.detectChanges();
    // Mismo selector que las guardias, como el legacy: N2, TI… y las condiciones.
    const tele = [...el.querySelectorAll('.gd__panel .seg')].find((b) => b.textContent?.includes('Teletrabajo')) as HTMLButtonElement;
    tele.click();
    await tick();
    httpMock.expectOne('/api/users').flush({ data: [
      { id: 'u1', username: 'arojas', fullName: 'Ana Rojas', role: 'user', active: true },
      { id: 'u9', username: 'invitado', role: 'guest', active: true },
    ] });
    await tick();
    fixture.detectChanges();
    const person = el.querySelector('.gd__panel select') as HTMLSelectElement;
    expect(person.options.length).toBe(2);
    person.value = 'u1';
    person.dispatchEvent(new Event('change'));
    const leave = [...el.querySelectorAll('.gd__panel .seg')].find((b) => b.textContent?.includes('Licencia')) as HTMLButtonElement;
    leave.click();
    fixture.detectChanges();
    const [from, to] = [...el.querySelectorAll('.gd__panel input[type=date]')] as HTMLInputElement[];
    from.value = '2026-10-14';
    from.dispatchEvent(new Event('input'));
    to.value = '2026-10-20';
    to.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.gd__panel-foot .adm-btn--primary') as HTMLButtonElement).click();
    await tick();
    const req = httpMock.expectOne('/api/work-shifts/assignments');
    expect(req.request.body).toEqual({ userId: 'u1', assignedDate: '2026-10-14', condition: 'medical_leave', untilDate: '2026-10-20' });
    req.flush({ data: {} });
  });

  it('solo mirar (Turnos de un área): sin botones de edición, y pide solo esa área', async () => {
    const fixture = TestBed.createComponent(AdminGuardsComponent);
    fixture.componentRef.setInput('area', 'ti');
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const reqs = httpMock.match((r) => r.url === '/api/guards');
    expect(reqs.every((r) => r.request.params.get('area') === 'ti')).toBe(true);
    reqs.forEach((r: TestRequest) => r.flush({ data: timeline(Date.now()) }));
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll('.gd__tools button')].map((b) => b.textContent?.trim() ?? '');
    expect(labels.some((l) => l.includes('Nueva asignación') || l.includes('Importar'))).toBe(false);
    (el.querySelector('.gd__issue button') as HTMLButtonElement | null)?.click();
    fixture.detectChanges();
    expect(el.querySelector('.gd--panel')).toBeNull();
  });
});
