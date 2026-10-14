import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminTicketsComponent } from './admin-tickets';
import { TicketSettings } from '../../core/tickets/tickets.service';

const pair = (response: number, resolution: number) => ({ response, resolution });

function settings(over: Partial<TicketSettings['mail']> = {}, smtpConfigured = true): TicketSettings {
  return {
    sla: { p1: pair(60, 480), p2: pair(60, 480), p3: pair(60, 480), p4: pair(60, 480), request: pair(60, 4320) },
    atRiskPercent: 75,
    publicSignature: 'Mesa de Operaciones',
    mail: {
      enabled: false, teamLink: true, skipActor: true, teamEnabled: true, backupEmails: [], clientEnabled: false,
      affectsRule: 'p1p2', commentBatchMinutes: 15, includePin: false, events: ['team.created', 'client.opened'], ...over,
    },
    smtpConfigured,
  };
}

describe('AdminTicketsComponent (Administración → Ticketera)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminTicketsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(s = settings()) {
    const fixture = TestBed.createComponent(AdminTicketsComponent);
    fixture.detectChanges();
    http.expectOne('/api/config/tickets').flush({ data: s });
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('los plazos se editan en horas y se guardan en minutos', async () => {
    const { fixture, el } = await render();
    const p1Resolution = el.querySelectorAll<HTMLInputElement>('.tk__sla input')[1];
    expect(p1Resolution.value).toBe('8');
    p1Resolution.value = '4';
    p1Resolution.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/config/tickets' });
    expect(req.request.body.sla.p1).toEqual({ response: 60, resolution: 240 });
    expect(req.request.body.sla.request).toEqual({ response: 60, resolution: 4320 });
    req.flush({ data: req.request.body });
  });

  it('avisos: copia de respaldo, un evento más y la ventana de comentarios van juntos', async () => {
    const { fixture, el } = await render(settings({ enabled: true }));
    button(el, 'Avisos por correo').click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('input[type="email"]')!;
    input.value = 'noc@empresa.cl';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(el, 'Agregar correo').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('noc@empresa.cl');
    const resolved = [...el.querySelectorAll<HTMLLabelElement>('.tk__event')].find((l) => l.textContent?.includes('Resuelto'))!;
    resolved.querySelector('input')!.click();
    button(el, '30 min').click();
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/config/tickets' });
    expect(req.request.body.mail.backupEmails).toEqual(['noc@empresa.cl']);
    expect(req.request.body.mail.events).toEqual(['team.created', 'client.opened', 'team.resolved']);
    expect(req.request.body.mail.commentBatchMinutes).toBe(30);
    req.flush({ data: req.request.body });
  });

  it('sin servidor de correo no se pueden encender ni probar', async () => {
    const { fixture, el } = await render(settings({}, false));
    button(el, 'Avisos por correo').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Configura el servidor');
    expect((el.querySelector('input[role="switch"]') as HTMLInputElement).disabled).toBe(true);
    expect(button(el, 'Enviarme una prueba').disabled).toBe(true);
  });
});
