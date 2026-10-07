import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TicketsComponent } from './tickets';
import { SseService } from '../../core/sse/sse.service';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionsService } from '../../core/auth/permissions.service';
import { Ticket, TicketDetail } from '../../core/tickets/tickets.service';

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 't50', ticketNumber: 'TKT-2026-00050', ticketType: 'incident', scope: 'noc', clientId: 'c-int', clientName: 'Interno · NOC',
    teamName: null, assigneeUsername: null, status: 'in_progress', impact: 'high', urgency: 'high', priority: 'p1_critical',
    title: 'Caída fibra troncal Sur', description: 'x', slaPausedSeconds: 0, reopenedCount: 0, onHoldSince: null,
    sla: {}, allowedTransitions: ['pending_vendor', 'resolved'], createdAt: '2026-10-07T04:58:00Z', updatedAt: '', childCount: 0, ...overrides,
  };
}

const PARENT = ticket({ childCount: 2, createdById: 'u-ana' });
const CHILD_A = ticket({ id: 't51', ticketNumber: 'TKT-2026-00051', title: 'Sin servicio Osorno', clientName: 'Red Bancaria Austral', parentId: 't50', parentNumber: 'TKT-2026-00050' });
const OTHER = ticket({ id: 't54', ticketNumber: 'TKT-2026-00054', title: 'Phishing a gerencia', clientId: 'c-banco', clientName: 'Banco Austral', createdById: 'u-ana', createdAt: '2026-10-07T10:02:00Z' });
const DUP = ticket({ id: 't55', ticketNumber: 'TKT-2026-00055', title: 'Phishing al gerente', clientId: 'c-banco', clientName: 'Banco Austral', createdById: 'u-luis', createdAt: '2026-10-07T10:05:00Z' });

