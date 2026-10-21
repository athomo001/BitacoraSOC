import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ManagementComponent } from './management';
import { SseService } from '../../core/sse/sse.service';
import { ClientHealth, Goal, Indicators, MgmtClient, MgmtClientDetail, MgmtMeta } from '../../core/management/management.service';
import { GoalDetailComponent } from './goal-detail';
import { MgmtIndicatorsComponent } from './mgmt-indicators';
import { MgmtGoalsComponent } from './mgmt-goals';

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

  it('las notas internas: pestaña con contador, fijada arriba, solo el autor edita y «Crear acción» lleva el texto', async () => {
    const { fixture, el } = await render(detail(CASINOS, { notesCount: 2 }));
    const tab = [...el.querySelectorAll<HTMLButtonElement>('.adm-tab')].find((b) => b.textContent?.includes('Notas'))!;
    expect(tab.textContent).toContain('2');
    tab.click();
    fixture.detectChanges();
    const notes = [
      { id: 'n1', authorId: 'u-tomas', authorName: 'Tomás Rivas', content: 'Avisos de ventana: al jefe de TI.\nSiempre por correo.', pinned: true, editedAt: null, createdAt: '2026-10-01T12:00:00Z', mine: false },
      { id: 'n2', authorId: 'u-lucia', authorName: 'Lucía Vera', content: 'Quieren sumar las sucursales del norte.', pinned: false, editedAt: null, createdAt: '2026-10-15T12:00:00Z', mine: true },
    ];
    http.expectOne('/api/management/clients/c1/notes').flush({ data: notes });
    await settle();
    fixture.detectChanges();
    const cards = [...el.querySelectorAll<HTMLElement>('.mn__note')];
    expect(cards[0].classList).toContain('mn__note--pinned');
    expect(cards[0].textContent).toContain('Desfijar');
    expect(cards[0].textContent).not.toContain('Editar');
    expect(cards[1].textContent).toContain('Editar');

    // Fijar una nota ajena: cualquiera de CSM.
    ([...cards[0].querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Desfijar')))!.click();
    const pin = http.expectOne('/api/management/notes/n1/pin');
    expect(pin.request.body).toEqual({ pinned: false });
    pin.flush({ data: { ...notes[0], pinned: false } });
    await settle();
    http.expectOne('/api/management/clients/c1/notes').flush({ data: notes });
    await settle();

    // Guardar una nota nueva.
    const box = el.querySelector('textarea[name="noteNew"]') as HTMLTextAreaElement;
    box.value = '  Renovación: decide el gerente general.  ';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ([...el.querySelectorAll<HTMLButtonElement>('.mn__composer button')].find((b) => b.textContent?.includes('Guardar nota')))!.click();
    const create = http.expectOne((r) => r.method === 'POST' && r.url === '/api/management/clients/c1/notes');
    expect(create.request.body).toEqual({ content: 'Renovación: decide el gerente general.' });
    create.flush({ data: {} });
    await settle();
    http.expectOne('/api/management/clients/c1/notes').flush({ data: [...notes, { ...notes[1], id: 'n3' }] });
    await settle();
    fixture.detectChanges();
    expect(tab.textContent).toContain('3');

    // «Crear acción» abre «Nueva acción» con la primera línea de la nota.
    ([...el.querySelectorAll<HTMLElement>('.mn__note')][0].querySelectorAll<HTMLButtonElement>('button'))
      .forEach((b) => b.textContent?.includes('Crear acción') && b.click());
    await settle();
    http.expectOne('/api/agenda/meta').flush({ data: { today: '2026-10-21', workDays: [1, 2, 3, 4, 5], dayStart: '08:00', dayEnd: '20:00', holidays: {}, me: 'u-lucia', admin: false, viewAll: true, leadAreas: [], crossArea: true,
      areas: [{ id: 'a-csm', code: 'csm', name: 'CSM', mine: true, lead: false, myRank: 0, levels: [], people: [], guards: [] }] } });
    await settle();
    fixture.detectChanges();
    expect((document.querySelector('app-mgmt-action-dialog input[name="actName"]') as HTMLInputElement).value).toBe('Avisos de ventana: al jefe de TI.');
  });

  it('sin el perfil Gestión no hay pestaña de notas', async () => {
    const fixture = TestBed.createComponent(ManagementComponent);
    fixture.detectChanges();
    http.expectOne('/api/management/meta').flush({ data: { ...META, gestion: false, leadAreas: ['soc'] } });
    http.expectOne('/api/management/clients').flush({ data: [CASINOS] });
    http.expectOne('/api/tickets/scope').flush({ data: { all: true, myAreas: [], defaultArea: 'soc', areas: [] } });
    await settle();
    fixture.detectChanges();
    http.expectOne('/api/management/clients/c1').flush({ data: detail(CASINOS) });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.mc')).toBeTruthy();
    expect([...el.querySelectorAll('.adm-tab')].some((b) => b.textContent?.includes('Notas'))).toBe(false);
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

  it('un hito enlazado se marca solo y sin certificado no se puede marcar lograda', async () => {
    const { el } = await render(GOAL);
    const steps = el.querySelectorAll<HTMLButtonElement>('.gt__check');
    expect(steps[1].disabled).toBe(true);
    expect(steps[1].textContent).toContain('TKT-2026-00052');
    expect(steps[1].textContent).toContain('se marca solo');
    expect(el.querySelector('.gt__bono')?.textContent).toContain('primaria');
    expect(el.textContent).toContain('Falta el certificado');
    const done = [...el.querySelectorAll<HTMLButtonElement>('.gt__actions button')].find((b) => b.textContent?.includes('Marcar lograda'))!;
    expect(done.disabled).toBe(true);
    steps[2].click();
    const req = http.expectOne('/api/goals/g5/milestones/s3/done');
    expect(req.request.body).toEqual({ done: true });
    req.flush({ data: GOAL });
  });

  it('la jefatura confirma la meta con escalón', async () => {
    const { el } = await render({ ...GOAL, state: 'confirm', canConfirm: true, evidenceCount: 1, milestonesDone: 3 });
    expect(el.querySelector('.gt__note--info')?.textContent).toContain('espera la confirmación de la jefatura');
    ([...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Confirmar lograda')))!.click();
    http.expectOne('/api/goals/g5/confirm').flush({ data: { ...GOAL, state: 'done', confirmedByName: 'Jefatura SOC', confirmedAt: '2026-10-20T15:00:00Z' } });
    await settle();
  });

  it('rindió y no pasó: la jefatura la marca no lograda con el motivo, y queda el dato', async () => {
    const { fixture, el } = await render({ ...GOAL, canOutcome: true });
    ([...el.querySelectorAll<HTMLButtonElement>('.gt__actions button')].find((b) => b.textContent?.includes('No lograda')))!.click();
    fixture.detectChanges();
    const reason = el.querySelector('input[name="notAchievedReason"]') as HTMLInputElement;
    reason.value = 'Reprobó el examen';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ([...el.querySelectorAll<HTMLButtonElement>('.gt__actions button')].find((b) => b.textContent?.includes('Marcar no lograda')))!.click();
    const req = http.expectOne('/api/goals/g5/not-achieved');
    expect(req.request.body).toEqual({ reason: 'Reprobó el examen' });
    req.flush({ data: { ...GOAL, state: 'failed', outcomeReason: 'Reprobó el examen', canOutcome: false } });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.gt__note--warn')?.textContent).toContain('No lograda: Reprobó el examen.');
  });

  it('la que dejó de hacer falta dice por qué y no se reabre a mano', async () => {
    const { el } = await render({ ...GOAL, bonus: 'tertiary', state: 'not_needed', outcomeReason: 'Logró la meta secundaria «ISO 27001»', canEdit: true });
    expect(el.textContent).toContain('No hace falta: Logró la meta secundaria «ISO 27001».');
    expect(el.querySelector('.gt__bono')?.textContent).toContain('Meta terciaria');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Reabrir'))).toBe(false);
  });
});

describe('Metas por persona', () => {
  let http: HttpTestingController;
  const base = { kind: 'certification' as const, evidenceRequired: false, evidenceCount: 0, manualRisk: false, autoRisk: false, bizDaysLeft: 30, milestones: 2, milestonesDone: 0, canEdit: true, canMark: true, canConfirm: false };
  const GOALS: Goal[] = [
    { ...base, id: 'g3', name: 'Fortinet NSE 1', scope: 'person', personId: 'u-mf', personName: 'Matias Fuentes', bonus: 'tertiary', dueDate: '2027-02-28', state: 'not_needed', personRule: 'any', canRule: true },
    { ...base, id: 'g1', name: 'Btrust BCIE', scope: 'person', personId: 'u-mf', personName: 'Matias Fuentes', bonus: 'primary', dueDate: '2026-12-15', state: 'failed', personRule: 'any', canRule: true },
    { ...base, id: 'g2', name: 'ISO 27001', scope: 'person', personId: 'u-mf', personName: 'Matias Fuentes', bonus: 'secondary', dueDate: '2027-01-30', state: 'done', personRule: 'any', canRule: true },
    { ...base, id: 'g9', name: 'Renovar contrato', scope: 'client', clientId: 'c1', clientName: 'Casinos', dueDate: '2026-12-31', state: 'open' },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MgmtGoalsComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  it('una fila por persona, con sus metas por escalón y la regla que se cambia ahí mismo', async () => {
    const fixture = TestBed.createComponent(MgmtGoalsComponent);
    fixture.componentRef.setInput('meta', META);
    fixture.componentRef.setInput('clients', [CASINOS]);
    fixture.componentRef.setInput('areas', []);
    fixture.detectChanges();
    http.expectOne('/api/goals').flush({ data: GOALS });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    http.match((r) => r.url.startsWith('/api/goals/')).forEach((r) => r.flush({ data: GOALS[0] }));
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('.adm-tab')];
    expect(tabs.find((t) => t.textContent?.includes('Personas'))?.textContent).toContain('1');
    expect(tabs.find((t) => t.textContent?.includes('Todas'))?.textContent).toContain('2');
    ([...el.querySelectorAll<HTMLButtonElement>('.seg')].find((b) => b.textContent?.includes('Todas')))!.click();
    fixture.detectChanges();
    await settle();
    http.match((r) => r.url.startsWith('/api/goals/')).forEach((r) => r.flush({ data: GOALS[0] }));
    fixture.detectChanges();

    const people = el.querySelectorAll('.mgo__person');
    expect(people.length).toBe(1);
    expect(people[0].textContent).toContain('Matias Fuentes');
    expect(people[0].textContent).toContain('1 lograda');
    expect(people[0].textContent).toContain('1 no lograda');
    expect(people[0].textContent).toContain('1 no hace falta');
    const ranks = [...el.querySelectorAll('.mgo__row--in .mgo__bono')].map((b) => b.textContent?.trim());
    expect(ranks).toEqual(['Meta primaria', 'Meta secundaria', 'Meta terciaria']);
    expect(el.textContent).not.toContain('Bono');

    const select = el.querySelector('select[name="goalRule"]') as HTMLSelectElement;
    expect(select.value).toBe('any');
    select.value = 'primary';
    select.dispatchEvent(new Event('change'));
    const req = http.expectOne('/api/goal-rules/u-mf');
    expect(req.request.body).toEqual({ rule: 'primary' });
    req.flush({ data: { rule: 'primary' } });
    await settle();
    http.expectOne('/api/goals').flush({ data: GOALS.map((g) => (g.personId ? { ...g, personRule: 'primary', state: g.id === 'g3' ? 'open' : g.state } : g)) });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.mgo__person')?.textContent).toContain('Basta la primaria');
    expect(el.querySelector('.mgo__person')?.textContent).toContain('1 en curso');
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
