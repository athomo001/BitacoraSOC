import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { CalendarFeedComponent } from './calendar-feed';
import { CalendarFeedService } from '../core/calendar/calendar-feed.service';

/** Perfil → Calendario en Outlook (9.7). */
const FEED = { url: 'https://bitacora.test/cal/abc.ics', includeWindows: true, createdAt: '2026-10-15T12:00:00Z' };
const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Calendario en Outlook (9.7)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CalendarFeedComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  it('sin enlace ofrece crearlo y luego lo muestra con los pasos para Outlook', async () => {
    const fixture = TestBed.createComponent(CalendarFeedComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Crear mi enlace').click();
    http.expectOne({ method: 'POST', url: '/api/users/me/calendar' }).flush({ data: FEED });
    await settle();
    fixture.detectChanges();
    expect((el.querySelector('input[name="calendarUrl"]') as HTMLInputElement).value).toBe(FEED.url);
    expect(el.textContent).toContain('Suscribirse desde la web');
    button(el, 'Google Calendar').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Desde URL');
  });

  it('generar uno nuevo pide confirmar antes de invalidar el actual', async () => {
    const fixture = TestBed.createComponent(CalendarFeedComponent);
    fixture.componentRef.setInput('initial', FEED);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Generar uno nuevo').click();
    fixture.detectChanges();
    http.expectNone('/api/users/me/calendar');
    expect(el.textContent).toContain('dejará de funcionar');
    button(el, 'Generar').click();
    http.expectOne({ method: 'POST', url: '/api/users/me/calendar' }).flush({ data: { ...FEED, url: 'https://bitacora.test/cal/new.ics' } });
    await settle();
    fixture.detectChanges();
    expect((el.querySelector('input[name="calendarUrl"]') as HTMLInputElement).value).toContain('new.ics');
  });

  it('con la funcionalidad apagada el servicio dice que no está disponible', async () => {
    const api = TestBed.inject(CalendarFeedService);
    const p = api.mine();
    http.expectOne('/api/users/me/calendar').flush({ title: 'module-disabled' }, { status: 403, statusText: 'Forbidden' });
    expect(await p).toEqual({ available: false, feed: null });
  });
});
