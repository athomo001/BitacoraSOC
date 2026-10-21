import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TicketsComponent } from './tickets';
import { SseService } from '../../core/sse/sse.service';
import { Ticket, TicketDetail, TicketScope } from '../../core/tickets/tickets.service';

/** Tickets por área (9.1, diseño aprobado 2026-10-14). */
function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 't1', ticketNumber: 'TKT-2026-00011', ticketType: 'incident', scope: 'general', clientId: 'c1', clientName: 'Netics',
    teamName: null, assigneeUsername: null, status: 'new', impact: 'medium', urgency: 'medium', priority: 'p3_medium',
    title: 'Servidor de archivos sin espacio', description: 'x', slaPausedSeconds: 0, reopenedCount: 0, onHoldSince: null,
    sla: {}, allowedTransitions: ['assigned'], createdAt: '', updatedAt: '', childCount: 0,
    areaId: 'a-infra', areaCode: 'infra', areaName: 'Infraestructura', requestedAreaId: 'a-ti', requestedAreaCode: 'ti', requestedAreaName: 'TI',
    canWork: true, source: 'app', ...overrides,
  };
}

function detail(t: Ticket): TicketDetail {
  return { ticket: { ...t, createdByName: 'Pedro Soto' }, publicTrackingToken: 'tok', publicTrackingPin: null, comments: [], tasks: [], entries: [], totalTimeSpentSeconds: 0, resolvers: [], parent: null, mergedInto: null, children: [] };
}

const SCOPE: TicketScope = {
  all: false,
  myAreas: [{ id: 'a-infra', code: 'infra', name: 'Infraestructura', resolves: true }],
  areas: [
    { id: 'a-soc', code: 'soc', name: 'SOC', resolves: true },
    { id: 'a-ti', code: 'ti', name: 'TI', resolves: true },
    { id: 'a-infra', code: 'infra', name: 'Infraestructura', resolves: true },
    { id: 'a-csm', code: 'csm', name: 'CSM', resolves: false },
  ],
  defaultArea: 'infra',
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const summary = { open: 1, breached: 0, paused: 0, resolvedToday: 0 };

describe('Ticketera: tickets por área (9.1)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TicketsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(t: Ticket) {
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/tickets/scope').flush({ data: SCOPE });
    await settle();
    const list = httpMock.expectOne((r) => r.url === '/api/tickets');
    list.flush({ data: { items: [t], total: 1, summary } });
    await settle();
    fixture.detectChanges();
    httpMock.expectOne(`/api/tickets/${t.id}`).flush({ data: detail(t) });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, firstQueue: list.request.params.get('queue') };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
  const fact = (el: HTMLElement, label: string) => [...el.querySelectorAll('.td__facts dt')].find((d) => d.textContent?.trim() === label)?.nextElementSibling;

  it('parte en la cola de su área y cambia a «Pedidos por mi área»', async () => {
    const { fixture, el, firstQueue } = await render(ticket({}));
    expect(firstQueue).toBe('mine');
    const tabs = [...el.querySelectorAll('[role="tab"].seg')].map((b) => b.textContent?.trim());
    expect(tabs).toEqual(['inboxCola de Infraestructura', 'outboxPedidos por mi área']);
    expect(fact(el, 'Área')?.textContent).toContain('Infraestructura');
    expect(fact(el, 'Pedido por')?.textContent).toContain('TI · Pedro Soto');
    expect(el.querySelector('.tk__ticket-sub')?.textContent).toContain('pedido por TI');

    button(el, 'Pedidos por mi área').click();
    fixture.detectChanges();
    expect(httpMock.expectOne((r) => r.url === '/api/tickets').request.params.get('queue')).toBe('asked');
  });

  it('lo que pidió su área a otra: lo ve y comenta, pero no lo trabaja', async () => {
    const { el } = await render(ticket({ canWork: false, areaCode: 'ti', areaName: 'TI', requestedAreaCode: 'infra', requestedAreaName: 'Infraestructura' }));
    expect(el.textContent).toContain('Lo pidió tu área: ves el avance y puedes comentar; lo trabaja TI.');
    expect(button(el, 'Derivar')).toBeUndefined();
    expect(button(el, 'Tomar')).toBeUndefined();
    expect(el.querySelector('select[name="ticketTeam"]')).toBeNull();
    expect(el.querySelector('.td__textarea')).not.toBeNull(); // comentar sí
  });

  it('derivar pide área y motivo, y manda el cambio', async () => {
    const { fixture, el } = await render(ticket({}));
    button(el, 'Derivar a otra área').click();
    await settle();
    fixture.detectChanges();
    const options = [...el.querySelectorAll('.td__facts .seg')].map((b) => b.textContent?.trim());
    expect(options).toEqual(['SOC', 'TI']); // ni la propia ni CSM (no resuelve)
    const ti = [...el.querySelectorAll<HTMLButtonElement>('.td__facts .seg')].find((x) => x.textContent?.trim() === 'TI')!;
    ti.click();
    fixture.detectChanges();
    expect(ti.getAttribute('aria-pressed')).toBe('true');
    const reason = el.querySelector('textarea[name="deriveReason"]') as HTMLTextAreaElement;
    reason.value = 'Es un problema de cuentas';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    const go = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'alt_routeDerivar')!;
    expect(go.disabled).toBe(false);
    go.click();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/tickets/t1/area' });
    expect(req.request.body).toEqual({ area: 'ti', reason: 'Es un problema de cuentas' });
  });
});
