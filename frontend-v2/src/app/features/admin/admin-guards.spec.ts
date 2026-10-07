import { TestBed } from '@angular/core/testing';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminGuardsComponent } from './admin-guards';
import { GuardTimeline } from '../../core/shifts/guards.service';

const DAY = 86_400_000;

function timeline(now: number): GuardTimeline {
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    from: iso(now - 30 * DAY),
    to: iso(now + 30 * DAY),
    now: iso(now),
    guards: [
      {
        cycleId: 'c2', teamId: 't2', label: 'N2', mustBeCovered: true, changeDay: 1, changeTime: '09:00', timezone: 'America/Santiago',
        members: [{ teamMemberId: 'm1', name: 'Ana Rojas', userId: 'u1' }, { teamMemberId: 'm2', name: 'Beto Soto', userId: 'u2' }],
      },
      {
        cycleId: 'c4', teamId: 't4', label: 'OL', mustBeCovered: false, changeDay: 1, changeTime: '09:00', timezone: 'America/Santiago',
        members: [{ teamMemberId: 'm5', name: 'Pablo E', userId: 'u5' }],
      },
    ],
    slots: [
      { id: 's1', cycleId: 'c2', teamMemberId: 'm1', name: 'Ana Rojas', userId: 'u1', startsAt: iso(now - DAY), endsAt: iso(now + 2 * DAY), paused: false },
      { id: 's2', cycleId: 'c2', teamMemberId: 'm2', name: 'Beto Soto', userId: 'u2', startsAt: iso(now + 3 * DAY), endsAt: iso(now + 10 * DAY), paused: false },
    ],
    overrides: [],
    absences: [],
    workShifts: [{ id: 'w1', name: 'Turno Día', startTime: '08:00' }],
  };
}

describe('AdminGuardsComponent (línea de tiempo de guardias)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminGuardsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const now = Date.now();
    const fixture = TestBed.createComponent(AdminGuardsComponent);
    fixture.detectChanges();
    const reqs = httpMock.match((r) => r.url === '/api/guards');
    expect(reqs.length).toBe(2);
    reqs.forEach((r: TestRequest) => r.flush({ data: timeline(now) }));
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

  it('OL no es "siempre cubierta": no marca huecos en su fila', async () => {
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
});
