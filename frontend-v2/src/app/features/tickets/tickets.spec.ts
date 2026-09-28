import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TicketsComponent } from './tickets';
import { SseService } from '../../core/sse/sse.service';
import { AuthService } from '../../core/auth/auth.service';
import { Ticket, TicketDetail } from '../../core/tickets/tickets.service';

const clock = (state: string, percent: number, remainingSeconds: number) => ({ state, percent, remainingSeconds, elapsedSeconds: 0, dueAt: '2026-09-27T07:15:00Z' });

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 't1', ticketNumber: 'TKT-2026-00042', ticketType: 'incident', scope: 'noc', clientId: 'c1', clientName: 'Red Bancaria Austral',
    teamName: 'Cuadrilla Fibra Sur', assigneeUsername: null, status: 'new', impact: 'high', urgency: 'high', priority: 'p1_critical',
    title: 'Corte FO Nodo Puerto Montt', description: 'x', slaPausedSeconds: 0, reopenedCount: 0, onHoldSince: null,
    sla: { resolution: clock('on_time', 30, 10_500) as Ticket['sla']['resolution'] }, allowedTransitions: ['assigned', 'cancelled'],
    createdAt: '', updatedAt: '', ...overrides,
  };
}

const LIST = {
  items: [ticket({}), ticket({ id: 't2', ticketNumber: 'TKT-2026-00040', priority: 'p2_high', status: 'in_progress', sla: { resolution: clock('breached', 100, -720) as Ticket['sla']['resolution'] }, allowedTransitions: ['pending_vendor', 'resolved'] })],
  total: 2,
  summary: { open: 2, breached: 1, paused: 0, resolvedToday: 3 },
};

function detail(t: Ticket): TicketDetail {
  return { ticket: t, publicTrackingToken: 'tok', publicTrackingPin: null, comments: [], tasks: [], entries: [], totalTimeSpentSeconds: 0 };
}

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('TicketsComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TicketsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/tickets').flush({ data: LIST });
    await settle();
    fixture.detectChanges();
    httpMock.expectOne('/api/tickets/t1').flush({ data: detail(LIST.items[0]) });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra el resumen de la cola y la tabla con prioridad, estado y SLA legibles', async () => {
    const { el } = await render();
    expect(el.querySelector('.tk__summary')?.textContent).toContain('1 SLA vencido');
    const rows = el.querySelectorAll('.tk__row:not(.tk__row--head)');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('P1');
    expect(rows[0].textContent).toContain('Nuevo');
    expect(rows[0].textContent).toContain('Quedan 2 h 55 min');
    expect(rows[1].textContent).toContain('Vencido hace 12 min');
    expect(rows[1].querySelector('.tk__sla')?.classList).toContain('text-bad');
  });

  it('selecciona el primero y muestra solo las transiciones válidas', async () => {
    const { el } = await render();
    const buttons = [...el.querySelectorAll('.td__actions button')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['person_addTomar', 'blockCancelar ticket']);
  });

  it('"Tomar" asigna el ticket a quien lo toma', async () => {
    const auth = TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } };
    auth._user.set({ id: 'u-ana', username: 'ana' });
    const { fixture, el } = await render();
    (el.querySelector('.td__actions button') as HTMLButtonElement).click();
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/tickets/t1' });
    expect(req.request.body).toEqual({ status: 'assigned', assignedUserId: 'u-ana' });
    req.flush({ data: ticket({ status: 'assigned', allowedTransitions: ['in_progress', 'cancelled'] }) });
    await settle();
    httpMock.expectOne('/api/tickets/t1').flush({ data: detail(ticket({ status: 'assigned' })) });
    await settle();
    httpMock.match((r) => r.url === '/api/tickets').forEach((r) => r.flush({ data: LIST }));
  });

  it('un comentario es interno salvo que se marque visible al cliente', async () => {
    const { fixture, el } = await render();
    const textarea = el.querySelector('.td__textarea') as HTMLTextAreaElement;
    textarea.value = 'Cuadrilla en sitio';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.td__composer') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = httpMock.expectOne({ method: 'POST', url: '/api/tickets/t1/comments' });
    expect(req.request.body).toEqual({ content: 'Cuadrilla en sitio', isPublic: false });
  });

  it('cambiar el filtro vuelve a pedir la cola con el tipo', async () => {
    const { el } = await render();
    const incidents = [...el.querySelectorAll<HTMLButtonElement>('.tk__filters .seg')].find((b) => b.textContent?.trim() === 'Incidentes');
    incidents?.click();
    const req = httpMock.expectOne((r) => r.url === '/api/tickets');
    expect(req.request.params.get('ticketType')).toBe('incident');
  });
});
