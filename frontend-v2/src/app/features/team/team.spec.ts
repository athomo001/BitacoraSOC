import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TeamComponent } from './team';
import { TeamView } from '../../core/team/team.service';

const week = (c: string) => ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((date) => ({ date, condition: c }));
const VIEW: TeamView = {
  area: { code: 'infra', name: 'Infraestructura' },
  stats: { people: 2, tickets: 6, breached: 2, away: 1 },
  groups: [{ id: 'g1', name: 'Infra N1', level: 'N1' }, { id: 'g2', name: 'Infra N2', level: 'N2' }],
  people: [
    { id: 'p1', username: 'dlagos', fullName: 'Diego Lagos', email: 'd@x.cl', active: true, editable: true, groups: [{ id: 'g1', name: 'Infra N1' }], today: 'telework', week: week('telework') as never, tickets: 6, breached: 2 },
    { id: 'p2', username: 'preyes', fullName: 'Pablo Reyes', email: 'p@x.cl', active: true, editable: false, groups: [{ id: 'g2', name: 'Infra N2' }], today: 'vacation', week: week('vacation') as never, tickets: 0, breached: 0 },
  ],
};

describe('TeamComponent (Mi equipo, jefatura de área, spec/16 9d)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TeamComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(areas = [{ code: 'infra', name: 'Infraestructura' }, { code: 'ti', name: 'TI' }]) {
    const fixture = TestBed.createComponent(TeamComponent);
    fixture.detectChanges();
    http.expectOne('/api/team/areas').flush({ data: areas });
    await settle();
    if (areas.length) {
      http.expectOne((r) => r.url === '/api/team' && r.params.get('area') === 'infra').flush({ data: VIEW });
      await settle();
      http.expectOne((r) => r.url === '/api/team/people/p1/tickets').flush({
        data: [{ id: 't1', number: 'TKT-2026-00071', title: 'Firmware switches', status: 'assigned', breached: true }],
      });
      await settle();
    }
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!;

  it('muestra las cifras, la gente con cómo está hoy y los tickets de la primera persona', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Ausentes hoy');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('tbody tr')?.textContent).toContain('Teletrabajo');
    expect(el.textContent).toContain('TKT-2026-00071');
    expect(el.textContent).toContain('Vencido');
    expect(el.querySelectorAll('.tm__day').length).toBe(5);
  });

  it('sin áreas a cargo lo dice', async () => {
    const { el } = await render([]);
    expect(el.textContent).toContain('No eres jefatura');
  });

  it('cambiar el grupo va al servidor y recarga', async () => {
    const { el } = await render();
    button(el, 'Infra N2').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/team/people/p1/group' });
    expect(req.request.body).toEqual({ area: 'infra', groupId: 'g2' });
    req.flush(null);
    await settle();
    http.expectOne((r) => r.url === '/api/team').flush({ data: VIEW });
  });

  it('a quien no puede tocar no le ofrece cambiar grupo ni dar de baja', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('tbody tr')[1] as HTMLElement).click();
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('la gestiona el administrador');
    expect(button(el, 'Dar de baja')).toBeUndefined();
  });

  it('dar de baja pide confirmar', async () => {
    const { fixture, el } = await render();
    button(el, 'Dar de baja').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('¿Dar de baja a Diego Lagos?');
    button(el.querySelector('.tm__confirm') as HTMLElement, 'Dar de baja').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/team/people/p1' });
    expect(req.request.body).toEqual({ area: 'infra', active: false });
  });

  it('agregar persona muestra la contraseña temporal una vez', async () => {
    const { fixture, el } = await render();
    button(el, 'Agregar persona').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const fill = (name: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    fill('fullName', 'Rocío Fuentes');
    fill('username', 'rfuentes');
    fill('email', 'rfuentes@x.cl');
    await settle();
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/team/people' });
    expect(req.request.body).toEqual({ area: 'infra', fullName: 'Rocío Fuentes', username: 'rfuentes', email: 'rfuentes@x.cl', groupId: 'g1' });
    req.flush({ data: { id: 'p9', username: 'rfuentes', tempPassword: 'Abc23456789xyz' } });
    await settle();
    http.expectOne((r) => r.url === '/api/team').flush({ data: VIEW });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Abc23456789xyz');
    expect(el.textContent).toContain('no se vuelve a mostrar');
  });
});
