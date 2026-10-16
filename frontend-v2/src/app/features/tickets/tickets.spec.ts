import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TicketsComponent } from './tickets';
import { SseService } from '../../core/sse/sse.service';
import { AuthService } from '../../core/auth/auth.service';
import { Ticket, TicketDetail } from '../../core/tickets/tickets.service';
import { SetupService } from '../../core/setup/setup.service';
import { PermissionsService } from '../../core/auth/permissions.service';
import { provideRouter } from '@angular/router';

const clock = (state: string, percent: number, remainingSeconds: number) => ({ state, percent, remainingSeconds, elapsedSeconds: 0, dueAt: '2026-09-27T07:15:00Z' });

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 't1', ticketNumber: 'TKT-2026-00042', ticketType: 'incident', scope: 'noc', clientId: 'c1', clientName: 'Red Bancaria Austral',
    teamName: 'Cuadrilla Fibra Sur', assigneeUsername: null, status: 'new', impact: 'high', urgency: 'high', priority: 'p1_critical',
    title: 'Corte FO Nodo Puerto Montt', description: 'x', slaPausedSeconds: 0, reopenedCount: 0, onHoldSince: null,
    sla: { resolution: clock('on_time', 30, 10_500) as Ticket['sla']['resolution'] }, allowedTransitions: ['assigned', 'cancelled'],
    createdAt: '', updatedAt: '', childCount: 0,
    areaId: 'a-soc', areaCode: 'soc', areaName: 'SOC', requestedAreaId: 'a-soc', requestedAreaCode: 'soc', requestedAreaName: 'SOC', canWork: true, ...overrides,
  };
}

const LIST = {
  items: [ticket({}), ticket({ id: 't2', ticketNumber: 'TKT-2026-00040', priority: 'p2_high', status: 'in_progress', sla: { resolution: clock('breached', 100, -720) as Ticket['sla']['resolution'] }, allowedTransitions: ['pending_vendor', 'resolved'] })],
  total: 2,
  summary: { open: 2, breached: 1, paused: 0, resolvedToday: 3 },
};

