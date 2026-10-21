import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ManagementComponent } from './management';
import { SseService } from '../../core/sse/sse.service';
import { ClientHealth, Goal, Indicators, MgmtClient, MgmtClientDetail, MgmtMeta } from '../../core/management/management.service';
import { GoalDetailComponent } from './goal-detail';
import { MgmtIndicatorsComponent } from './mgmt-indicators';

const settle = () => new Promise((resolve) => setTimeout(resolve));

const META: MgmtMeta = { slaTarget: 95, me: 'u-lucia', admin: false, gestion: true, leadAreas: [], csms: [{ id: 'u-lucia', name: 'Lucía Vera' }], people: [] };

function health(state: ClientHealth['state'], over: Partial<ClientHealth> = {}): ClientHealth {
  return {
    state, reasons: [],
    tickets: { state: 'green', open: 0, breached: 0 },
    contact: { state: 'green', contactDays: 10, contactKind: 'meeting', meetingDays: 10, meetingKind: 'meeting', fromBaseline: false },
    keyTasks: { state: 'green', late: 0 },
    ...over,
  };
}

const CASINOS: MgmtClient = {
  id: 'c1', name: 'Casinos', active: true, csmId: 'u-lucia', csmName: 'Lucía Vera', mine: true, renewal: '2026-12-31', renewalDays: 73,
  openTickets: 2, breached: 1, lateActions: 1,
  health: health('red', {
    reasons: [{ code: 'ticketBreached', ticket: 'TKT-2026-00039', count: 1 }, { code: 'keyLate', task: 'Avisar la ventana del sábado', count: 1 }],
    tickets: { state: 'red', open: 2, breached: 1, first: 'TKT-2026-00039' },
    keyTasks: { state: 'amber', late: 1, first: 'Avisar la ventana del sábado' },
  }),
};
const NETICS: MgmtClient = { id: 'c2', name: 'Netics', active: true, csmId: 'u-tomas', csmName: 'Tomás Rivas', mine: false, openTickets: 0, breached: 0, lateActions: 0,
  health: health('green'), nextAction: { name: 'Reunión con gerencia', due: '2026-10-30' } };
const JUNJI: MgmtClient = { id: 'c3', name: 'JUNJI vía Mundo', active: true, mine: false, openTickets: 1, breached: 0, lateActions: 0,
  health: health('amber', { reasons: [{ code: 'noMeeting', days: 41 }] }) };

function detail(c: MgmtClient, over: Partial<MgmtClientDetail> = {}): MgmtClientDetail {
  return {
    client: c, figures: { onTimePct: 81, slaPct: 88, slaTarget: 95, openLate: 2, avgResponseSecs: 540, avgResolutionSecs: 22_320 },
    tickets: [], actions: [], goals: [], comms: [], timeline: [], renewal: [], applied: {}, ...over,
  };
}

