import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TicketMailComponent } from './ticket-mail';
import { TicketDetail, TicketMails } from '../../core/tickets/tickets.service';

const DETAIL = { ticket: { id: 't1', clientName: 'Banco Austral' } } as unknown as TicketDetail;

function mails(over: Partial<TicketMails> = {}): TicketMails {
  return { mailEnabled: true, clientEnabled: true, affectsClient: true, to: ['ana@banco.cl'], cc: [], custom: false, items: [], ...over };
}

describe('TicketMailComponent (avisos por correo en el ticket)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TicketMailComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(m: TicketMails) {
    const fixture = TestBed.createComponent(TicketMailComponent);
    fixture.componentRef.setInput('detail', DETAIL);
    fixture.detectChanges();
    http.expectOne('/api/tickets/t1/mails').flush({ data: m });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('con los avisos apagados no aparece nada', async () => {
    const { el } = await render(mails({ mailEnabled: false }));
    expect(el.textContent?.trim()).toBe('');
  });

  it('sumar un CC guarda el Para y el CC de este ticket', async () => {
    const { fixture, el } = await render(mails());
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'CC') as HTMLButtonElement).click();
    const input = el.querySelector<HTMLInputElement>('input[type="email"]')!;
    input.value = 'jefe@banco.cl';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Sumar')) as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'PUT', url: '/api/tickets/t1/notify' });
    expect(req.request.body).toEqual({ to: ['ana@banco.cl'], cc: ['jefe@banco.cl'] });
    req.flush({ data: mails({ cc: ['jefe@banco.cl'], custom: true }) });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Cambiados para este ticket');
  });

  it('un envío fallido se puede reenviar', async () => {
    const failed = { id: 'm1', event: 'client.opened', group: 'client' as const, to: ['ana@banco.cl'], cc: [], subject: 's', status: 'failed' as const, attempts: 3, error: 'timeout', createdAt: '2026-10-13T12:00:00Z', sendAfter: '2026-10-13T12:00:00Z' };
    const { fixture, el } = await render(mails({ items: [failed] }));
    expect(el.textContent).toContain('Ticket abierto');
    expect(el.textContent).toContain('Falló');
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Reenviar')) as HTMLButtonElement).click();
    http.expectOne({ method: 'POST', url: '/api/tickets/t1/mails/m1/retry' }).flush(null);
    await settle();
    http.expectOne('/api/tickets/t1/mails').flush({ data: mails() });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Falló');
  });

  it('sin destinatarios lo avisa', async () => {
    const { el } = await render(mails({ to: [], cc: [] }));
    expect(el.textContent).toContain('no se le enviará nada');
  });
});