function detail(t: Ticket): TicketDetail {
  return { ticket: t, publicTrackingToken: 'tok', publicTrackingPin: null, comments: [], tasks: [], entries: [], totalTimeSpentSeconds: 0, resolvers: [], parent: null, mergedInto: null, children: [] };
}

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('TicketsComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TicketsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    // Tickets por área (9.1): primero las colas del usuario.
    httpMock.match('/api/tickets/scope').forEach((r) => r.flush({ data: { all: true, myAreas: [], areas: [{ id: 'a-soc', code: 'soc', name: 'SOC', resolves: true }], defaultArea: 'soc' } }));
    await settle();
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

  it('la nota de una entrada vinculada y la pestaña Bitácora llevan a la entrada', async () => {
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    httpMock.match('/api/tickets/scope').forEach((r) => r.flush({ data: { all: true, myAreas: [], areas: [{ id: 'a-soc', code: 'soc', name: 'SOC', resolves: true }], defaultArea: 'soc' } }));
    await settle();
    httpMock.expectOne((r) => r.url === '/api/tickets').flush({ data: LIST });
    await settle();
    fixture.detectChanges();
    const entryId = '341efad1-32c4-4fb8-8600-25a8fc83efe9';
    httpMock.expectOne('/api/tickets/t1').flush({
      data: {
        ...detail(LIST.items[0]),
        comments: [{ id: 'c1', authorName: 'despinoza', content: `Entrada de bitácora vinculada: ${entryId}`, isPublic: false, createdAt: new Date().toISOString(), images: [], origin: '' }],
        entries: [{ id: entryId, content: 'se murió alguien', authorUsername: 'despinoza', createdAt: new Date().toISOString() }],
      },
    });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const note = el.querySelector('.td__entry-ref') as HTMLElement;
    expect(note.textContent).toContain('Se vinculó una entrada de la bitácora.');
    expect(note.textContent).not.toContain(entryId);
    // «Ver la entrada» la abre en un popup, sin salir del ticket.
    (note.querySelector('button') as HTMLButtonElement).click();
    await settle();
    httpMock.expectOne(`/api/entries/${entryId}`).flush({
      data: { id: entryId, authorUsername: 'despinoza', entryType: 'incidente', scope: 'general', content: 'se murió alguien', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [{ id: 'k1', entryId, authorUsername: 'despinoza', comment: 'al final no se murió', isSystemGenerated: false, createdAt: new Date().toISOString() }] },
    });
    await settle();
    fixture.detectChanges();
    const popup = document.querySelector('app-entry-preview-dialog') as HTMLElement;
    expect(popup.textContent).toContain('se murió alguien');
    expect(popup.textContent).toContain('al final no se murió');
    expect(popup.querySelector('a')?.getAttribute('href')).toBe(`/entries?entry=${entryId}`);
    (popup.querySelector('.ep__foot .adm-btn--primary') as HTMLButtonElement).click();
    await settle();
    // La pestaña Bitácora abre el mismo popup.
    ([...el.querySelectorAll('.td__tab')].find((b) => b.textContent?.includes('Bitácora')) as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('button.td__entry') as HTMLButtonElement).click();
    await settle();
    httpMock.expectOne(`/api/entries/${entryId}`);
  });

  it('clic en el número lo copia sin abrir otro ticket, y dice «Copiado»', async () => {
    const { fixture, el } = await render();
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void written.push(t) } });
    const second = el.querySelectorAll('.tk__row:not(.tk__row--head)')[1];
    (second.querySelector('.tk__copy') as HTMLElement).click();
    await settle();
    fixture.detectChanges();
    expect(written).toEqual(['TKT-2026-00040']);
    expect(second.querySelector('.tk__copy')?.textContent).toContain('Copiado');
    // No abrió el segundo ticket: sigue el primero en el panel.
    httpMock.expectNone('/api/tickets/t2');
    (el.querySelector('.td__copy') as HTMLButtonElement).click();
    await settle();
    expect(written).toEqual(['TKT-2026-00040', 'TKT-2026-00042']);
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

  it('lugar (#24): con NOC se ve en la lista y el panel, y se elige con el buscador', async () => {
    const perms = TestBed.inject(PermissionsService) as unknown as { _user: { set(u: unknown): void } };
    perms._user.set({ id: 'u-ana', username: 'ana', role: 'admin' });
    TestBed.inject(SetupService).applyModules({ socEnabled: false, nocEnabled: true });
    LIST.items[1] = { ...LIST.items[1], place: { territorialUnitId: 'z1', name: 'Calama', parentName: 'Antofagasta', assetId: 'a1', assetName: 'RT-CAL-06' } };
    const { fixture, el } = await render();
    expect(el.querySelectorAll('.tk__row:not(.tk__row--head)')[1].textContent).toContain('· Calama');
    const dd = [...el.querySelectorAll('.td__facts dt')].find((d) => d.textContent?.trim() === 'Lugar')!.nextElementSibling!;
    expect(dd.textContent).toContain('Sin lugar');

    [...dd.querySelectorAll('button')].find((b) => b.textContent?.includes('Elegir lugar'))!.click();
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/territorial-units').flush({
      data: [{ id: 'r1', parentId: null, kind: 'region', name: 'Antofagasta', code: 'r1', path: 'r1', depth: 0, active: true }, { id: 'z1', parentId: 'r1', kind: 'zone', name: 'Calama', code: 'z1', path: 'r1.z1', depth: 1, active: true }],
      meta: { page: 1, pageSize: 5000, total: 2 },
    });
    httpMock.expectOne('/api/assets').flush({ data: [{ id: 'a1', type: 'device', name: 'RT-CAL-06', code: 'rt', territorialUnitId: 'z1' }] });
    await settle();
    const search = el.querySelector('input[name="placeSearch"]') as HTMLInputElement;
    search.value = 'cal';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const options = [...el.querySelectorAll<HTMLButtonElement>('.pp__opt')];
    expect(options.map((o) => o.textContent?.trim())).toEqual(['placeCalamaAntofagasta', 'routerRT-CAL-06Calama']);
    options[1].click();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/tickets/t1/place' });
    expect(req.request.body).toEqual({ territorialUnitId: undefined, assetId: 'a1' });
    req.flush({ data: detail(LIST.items[0]) });
    await settle();
    httpMock.match('/api/tickets/t1').forEach((r) => r.flush({ data: detail(ticket({ place: { territorialUnitId: 'z1', name: 'Calama', assetId: 'a1', assetName: 'RT-CAL-06' } })) }));
    await settle();
    fixture.detectChanges();
    expect(dd.textContent).toContain('Calama · RT-CAL-06');
    delete LIST.items[1].place;
  });

  it('un comentario es interno salvo que se marque visible al cliente', async () => {
    const { fixture, el } = await render();
    const textarea = el.querySelector('.td__textarea') as HTMLTextAreaElement;
    textarea.value = 'Cuadrilla en sitio';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.td__composer') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = httpMock.expectOne({ method: 'POST', url: '/api/tickets/t1/comments' });
    expect(req.request.body).toEqual({ content: 'Cuadrilla en sitio', isPublic: false, imageIds: [], alsoChildren: false });
  });

  it('imágenes: pegar una captura la sube, queda en miniatura y el comentario la incluye (comentario del dueño #14)', async () => {
    globalThis.URL.createObjectURL ??= () => 'blob:prueba';
    globalThis.URL.revokeObjectURL ??= () => undefined;
    const { fixture, el } = await render();
    const textarea = el.querySelector('.td__textarea') as HTMLTextAreaElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'captura.png', { type: 'image/png' });
    const paste = new Event('paste') as Event & { clipboardData: unknown };
    paste.clipboardData = { files: [file] };
    textarea.dispatchEvent(paste);
    const upload = httpMock.expectOne({ method: 'POST', url: '/api/tickets/t1/images' });
    expect((upload.request.body as FormData).get('image')).toBe(file);
    upload.flush({ data: { id: 'img-1', fileName: 'captura.png', sizeBytes: 4, createdAt: '' } });
    await settle();
    fixture.detectChanges();
    expect(el.querySelectorAll('.td__pending')).toHaveLength(1);
    // Sin texto, pero con imagen: se puede comentar.
    (el.querySelector('.td__composer') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = httpMock.expectOne({ method: 'POST', url: '/api/tickets/t1/comments' });
    expect(req.request.body).toEqual({ content: '', isPublic: false, imageIds: ['img-1'], alsoChildren: false });
  });

  it('imágenes: la pestaña junta las de todos los comentarios y las pide con el token', async () => {
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    // Tickets por área (9.1): primero las colas del usuario.
    httpMock.match('/api/tickets/scope').forEach((r) => r.flush({ data: { all: true, myAreas: [], areas: [{ id: 'a-soc', code: 'soc', name: 'SOC', resolves: true }], defaultArea: 'soc' } }));
    await settle();
    httpMock.expectOne((r) => r.url === '/api/tickets').flush({ data: LIST });
    await settle();
    fixture.detectChanges();
    const withImages = detail(LIST.items[0]);
    withImages.comments = [
      { id: 'c1', authorName: 'ana', content: 'Captura', isPublic: false, createdAt: '2026-09-27T10:00:00Z', origin: '', images: [{ id: 'a', fileName: 'a.png', sizeBytes: 10, createdAt: '2026-09-27T10:00:00Z' }] },
      { id: 'c2', authorName: 'pveloso', content: 'Correo', isPublic: true, createdAt: '2026-09-27T11:00:00Z', origin: '', images: [{ id: 'b', fileName: 'b.jpg', sizeBytes: 10, createdAt: '2026-09-27T11:00:00Z' }] },
    ];
    httpMock.expectOne('/api/tickets/t1').flush({ data: withImages });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tab = [...el.querySelectorAll<HTMLButtonElement>('.td__tab')].find((b) => b.textContent?.includes('Imágenes'))!;
    expect(tab.textContent).toContain('2');
    tab.click();
    fixture.detectChanges();
    const names = [...el.querySelectorAll('.td__gallery-name')].map((n) => n.textContent);
    expect(names).toEqual(['b.jpg', 'a.png']); // la más nueva primero
    // Se piden por HttpClient (el interceptor pone el token), no con un <img src> directo.
    expect(httpMock.match((r) => r.url.startsWith('/api/tickets/t1/images/')).map((r) => r.request.url).sort()).toEqual([
      '/api/tickets/t1/images/a',
      '/api/tickets/t1/images/b',
    ]);
  });

  it('cambiar el filtro vuelve a pedir la cola con el tipo', async () => {
    const { el } = await render();
    const incidents = [...el.querySelectorAll<HTMLButtonElement>('.tk__filters .seg')].find((b) => b.textContent?.trim() === 'Incidentes');
    incidents?.click();
    const req = httpMock.expectOne((r) => r.url === '/api/tickets');
    expect(req.request.params.get('ticketType')).toBe('incident');
  });
});
