import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TeamActivityComponent } from './team-activity';
import { ActivityView } from '../../core/team/team.service';

/** Mi equipo → Actividad (10f, decisión del dueño 2026-10-28). */
const VIEW: ActivityView = {
  areaCode: 'soc', areaName: 'SOC', days: 30, from: '2026-09-23', to: '2026-10-22',
  kinds: ['entries', 'mail', 'escalation', 'tickets', 'shift'],
  people: [
    { id: 'ana', name: 'Ana Rojas', level: 'N2' },
    { id: 'pablo', name: 'Pablo Espinoza', level: 'N1' },
  ],
  cells: [
    // Ana, miércoles 03:00: 6 entradas y 2 correos (de noche).
    { userId: 'ana', kind: 'entries', day: 3, hour: 3, count: 6 },
    { userId: 'ana', kind: 'mail', day: 3, hour: 3, count: 2 },
    // Pablo, jueves 10:00 y sábado 23:00.
    { userId: 'pablo', kind: 'tickets', day: 4, hour: 10, count: 10 },
    { userId: 'pablo', kind: 'entries', day: 6, hour: 23, count: 2 },
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const row = (el: HTMLElement, name: string) => [...el.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes(name)) as HTMLElement;
const cell = (el: HTMLElement, label: string) => el.querySelector(`td[title^="${label}"]`) as HTMLElement;

describe('Mi equipo → Actividad (10f)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TeamActivityComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TeamActivityComponent);
    fixture.componentRef.setInput('area', 'soc');
    fixture.componentRef.setInput('areaName', 'SOC');
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/team/activity');
    expect(req.request.params.get('area')).toBe('soc');
    expect(req.request.params.get('days')).toBe('30');
    req.flush({ data: VIEW });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('suma la actividad por día y hora y destaca la noche', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Actividad en SOC');
    expect(cell(el, 'Miércoles de 03:00 a 04:00').textContent?.trim()).toBe('8');
    expect(cell(el, 'Jueves de 10:00 a 11:00').className).toContain('ac__c--5');
    // 10 de 20 acciones son de noche (03:00 y 23:00); 2 en fin de semana.
    expect(el.textContent).toContain('El 50 % de la actividad fue de noche; lo más intenso: Miércoles de 03:00 a 04:00.');
    expect(el.textContent).toContain('Ana Rojas hizo el 80 % del trabajo nocturno.');
    expect(el.textContent).toContain('Jue 10:00');
  });

  it('ordena a las personas por su trabajo nocturno', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('tbody tr')].filter((r) => r.querySelector('strong'));
    expect(rows[0].textContent).toContain('Ana Rojas');
    expect(row(el, 'Ana Rojas').textContent).toContain('100 %');
    expect(row(el, 'Pablo Espinoza').textContent).toContain('17 %');
  });

  it('filtra por tipo y por persona', async () => {
    const { fixture, el } = await render();
    button(el, 'Tickets').click();
    fixture.detectChanges();
    expect(cell(el, 'Jueves de 10:00 a 11:00').textContent?.trim()).toBe('');
    row(el, 'Pablo Espinoza').click();
    fixture.detectChanges();
    expect(cell(el, 'Miércoles de 03:00 a 04:00').textContent?.trim()).toBe('');
    expect(cell(el, 'Sábado de 23:00 a 00:00').textContent?.trim()).toBe('2');
  });

  it('pide un mes con las flechas', async () => {
    const { fixture, el } = await render();
    (el.querySelector('.ac__month-label') as HTMLButtonElement).click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/team/activity');
    expect(req.request.params.get('month')).toMatch(/^\d{4}-\d{2}$/);
    req.flush({ data: VIEW });
  });
});
