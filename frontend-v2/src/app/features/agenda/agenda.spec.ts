import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AgendaComponent } from './agenda';
import { AgendaHandoverComponent } from './agenda-handover';
import { SseService } from '../../core/sse/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { AgendaMeta, AgendaOccurrence, AgendaTask } from '../../core/agenda/agenda.service';
import { dueText, recurrenceText } from './agenda-format';

/** Agenda (9.3, diseño aprobado 2026-10-14). */
const META: AgendaMeta = {
  today: '2026-10-14', workDays: [1, 2, 3, 4, 5], dayStart: '08:00', dayEnd: '20:00',
  holidays: { '2026-10-12': 'Encuentro de Dos Mundos', '2026-10-31': 'Iglesias Evangélicas' },
  areas: [{
    id: 'a-soc', code: 'soc', name: 'SOC', mine: true, lead: false, myRank: 2,
    levels: [{ id: 'n1', name: 'N1', rank: 1, allowed: true }, { id: 'n2', name: 'N2', rank: 2, allowed: false }, { id: 'n3', name: 'N3', rank: 3, allowed: false }],
    people: [{ id: 'me', name: 'Camila', rank: 2, allowed: true }, { id: 'diego', name: 'Diego', rank: 1, allowed: true }, { id: 'rodrigo', name: 'Rodrigo', rank: 2, allowed: false }],
    guards: [{ id: 'g1', name: 'Guardia N2', allowed: true }],
  }],
  me: 'me', admin: false, viewAll: false, leadAreas: [], crossArea: false,
};

function task(o: Partial<AgendaTask> = {}): AgendaTask {
  return {
    id: 't1', name: 'Informe mensual', description: '', areaId: 'a-soc', areaName: 'SOC', clientName: 'Netics', paused: false,
    assigneeKind: 'level', assigneeId: 'n2', assigneeName: 'N2', recurrence: { kind: 'bizN', n: 5 }, warnDays: [0],
    steps: ['Exportar', 'Enviar'], active: true, createdBy: 'lucia', createdByName: 'Lucía', canEdit: false, ...o,
  };
}

