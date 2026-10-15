import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { NoticesComponent } from './notices';
import { AdminNotificationsComponent } from '../admin/admin-notifications';

/** Avisos con acuse y Administración → Notificaciones (9.5). */
const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
const AREAS = [{ id: 'a-soc', code: 'soc', name: 'SOC', mine: true, lead: true, myRank: 3, guards: [],
  levels: [{ id: 'n1', name: 'N1', rank: 1, allowed: true }, { id: 'n2', name: 'N2', rank: 2, allowed: true }],
  people: [{ id: 'p1', name: 'Diego', rank: 1, allowed: true }] }];

describe('Avisos con acuse (9.5)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoticesComponent, AdminNotificationsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('crea un aviso para un nivel de un área y muestra quién lo leyó', async () => {
    const fixture = TestBed.createComponent(NoticesComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/notices/meta').flush({ data: { canSend: true, seesAll: false } });
    await settle();
    httpMock.expectOne('/api/notices/sent').flush({ data: [] });
    httpMock.expectOne('/api/agenda/meta').flush({ data: { areas: AREAS } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Nuevo aviso').click();
    fixture.detectChanges();
    const title = el.querySelector('input[name="title"]') as HTMLInputElement;
    title.value = 'Cambio de procedimiento';
    title.dispatchEvent(new Event('input'));
    const body = el.querySelector('textarea[name="body"]') as HTMLTextAreaElement;
    body.value = 'Desde el **lunes**';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(button(el, 'Enviar aviso').disabled).toBe(true);
    button(el, 'SOC').click();
    button(el, 'N2').click();
    fixture.detectChanges();
    button(el, 'Enviar aviso').click();
    const req = httpMock.expectOne('/api/notices');
    expect(req.request.body).toEqual({ title: 'Cambio de procedimiento', body: 'Desde el **lunes**', audience: { kind: 'level', areaIds: ['a-soc'], levelIds: ['n2'] }, publishAt: null, expiresAt: null });
    req.flush({ data: [{ id: 'x1', title: 'Cambio de procedimiento', body: 'Desde el **lunes**', audience: { kind: 'level' }, publishAt: new Date().toISOString(), published: true, createdByName: 'Jefa', total: 2, read: 1 }] });
    await settle();
    httpMock.expectOne('/api/notices/x1/recipients').flush({ data: [{ userId: 'p1', name: 'Diego' }, { userId: 'p2', name: 'Sofía', readAt: new Date().toISOString() }] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('1 faltan');
    expect(el.textContent).toContain('Sin leer');
    button(el, 'Recordar por correo').click();
    httpMock.expectOne('/api/notices/x1/remind').flush({ data: { reminded: 1 } });
    await settle();
    httpMock.expectOne('/api/notices/x1/recipients').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Se le recordó a 1.');
  });

  it('sin permiso no deja crear', async () => {
    const fixture = TestBed.createComponent(NoticesComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/notices/meta').flush({ data: { canSend: false, seesAll: false } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('necesitas el permiso');
    expect(button(el, 'Nuevo aviso')).toBeUndefined();
  });

  it('Administración → Notificaciones guarda lo que no se apaga', async () => {
    const fixture = TestBed.createComponent(AdminNotificationsComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/notifications/settings').flush({ data: { digestTime: '08:00', lockedKinds: ['agenda.late', 'notice'], groupMinutes: 15, retentionDays: 90,
      kinds: [{ kind: 'agenda.late', toastAllowed: true, emailAllowed: true }, { kind: 'ticket.assigned', toastAllowed: true, emailAllowed: false }, { kind: 'notice', toastAllowed: false, emailAllowed: false }] } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(button(el, 'Avisos con acuse').disabled).toBe(true);
    button(el, 'Tickets: te asignaron uno').click();
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = httpMock.expectOne('/api/notifications/settings');
    expect(req.request.body).toEqual({ digestTime: '08:00', lockedKinds: ['agenda.late', 'notice', 'ticket.assigned'], groupMinutes: 15, retentionDays: 90 });
    req.flush({ data: { digestTime: '08:00', lockedKinds: ['agenda.late', 'notice', 'ticket.assigned'], groupMinutes: 15, retentionDays: 90, kinds: [] } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado.');
  });
});