describe('Gestión CSM (9.4)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('bitacora.mgmt.scope');
    TestBed.configureTestingModule({
      imports: [ManagementComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(first: MgmtClientDetail) {
    const fixture = TestBed.createComponent(ManagementComponent);
    fixture.detectChanges();
    http.expectOne('/api/management/meta').flush({ data: META });
    http.expectOne('/api/management/clients').flush({ data: [NETICS, JUNJI, CASINOS] });
    http.expectOne('/api/tickets/scope').flush({ data: { all: true, myAreas: [], defaultArea: 'soc', areas: [{ id: 'a-soc', code: 'soc', name: 'SOC', resolves: true }] } });
    await settle();
    fixture.detectChanges();
    http.expectOne(`/api/management/clients/${first.client.id}`).flush({ data: first });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('ordena por atención, dice el motivo bajo el color y filtra «Mis cuentas»', async () => {
    const { fixture, el } = await render(detail(CASINOS));
    const rows = [...el.querySelectorAll('.mc__row:not(.mc__row--head)')];
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Casinos', 'JUNJI vía Mundo', 'Netics']);
    expect(rows[0].textContent).toContain('TKT-2026-00039 fuera de SLA');
    expect(rows[0].textContent).toContain('Renueva en 73 días');
    expect(rows[1].textContent).toContain('Sin reunión en +30 días');
    expect(rows[2].textContent).toContain('Próximo: Reunión con gerencia');
    ([...el.querySelectorAll<HTMLButtonElement>('.adm-tab')].find((b) => b.textContent?.includes('Mis cuentas')))!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.mc__row:not(.mc__row--head)')).toHaveLength(1);
    expect(localStorage.getItem('bitacora.mgmt.scope')).toBe('mine');
  });

  it('la ficha muestra la salud con sus componentes, la cuenta regresiva y las cifras del mes', async () => {
    const { el } = await render(detail(CASINOS, {
      renewal: [
        { name: 'Revisar la salud y los indicadores', due: '2026-10-02', status: 'done', closedAt: '2026-10-02T15:00:00Z' },
        { name: 'Propuesta de renovación', due: '2026-11-02', status: 'pending' },
        { name: 'Reunión con gerencia', due: '2026-12-01', status: 'pending' },
      ],
      actions: [{ occurrenceId: 'o1', taskId: 't1', name: 'Avisar la ventana del sábado', kind: 'contact', key: true, due: '2026-10-15', late: true, assigneeKind: 'level', area: 'SOC', level: 'N2' }],
    }));
    const status = el.querySelector('.mc__status')!.textContent!;
    expect(status).toContain('En riesgo');
    expect(status).toContain('1 fuera de SLA: TKT-2026-00039');
    expect(status).toContain('faltan 73 días');
    expect(el.querySelector('.mc__rnstep--next')?.textContent).toContain('Propuesta de renovación');
    expect(el.querySelector('.mc__figs')?.textContent).toContain('88 %');
    expect(el.querySelector('.mc__figs')?.textContent).toContain('9 min');
    const action = el.querySelector('.mc__tr--a')!.textContent!;
    expect(action).toContain('clave');
    expect(action).toContain('SOC N2 · sin tomar');
    expect(action).toContain('Atrasada');
  });

  it('sin nada abierto, «Cuenta al día» con accesos directos', async () => {
    const { el } = await render(detail(CASINOS));
    expect(el.querySelector('.mc__clear')?.textContent).toContain('Cuenta al día');
    expect(el.querySelector('.mc__clear')?.textContent).toContain('Aplicar «Revisión trimestral»');
  });

  it('una acción de seguimiento es una tarea de la Agenda con tipo, clave y ticket', async () => {
    const { fixture, el } = await render(detail(CASINOS, {
      tickets: [{ id: 'tk1', number: 'TKT-2026-00039', title: 'Fuerza bruta en VPN', area: 'SOC', priority: 'p2_high', status: 'in_progress', source: 'app' }],
    }));
    (el.querySelector('.mc__tr--t .adm-icon-btn') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/agenda/meta').flush({ data: { today: '2026-10-20', workDays: [1, 2, 3, 4, 5], dayStart: '08:00', dayEnd: '20:00', holidays: {}, me: 'u-lucia', admin: false, viewAll: true, leadAreas: [], crossArea: true,
      areas: [{ id: 'a-csm', code: 'csm', name: 'CSM', mine: true, lead: false, myRank: 0, levels: [], people: [], guards: [] },
        { id: 'a-soc', code: 'soc', name: 'SOC', mine: false, lead: false, myRank: 0, levels: [{ id: 'l-n2', name: 'N2', rank: 2, allowed: true }], people: [], guards: [] }] } });
    await settle();
    fixture.detectChanges();
    const dlg = document.querySelector('app-mgmt-action-dialog') as HTMLElement;
    ([...dlg.querySelectorAll<HTMLButtonElement>('.seg')].find((b) => b.textContent?.includes('Avisar al cliente')))!.click();
    (dlg.querySelector('input[name="actKey"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await settle();
    ([...dlg.querySelectorAll<HTMLButtonElement>('app-button button')].find((b) => b.textContent?.includes('Crear acción')))!.click();
    const req = http.expectOne('/api/agenda/tasks');
    expect(req.request.body).toMatchObject({
      name: 'Avisar al cliente: TKT-2026-00039', areaId: 'a-csm', clientId: 'c1', assigneeKind: 'person', assigneeId: 'u-lucia',
      recurrence: { kind: 'once', date: '2026-10-20' }, actionKind: 'contact', isKey: true, ticketId: 'tk1',
    });
    req.flush({ data: {} });
    await settle();
  });
});

describe('Detalle de una meta', () => {
  let http: HttpTestingController;
  const GOAL: Goal = {
    id: 'g5', name: 'Certificación CompTIA Security+', scope: 'person', personId: 'u-camila', personName: 'Camila Rojas', kind: 'certification', bonus: 'primary',
    dueDate: '2026-12-15', bizDaysLeft: 40, evidenceRequired: true, evidenceCount: 0, manualRisk: false, autoRisk: false, state: 'open',
    milestones: 3, milestonesDone: 2, canEdit: false, canMark: true, canConfirm: false,
    steps: [
      { id: 's1', name: 'Inscripción en el curso', doneAt: '2026-09-28T12:00:00Z', doneByName: 'Camila', doneSource: 'manual' },
      { id: 's2', name: 'Curso terminado', ticketId: 'tk9', ticketNumber: 'TKT-2026-00052', ticketStatus: 'in_progress', ticketArea: 'SOC' },
      { id: 's3', name: 'Examen aprobado' },
    ],
    events: [], evidence: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GoalDetailComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(goal: Goal) {
    const fixture = TestBed.createComponent(GoalDetailComponent);
    fixture.componentRef.setInput('goalId', goal.id);
    fixture.detectChanges();
    http.expectOne(`/api/goals/${goal.id}`).flush({ data: goal });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('un hito enlazado se marca solo y sin certificado no se puede marcar cumplida', async () => {
    const { el } = await render(GOAL);
    const steps = el.querySelectorAll<HTMLButtonElement>('.gt__check');
    expect(steps[1].disabled).toBe(true);
    expect(steps[1].textContent).toContain('TKT-2026-00052');
    expect(steps[1].textContent).toContain('se marca solo');
    expect(el.querySelector('.gt__bono')?.textContent).toContain('primaria');
    expect(el.textContent).toContain('Falta el certificado');
    const done = [...el.querySelectorAll<HTMLButtonElement>('.gt__actions button')].find((b) => b.textContent?.includes('Marcar cumplida'))!;
    expect(done.disabled).toBe(true);
    steps[2].click();
    const req = http.expectOne('/api/goals/g5/milestones/s3/done');
    expect(req.request.body).toEqual({ done: true });
    req.flush({ data: GOAL });
  });

  it('la jefatura confirma la que cuenta para el bono', async () => {
    const { el } = await render({ ...GOAL, state: 'confirm', canConfirm: true, evidenceCount: 1, milestonesDone: 3 });
    expect(el.querySelector('.gt__note--info')?.textContent).toContain('espera la confirmación de la jefatura');
    ([...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Confirmar para el bono')))!.click();
    http.expectOne('/api/goals/g5/confirm').flush({ data: { ...GOAL, state: 'done', confirmedByName: 'Jefatura SOC', confirmedAt: '2026-10-20T15:00:00Z' } });
    await settle();
  });
});

describe('Indicadores', () => {
  let http: HttpTestingController;
  const DATA: Indicators = {
    by: 'client', period: 'month', from: '2026-10-01', to: '2026-10-20', months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'], slaTarget: 95,
    rows: [
      { id: 'c1', name: 'Casinos', onTimePct: 81, slaPct: 88, slaTarget: 95, openLate: 2, avgResponseSecs: 540, avgResolutionSecs: 22_320, trend: [96, 94, 93, 91, 89, 88] },
      { id: 'c2', name: 'Netics', onTimePct: 96, slaPct: 100, slaTarget: 95, openLate: 0, avgResponseSecs: 360, avgResolutionSecs: 11_160, trend: [97, 98, 99, 100, 99, 100] },
      { id: 'c3', name: 'Sin datos', onTimePct: -1, slaPct: -1, slaTarget: 95, openLate: 0, avgResponseSecs: 0, avgResolutionSecs: 0, trend: [-1, -1, -1, -1, -1, -1] },
    ],
    load: [{ id: 'a1', name: 'SOC', tickets: 42, slaPct: 94 }, { id: 'a2', name: 'NOC', tickets: 31, slaPct: 82 }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MgmtIndicatorsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  it('compara los de SLA más bajo, marca los que están bajo el objetivo y se pueden quitar del gráfico', async () => {
    const fixture = TestBed.createComponent(MgmtIndicatorsComponent);
    fixture.componentRef.setInput('meta', META);
    fixture.componentRef.setInput('clients', []);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/management/indicators').flush({ data: DATA });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // Los dos con datos van al gráfico, con leyenda y etiqueta directa; el que no tiene datos, no.
    expect([...el.querySelectorAll('.mi__lg')].map((b) => b.textContent?.trim())).toEqual(['Casinos', 'Netics']);
    expect(el.querySelectorAll('svg path')).toHaveLength(2);
    expect([...el.querySelectorAll('text.mi__dl')].map((t) => t.textContent?.trim())).toContain('Casinos 88 %');
    expect(el.querySelector('.mi__below-list')?.textContent).toContain('Casinos · 88 %');
    expect(el.querySelector('.mi__lrows')?.textContent).toContain('42');
    const boxes = el.querySelectorAll<HTMLInputElement>('.mi__pick input');
    boxes[0].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('svg path')).toHaveLength(1);
    expect(el.querySelector('table')?.textContent).toContain('—');
  });
});
