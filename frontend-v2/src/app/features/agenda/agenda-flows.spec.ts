import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AgendaFlowsComponent } from './agenda-flows';
import { SseService } from '../../core/sse/sse.service';
import { AgendaFlow, AgendaMeta } from '../../core/agenda/agenda.service';

/** Flujos entre áreas (9.7, diseño aprobado 2026-10-15). */
const META: AgendaMeta = {
  today: '2026-10-15', workDays: [1, 2, 3, 4, 5], dayStart: '08:00', dayEnd: '20:00', holidays: {},
  areas: [
    { id: 'a-inf', code: 'inf', name: 'Infraestructura', mine: true, lead: true, myRank: 3,
      levels: [{ id: 'n1', name: 'N1', rank: 1, allowed: true }], people: [{ id: 'me', name: 'Carla', rank: 3, allowed: true }, { id: 'ana', name: 'Ana', rank: 1, allowed: true }], guards: [] },
    { id: 'a-ti', code: 'ti', name: 'TI', mine: false, lead: false, myRank: 0,
      levels: [{ id: 'n1', name: 'N1', rank: 1, allowed: true }], people: [{ id: 'pedro', name: 'Pedro', rank: 2, allowed: true }], guards: [] },
  ],
  me: 'me', admin: false, viewAll: false, leadAreas: ['a-inf'], crossArea: true,
};

const step = (o: Partial<AgendaFlow['steps'][number]>) => ({
  taskId: 't0', position: 0, name: 'Rack', description: '', areaId: 'a-inf', areaName: 'Infraestructura', assigneeKind: 'person' as const,
  assigneeId: 'ana', assigneeName: 'Ana', after: false, days: 0, steps: [], warnDays: [0], ...o,
});

const FLOW: AgendaFlow = {
  id: 'f1', name: 'Habilitar sucursal Rancagua', clientName: 'Casinos', paused: false, recurrence: { kind: 'once', date: '2026-10-14' },
  createdByName: 'Carla', canEdit: true, state: 'ok',
  steps: [
    step({}),
    step({ taskId: 't1', position: 1, name: 'Configurar red', areaId: 'a-ti', areaName: 'TI', assigneeId: 'pedro', assigneeName: 'Pedro', after: true, days: 2 }),
    step({ taskId: 't2', position: 2, name: 'Monitoreo', areaId: 'a-ti', areaName: 'TI', assigneeKind: 'level', assigneeId: 'n1', assigneeName: 'N1', after: false, days: 3 }),
  ],
  run: { id: 'r1', startDate: '2026-10-14', done: 1, steps: [
    { taskId: 't0', occurrenceId: 'o0', status: 'done', dueDate: '2026-10-14', late: false, holderName: 'Ana', closedAt: '2026-10-14T19:00:00Z' },
    { taskId: 't1', occurrenceId: 'o1', status: 'pending', dueDate: '2026-10-16', late: false, holderName: 'Pedro' },
    { taskId: 't2', occurrenceId: 'o2', status: 'waiting', dueDate: '', late: false },
  ] },
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Agenda → Flujos (9.7)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgendaFlowsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(flows: AgendaFlow[]) {
    const fixture = TestBed.createComponent(AgendaFlowsComponent);
    fixture.componentRef.setInput('meta', META);
    fixture.detectChanges();
    http.expectOne('/api/agenda/flows').flush({ data: flows });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra el flujo abierto con sus pasos en cadena y el estado de cada uno', async () => {
    const { el } = await render([FLOW]);
    expect(el.textContent).toContain('Habilitar sucursal Rancagua');
    expect(el.textContent).toContain('1 / 3 pasos cerrados');
    expect(el.querySelectorAll('.af__step').length).toBe(3);
    expect(el.querySelector('.af__step--done')?.textContent).toContain('Hecho');
    expect(el.querySelector('.af__step--now')?.textContent).toContain('En curso');
    expect(el.querySelector('.af__step--wait')?.textContent).toContain('En espera');
    // El paso en paralelo se une con una flecha punteada.
    expect(el.querySelectorAll('.af__arrow')[1].textContent).toContain('more_horiz');
    // Abre en el paso que va: el de Pedro.
    expect(el.querySelector('.af__step[aria-pressed="true"]')?.textContent).toContain('Configurar red');
  });

  it('sin flujos lo dice y «Flujo nuevo» abre el formulario con dos pasos', async () => {
    const { fixture, el } = await render([]);
    expect(el.textContent).toContain('Sin flujos');
    button(el, 'Flujo nuevo').click();
    fixture.detectChanges();
    await settle();
    http.match(() => true).forEach((r) => r.flush({ data: [] }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.ff__step').length).toBe(2);
    expect(button(el, 'Crear')?.disabled).toBe(true);
  });
});