function detail(t: Ticket, extra: Partial<TicketDetail> = {}): TicketDetail {
  return { ticket: t, publicTrackingToken: 'tok', publicTrackingPin: null, comments: [], tasks: [], entries: [], totalTimeSpentSeconds: 0, resolvers: [], parent: null, mergedInto: null, children: [], ...extra };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Ticketera: unir, padre/hijo y cambiar cliente (canvas aprobado 2026-10-07)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TicketsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
    (TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } })._user.set({ id: 'u-ana', username: 'ana' });
  });

  /** Lista → detalle del primero (o del pedido). */
  async function render(list: Ticket[], first: TicketDetail, caps: string[] = []) {
    const perms = TestBed.inject(PermissionsService) as unknown as { _user: { set(u: unknown): void }; _caps: { set(c: unknown): void } };
    perms._user.set({ id: 'u-ana', username: 'ana', role: 'user' });
    perms._caps.set({ moduleScope: 'both', capabilities: caps });
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/tickets').flush({ data: { items: list, total: list.length, summary: { open: 1, breached: 0, paused: 0, resolvedToday: 0 } } });
    await settle();
    fixture.detectChanges();
    httpMock.expectOne(`/api/tickets/${first.ticket.id}`).flush({ data: first });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('la lista pone los hijos bajo su padre y marca "N hijos"', async () => {
    const { el } = await render([CHILD_A, OTHER, PARENT], detail(CHILD_A, { parent: { id: 't50', ticketNumber: 'TKT-2026-00050', title: 'Caída fibra troncal Sur' } }));
    const rows = [...el.querySelectorAll('.tk__row:not(.tk__row--head)')].map((r) => r.querySelector('.tk__number')?.textContent?.trim());
    expect(rows).toEqual(['TKT-2026-00054', 'TKT-2026-00050', '↳ TKT-2026-00051']);
    expect(el.textContent).toContain('2 hijos');
    // El hijo dice de quién es hijo.
    expect(el.querySelector('app-ticket-relations')?.textContent).toContain('Hijo de TKT-2026-00050');
  });

  it('en el padre: avance de los hijos, el comentario llega a los hijos abiertos y resolver pregunta por ellos', async () => {
    const children = [
      { id: 't51', ticketNumber: 'TKT-2026-00051', title: 'Sin servicio Osorno', status: 'in_progress' as const, clientName: 'Red Bancaria Austral' },
      { id: 't53', ticketNumber: 'TKT-2026-00053', title: 'Frutillar', status: 'resolved' as const, clientName: 'TelcoSur' },
    ];
    const { fixture, el } = await render([PARENT], detail(PARENT, { children }));
    expect(el.textContent).toContain('1 / 2 resueltos');
    expect(button(el, 'También en los 1 hijos abiertos')).toBeTruthy();

    const textarea = el.querySelector('.td__textarea') as HTMLTextAreaElement;
    textarea.value = 'Empalme terminado';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.td__composer') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const comment = httpMock.expectOne({ method: 'POST', url: '/api/tickets/t50/comments' });
    expect(comment.request.body.alsoChildren).toBe(true);
    comment.flush({ data: {} });
    await settle();
    httpMock.expectOne('/api/tickets/t50').flush({ data: detail(PARENT, { children }) });
    await settle();
    httpMock.match((r) => r.url === '/api/tickets').forEach((r) => r.flush({ data: { items: [PARENT], total: 1, summary: { open: 1, breached: 0, paused: 0, resolvedToday: 0 } } }));
    await settle();
    fixture.detectChanges();

    // "Resolver" en un padre con hijos abiertos abre el diálogo en vez de resolver directo.
    button(el.querySelector('.td__actions') as HTMLElement, 'Resolver').click();
    fixture.detectChanges();
    httpMock.expectNone({ method: 'PATCH', url: '/api/tickets/t50' });
    const dialog = el.querySelector('.tr__dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Resolver también los 1 hijos abiertos');
    const solution = dialog.querySelector('textarea[name="solution"]') as HTMLTextAreaElement;
    solution.value = 'Servicio normalizado';
    solution.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(dialog.querySelector('.tr__dialog-foot') as HTMLElement, 'Resolver').click();
    await settle();
    const public1 = httpMock.expectOne({ method: 'POST', url: '/api/tickets/t50/comments' });
    expect(public1.request.body).toEqual({ content: 'Servicio normalizado', isPublic: true, imageIds: [], alsoChildren: true });
    public1.flush({ data: {} });
    await settle();
    const patch = httpMock.expectOne({ method: 'PATCH', url: '/api/tickets/t50' });
    expect(patch.request.body).toEqual({ status: 'resolved', alsoChildren: true });
  });

  it('unir: busca el duplicado, propone el más antiguo y envía motivo', async () => {
    const { fixture, el } = await render([DUP, OTHER], detail(DUP));
    // ana no creó TKT-55 ni es admin: no ve "Unir con…" en este.
    expect(button(el, 'Unir con')).toBeUndefined();
    el.querySelectorAll<HTMLButtonElement>('.tk__row:not(.tk__row--head)')[1].click();
    fixture.detectChanges();
    httpMock.expectOne('/api/tickets/t54').flush({ data: detail(OTHER) });
    await settle();
    fixture.detectChanges();
    button(el, 'Unir con').click();
    fixture.detectChanges();
    const dialog = el.querySelector('.tr__dialog') as HTMLElement;
    const number = dialog.querySelector('input[name="mergeNumber"]') as HTMLInputElement;
    number.value = 'tkt-2026-00055';
    number.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(dialog, 'Buscar').click();
    const search = httpMock.expectOne((r) => r.url === '/api/tickets' && r.params.get('q') === 'TKT-2026-00055');
    search.flush({ data: { items: [DUP], total: 1, summary: { open: 1, breached: 0, paused: 0, resolvedToday: 0 } } });
    await settle();
    fixture.detectChanges();
    const cards = [...dialog.querySelectorAll('.tr__card')].map((c) => c.textContent);
    expect(cards[0]).toContain('Queda'); // TKT-54 es el más antiguo
    const reason = dialog.querySelector('input[name="reason"]') as HTMLInputElement;
    reason.value = 'Mismo phishing';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(dialog.querySelector('.tr__dialog-foot') as HTMLElement, 'Unir').click();
    const merge = httpMock.expectOne({ method: 'POST', url: '/api/tickets/merge' });
    expect(merge.request.body).toEqual({ mainId: 't54', otherId: 't55', reason: 'Mismo phishing' });
  });

  it('cambiar cliente: solo con el permiso; pide motivo', async () => {
    const without = await render([OTHER], detail(OTHER));
    expect(button(without.el, 'Cambiar cliente')).toBeUndefined();
    without.fixture.destroy();

    const { fixture, el } = await render([OTHER], detail(OTHER), ['tickets:change_client']);
    button(el, 'Cambiar cliente').click();
    fixture.detectChanges();
    httpMock.match((r) => r.url === '/api/organizations').forEach((r) => r.flush({ data: [{ id: 'c-banco', name: 'Banco Austral', type: 'client', active: true }, { id: 'c-minera', name: 'Minera Andina', type: 'client', active: true }] }));
    await settle();
    fixture.detectChanges();
    const dialog = el.querySelector('.tr__dialog') as HTMLElement;
    const options = [...dialog.querySelectorAll('select[name="newClient"] option')].map((o) => o.textContent?.trim());
    expect(options).not.toContain('Banco Austral'); // el actual no se ofrece
    const select = dialog.querySelector('select[name="newClient"]') as HTMLSelectElement;
    select.value = 'c-minera';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(button(dialog.querySelector('.tr__dialog-foot') as HTMLElement, 'Cambiar cliente').disabled).toBe(true); // falta el motivo
    const reason = dialog.querySelector('input[name="reason"]') as HTMLInputElement;
    reason.value = 'Se registró mal';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(dialog.querySelector('.tr__dialog-foot') as HTMLElement, 'Cambiar cliente').click();
    const put = httpMock.expectOne({ method: 'PUT', url: '/api/tickets/t54/client' });
    expect(put.request.body).toEqual({ clientId: 'c-minera', reason: 'Se registró mal' });
  });
});
