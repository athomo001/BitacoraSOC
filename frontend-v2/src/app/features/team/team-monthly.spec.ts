import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TeamMonthlyComponent } from './team-monthly';
import { MonthlyPerson, MonthlyView } from '../../core/team/team.service';

/** Mi equipo → Resumen mensual (9.7, diseño aprobado 2026-10-15). */
const person = (o: Partial<MonthlyPerson>): MonthlyPerson => ({
  id: 'p', name: '', level: '', tasks: 0, onTime: 0, doneLate: 0, openLate: 0, skipped: 0, tickets: 0, ticketsSla: 0, absentDays: 0, ...o,
});

const VIEW: MonthlyView = {
  frozen: true, onTimePct: 88, slaPct: 92, previous: { onTimePct: 90, slaPct: 89 }, tickets: true,
  summary: {
    month: '2026-09', areaCode: 'inf', areaName: 'Infraestructura', bizDays: 20, computedAt: '2026-10-01T11:00:00Z',
    people: [
      person({ id: 'ana', name: 'Ana Rojas', level: 'N1', tasks: 18, onTime: 17, skipped: 1, tickets: 12, ticketsSla: 11 }),
      person({ id: 'luis', name: 'Luis Fuentes', level: 'N1', tasks: 15, onTime: 12, openLate: 1, doneLate: 2, tickets: 9, ticketsSla: 9, absentDays: 3, goalsDone: 2 }),
    ],
    total: person({ name: 'Total Infraestructura', tasks: 33, onTime: 29, openLate: 1, skipped: 1, tickets: 21, ticketsSla: 20, absentDays: 3 }),
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Mi equipo → Resumen mensual (9.7)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TeamMonthlyComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TeamMonthlyComponent);
    fixture.componentRef.setInput('area', 'inf');
    fixture.componentRef.setInput('areaName', 'Infraestructura');
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/team/monthly');
    expect(req.request.params.get('area')).toBe('inf');
    req.flush({ data: VIEW });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, month: req.request.params.get('month') };
  }

  it('abre el mes anterior con los indicadores, la diferencia y la tabla por persona', async () => {
    const { el, month } = await render();
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    expect(month).toBe(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
    expect(el.textContent).toContain('88 %');
    expect(el.textContent).toContain('▼ 2 pts');
    expect(el.textContent).toContain('▲ 3 pts');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.textContent).toContain('Total Infraestructura');
    expect(el.textContent).toContain('Mes cerrado');
    expect(el.querySelector('thead')?.textContent).toContain('Metas cumplidas');
    expect([...el.querySelectorAll('tbody tr')].some((r) => r.textContent?.includes('Luis Fuentes') && [...r.querySelectorAll('td')].some((td) => td.textContent?.trim() === '2'))).toBe(true);
    // Luis: 12 a tiempo de 15 (2 tarde + 1 abierta) = 80 %.
    expect(el.querySelectorAll('tbody tr')[1].textContent).toContain('80 %');
  });

  it('enviar por correo manda los destinatarios escritos', async () => {
    const { fixture, el } = await render();
    button(el, 'Enviar por correo').click();
    fixture.detectChanges();
    const input = el.querySelector('input[name="monthlyTo"]') as HTMLInputElement;
    input.value = 'gerencia@netics.cl, jefa@netics.cl';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('form.mo__send') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/team/monthly/send' });
    expect(req.request.body.to).toEqual(['gerencia@netics.cl', 'jefa@netics.cl']);
    expect(req.request.body.area).toBe('inf');
    req.flush(null);
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Enviado a 2 correos');
  });

  it('en un área con Bitácora muestra entradas y calidad; sin Ticketera, no muestra tickets (10f)', async () => {
    const fixture = TestBed.createComponent(TeamMonthlyComponent);
    fixture.componentRef.setInput('area', 'soc');
    fixture.componentRef.setInput('areaName', 'SOC');
    fixture.detectChanges();
    const people = [
      person({ id: 'ana', name: 'Ana Rojas', level: 'N1', entries: 39, quality: 61 }),
      person({ id: 'luis', name: 'Luis Fuentes', level: 'N1', entries: 4, quality: -1 }),
    ];
    http.expectOne((r) => r.url === '/api/team/monthly').flush({ data: {
      ...VIEW, tickets: false, bitacora: true, previous: { onTimePct: -1, slaPct: -1, quality: 55 },
      summary: { ...VIEW.summary, areaCode: 'soc', areaName: 'SOC', people, total: person({ name: 'Total SOC', entries: 43, quality: 61 }) },
    } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const head = el.querySelector('thead')?.textContent ?? '';
    expect(head).toContain('Entradas');
    expect(head).toContain('Calidad');
    expect(head).not.toContain('Tickets resueltos');
    expect(el.textContent).not.toContain('Tickets dentro del SLA');
    expect(el.textContent).toContain('Calidad de registro');
    expect(el.textContent).toContain('▲ 6 pts');
    const ana = [...el.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Ana Rojas'))!;
    expect(ana.textContent).toContain('39');
    expect(ana.querySelector('.tone-warn')?.textContent?.trim()).toBe('61');
    const luis = [...el.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Luis Fuentes'))!;
    expect(luis.textContent).toContain('—');
  });
});
