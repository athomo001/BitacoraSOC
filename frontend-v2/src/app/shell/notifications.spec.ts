import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { NotificationsBellComponent } from './notifications-bell';
import { NotificationToastsComponent } from './notification-toasts';
import { NoticeModalComponent } from './notice-modal';
import { AppNotification, NotificationsService } from '../core/notifications/notifications.service';

/** Centro de notificaciones (9.5, diseño aprobado 2026-10-15). */
const now = new Date().toISOString();
function notif(o: Partial<AppNotification> = {}): AppNotification {
  return { id: 'n1', kind: 'agenda.assigned', title: 'Lucía te asignó «Avisar la ventana»', body: 'SOC · Casinos', link: '/agenda', count: 1,
    toast: true, browser: false, createdAt: now, updatedAt: now, ...o };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Centro de notificaciones (9.5)', () => {
  let httpMock: HttpTestingController;
  let api: NotificationsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotificationsBellComponent, NotificationToastsComponent, NoticeModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(NotificationsService);
  });

  async function start(items: AppNotification[], unread: number, pending: unknown[] = []) {
    const p = api.start('me');
    httpMock.expectOne((r) => r.url === '/api/notifications').flush({ data: { items, unread } });
    await settle();
    httpMock.expectOne('/api/notices/pending').flush({ data: pending });
    await settle();
    httpMock.match('/api/notices/meta').forEach((r) => r.flush({ data: { canSend: true, seesAll: false } }));
    httpMock.match('/api/notifications/prefs').forEach((r) => r.flush({ data: { kinds: [], digest: true, browser: false, digestTime: '08:00' } }));
    await p;
    await settle();
  }

  it('la campana muestra las no leídas, abre el panel y marca todas leídas', async () => {
    await start([notif(), notif({ id: 'n2', kind: 'agenda.late', title: 'Atrasada: «Revisión»', readAt: now })], 1);
    const fixture = TestBed.createComponent(NotificationsBellComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.nb__badge')?.textContent?.trim()).toBe('1');

    (el.querySelector('.nb__btn') as HTMLButtonElement).click();
    httpMock.match((r) => r.url === '/api/notifications').forEach((r) => r.flush({ data: { items: [notif(), notif({ id: 'n2', kind: 'agenda.late', title: 'Atrasada: «Revisión»', readAt: now })], unread: 1 } }));
    await settle();
    fixture.detectChanges();
    // «No leídas» por defecto: solo la de la asignación.
    expect(el.querySelectorAll('.nb__item').length).toBe(1);
    button(el, 'Todas').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.nb__item').length).toBe(2);
    expect(el.textContent).toContain('Avisos con acuse');

    button(el, 'Marcar todas leídas').click();
    const req = httpMock.expectOne('/api/notifications/read');
    expect(req.request.body).toEqual({ ids: [] });
    req.flush({ data: { unread: 0 } });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.nb__badge')).toBeNull();
  });

  it('un evento que nombra al usuario trae el aviso emergente; «Ver» lleva a lo suyo', async () => {
    await start([], 0);
    const fixture = TestBed.createComponent(NotificationToastsComponent);
    fixture.detectChanges();
    api.onEvent('notifications.changed', { users: ['otro'] });
    httpMock.expectNone((r) => r.url === '/api/notifications');
    api.onEvent('notifications.changed', { users: ['me'] });
    httpMock.expectOne((r) => r.url === '/api/notifications').flush({ data: { items: [notif({ id: 'n9' })], unread: 1 } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lucía te asignó');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(el, 'Ver').click();
    httpMock.expectOne('/api/notifications/read').flush({ data: { unread: 0 } });
    await settle();
    expect(nav).toHaveBeenCalledWith('/agenda');
    fixture.detectChanges();
    expect(el.querySelector('.nt__card')).toBeNull();
  });

  it('el aviso con acuse bloquea hasta «Leído» y sale uno tras otro', async () => {
    await start([], 0, [
      { id: 'a1', title: 'Cambio en escalamiento P1', body: 'Desde el **lunes**', publishAt: now, createdByName: 'Jorge Lagos' },
      { id: 'a2', title: 'Corte de energía', body: 'Sábado 22:00', publishAt: now, createdByName: 'Admin' },
    ]);
    const fixture = TestBed.createComponent(NoticeModalComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain('Cambio en escalamiento P1');
    expect(el.textContent).toContain('1 / 2');
    expect(el.querySelector('.app-markdown strong')?.textContent).toBe('lunes');
    button(el, 'Leído').click();
    httpMock.expectOne('/api/notices/a1/read').flush(null);
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Corte de energía');
    button(el, 'Leído').click();
    httpMock.expectOne('/api/notices/a2/read').flush(null);
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