function occ(o: Partial<AgendaOccurrence> = {}): AgendaOccurrence {
  return {
    id: 'o1', task: task(), dueDate: '2026-10-14', dueAt: '2026-10-14T20:00:00-03:00', status: 'pending', late: false, bizDays: 0,
    offeredLevel: 'N2', stepsDone: [], onTime: false, byReport: false, mine: true,
    canTake: true, canAct: true, canSkip: true, canRelease: false, canReopen: false, ...o,
  };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Agenda (9.3)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgendaComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(mine: AgendaOccurrence[]) {
    const fixture = TestBed.createComponent(AgendaComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/agenda/meta').flush({ data: META });
    await settle();
    httpMock.expectOne('/api/agenda/mine').flush({ data: mine });
    await settle();
    httpMock.match((r) => r.url === '/api/organizations').forEach((r) => r.flush({ data: [{ id: 'c1', name: 'Netics', code: 'netics', type: 'client', active: true }] }));
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('Mis pendientes: atrasadas arriba, sin tomar, y se toma desde el detalle', async () => {
    const late = occ({ id: 'o0', task: task({ id: 't0', name: 'Revisión de reglas', assigneeKind: 'person', clientName: undefined, steps: [] }),
      dueDate: '2026-10-13', late: true, bizDays: -1, holderId: 'me', holderName: 'Camila', canTake: false, offeredLevel: undefined });
    const { fixture, el } = await render([late, occ()]);
    const groups = [...el.querySelectorAll('.ag__grp')].map((g) => g.textContent?.trim());
    expect(groups[0]).toContain('Atrasadas');
    expect(groups[1]).toContain('Hoy');
    expect(el.textContent).toContain('atrasada 1 día hábil');
    expect(el.textContent).toContain('sin tomar');

    (el.querySelectorAll('.ag__row')[1] as HTMLElement).click();
    fixture.detectChanges();
    const panel = el.querySelector('.ag__panel')!.textContent!;
    expect(panel).toContain('La ven todos los de N2');
    expect(panel).toContain('El 5.º día hábil de cada mes');
    expect(panel).toContain('Lucía');

    button(el, 'Tomar').click();
    httpMock.expectOne('/api/agenda/occurrences/o1/take').flush({ data: occ({ holderId: 'me', holderName: 'Camila', canTake: false }) });
    await settle();
    httpMock.expectOne('/api/agenda/mine').flush({ data: [late, occ({ holderId: 'me', holderName: 'Camila', canTake: false })] });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.ag__panel')!.textContent).not.toContain('La ven todos');
    expect(button(el, 'Marcar hecha')).toBeDefined();
  });

  it('marcar hecha con nota y omitir con motivo', async () => {
    const mine = occ({ holderId: 'me', holderName: 'Camila', canTake: false });
    const { fixture, el } = await render([mine]);
    button(el, 'Marcar hecha').click();
    fixture.detectChanges();
    const note = el.querySelector('textarea[name="doneNote"]') as HTMLTextAreaElement;
    note.value = 'Enviado sin observaciones';
    note.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = httpMock.expectOne('/api/agenda/occurrences/o1/done');
    expect(req.request.body).toEqual({ note: 'Enviado sin observaciones', link: '' });
    req.flush({ data: occ({ status: 'done', note: 'Enviado sin observaciones', closedByName: 'Camila', canReopen: true }) });
    await settle();
    httpMock.expectOne('/api/agenda/mine').flush({ data: [occ({ status: 'done', closedByName: 'Camila', canReopen: true })] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Cerradas hoy');
    expect(button(el, 'Reabrir')).toBeDefined();
  });

  it('el calendario sombrea feriados y pide el rango del mes', async () => {
    const { fixture, el } = await render([]);
    button(el, 'Calendario').click();
    const req = httpMock.expectOne((r) => r.url === '/api/agenda/calendar');
    expect(req.request.params.get('from')).toBe('2026-09-28');
    expect(req.request.params.get('to')).toBe('2026-11-08');
    req.flush({ data: [occ({ dueDate: '2026-10-30', bizDays: 12 })] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Encuentro de Dos Mundos');
    const day12 = [...el.querySelectorAll('.ag__day')].find((d) => d.textContent?.includes('Encuentro'))!;
    expect(day12.classList).toContain('ag__day--off');
    expect(el.querySelector('.ag__chip')!.textContent).toContain('Informe mensual');
  });

  it('nueva tarea: los niveles de arriba salen apagados y se crea con la recurrencia elegida', async () => {
    const { fixture, el } = await render([]);
    button(el, 'Nueva tarea').click();
    fixture.detectChanges();
    httpMock.match((r) => r.url === '/api/organizations').forEach((r) => r.flush({ data: [] }));
    button(el, 'Un nivel').click();
    fixture.detectChanges();
    expect(button(el, 'N3').disabled).toBe(true);
    expect(button(el, 'N1').disabled).toBe(false);
    expect(button(el, 'N1').getAttribute('aria-pressed')).toBe('true');

    button(el, 'Día hábil N del mes').click();
    fixture.detectChanges();
    const name = el.querySelector('input[name="name"]') as HTMLInputElement;
    name.value = 'Informe semanal';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle(300);
    httpMock.match('/api/agenda/preview').forEach((r) => r.flush({ data: [{ date: '2026-11-06' }, { date: '2026-12-24', movedFrom: '2026-12-25', reason: 'Navidad' }] }));
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Navidad');

    button(el, 'Crear tarea').click();
    const req = httpMock.expectOne('/api/agenda/tasks');
    expect(req.request.body).toEqual(expect.objectContaining({
      name: 'Informe semanal', areaId: 'a-soc', assigneeKind: 'level', assigneeId: 'n1', recurrence: { kind: 'bizN', n: 5 }, warnDays: [0],
    }));
    req.flush({ data: task({ name: 'Informe semanal' }) });
    await settle();
    httpMock.expectOne('/api/agenda/mine').flush({ data: [] });
  });

  it('textos: recurrencias y vencimientos', () => {
    const i18n = TestBed.inject(I18nService);
    expect(recurrenceText({ kind: 'fixed', day: 25, shift: 'prev' }, i18n, 'es')).toBe('El día 25 de cada mes; si no es hábil, se adelanta');
    expect(recurrenceText({ kind: 'weekly', weekdays: [1, 3] }, i18n, 'es')).toBe('Cada semana: lun, mié');
    expect(dueText(occ({ bizDays: 3 }), i18n, '20:00')).toBe('en 3 días hábiles');
    expect(dueText(occ({ bizDays: 0 }), i18n, '20:00')).toBe('hoy, 20:00');
    expect(dueText(occ({ late: true, bizDays: 0 }), i18n, '20:00')).toBe('atrasada');
  });
});

describe('Agenda en el cierre de turno', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AgendaHandoverComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('pasa una tarea a quien entra', async () => {
    const fixture = TestBed.createComponent(AgendaHandoverComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/agenda/handover').flush({ data: { items: [occ({ holderId: 'me', canTake: false, canRelease: true })], entering: [{ id: 'rodrigo', name: 'Rodrigo', shift: 'Noche' }] } });
    await settle();
    httpMock.expectOne('/api/agenda/meta').flush({ data: META });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Entra: Rodrigo (Noche)');
    button(el, 'A quien entra').click();
    fixture.detectChanges();
    button(el, 'Aplicar').click();
    const req = httpMock.expectOne('/api/agenda/occurrences/o1/handover');
    expect(req.request.body).toEqual({ userId: 'rodrigo' });
    req.flush({ data: occ() });
    await settle();
    httpMock.expectOne('/api/agenda/handover').flush({ data: { items: [], entering: [] } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Tus tareas');
  });

  it('sin tareas abiertas no muestra nada', async () => {
    const fixture = TestBed.createComponent(AgendaHandoverComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/agenda/handover').flush({ data: { items: [], entering: [] } });
    await settle();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });
});
