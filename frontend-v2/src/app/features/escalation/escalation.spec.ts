import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { EscalationComponent } from './escalation';

const member = (id: string, name: string, channels: unknown[] = []) => ({
  id: `m-${id}`, contactId: `c-${id}`, name, roleInTeam: 'primary', recipientType: 'to', priority: 0, onCallNow: false, channels,
});

const RESOLUTION = {
  resolvedVia: 'territorial_unit',
  policyId: 'p1',
  resolvedUnit: { id: 'u-cal', name: 'Calama', code: 'CL-AN-CALAMA', kind: 'zone' },
  scope: { assetId: 'a1' },
  steps: [
    {
      order: 1, mode: 'sequential', waitBeforeEscalateMinutes: 10,
      team: {
        id: 't1', name: 'Cuadrilla Calama', kind: 'contractor_field', audience: 'internal', organization: { name: 'Contrata Norte', type: 'contractor' },
        members: [
          member('juan', 'Juan Pérez', [
            { channelType: 'call', value: '+56911110001', preferred: true, href: 'tel:+56911110001' },
            { channelType: 'whatsapp', value: '+56911110001', preferred: false, href: 'https://wa.me/56911110001' },
          ]),
          member('pedro', 'Pedro Soto'),
        ],
      },
    },
    { order: 2, mode: 'unique', waitBeforeEscalateMinutes: 15, team: { id: 't2', name: 'Supervisión', kind: 'contractor_field', audience: 'internal', members: [member('carlos', 'Carlos Gómez')] } },
  ],
};

describe('EscalationComponent (tarjetas de escalación)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EscalationComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  /** Estado de la instalación + usuario analista con su alcance SOC/NOC efectivo. */
  function answerModules(flags: { socEnabled: boolean; nocEnabled: boolean }, moduleScope: string) {
    httpMock.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, ...flags } });
    httpMock.expectOne('/api/users/me').flush({ data: { id: 'u1', username: 'ana', role: 'user' } });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope, capabilities: [] } });
  }

  it('sin NOC en el alcance del analista no ofrece activos ni unidades ni los pide', async () => {
    const fixture = TestBed.createComponent(EscalationComponent);
    fixture.detectChanges();
    answerModules({ socEnabled: true, nocEnabled: true }, 'soc');
    await tick();
    httpMock.expectOne('/api/services').flush({ data: [] });
    httpMock.expectNone('/api/assets');
    httpMock.expectNone((r) => r.url === '/api/territorial-units');
    await tick();
    fixture.detectChanges();
    const tabs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.esc__segs .seg')].map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['Servicio']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toMatch(/desactivad/i);
  });

  async function renderResolved() {
    const fixture = TestBed.createComponent(EscalationComponent);
    fixture.detectChanges();
    answerModules({ socEnabled: false, nocEnabled: true }, 'noc');
    await tick();
    httpMock.expectOne('/api/assets').flush({ data: [{ id: 'a1', type: 'device', name: 'Router Calama 1', code: 'RT-CAL-01', territorialUnitId: 'u-cal' }] });
    httpMock.expectOne((r) => r.url === '/api/territorial-units').flush({ data: [], meta: { page: 1, pageSize: 5000, total: 0 } });
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector('select[name="scopeTarget"]') as HTMLSelectElement;
    select.value = 'a1';
    select.dispatchEvent(new Event('change'));
    await tick();
    httpMock.expectOne((r) => r.url === '/api/escalation/resolve' && r.params.get('assetId') === 'a1').flush({ data: RESOLUTION });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/escalation/actions' && r.method === 'GET').flush({ data: [] });
    await tick();
    httpMock.match((r) => r.url === '/api/maintenance-windows').forEach((req) => req.flush({ data: [] }));
    await tick();
    fixture.detectChanges();
    return { fixture, el };
  }

  it('muestra los niveles con el 1 en curso y los canales directos', async () => {
    const { el } = await renderResolved();
    expect(el.textContent).toContain('política de la zona');
    expect(el.textContent).toContain('Nivel 1 · Cuadrilla Calama');
    expect(el.querySelector('[data-step="1"]')?.classList).toContain('level--current');
    expect(el.querySelector('[data-step="2"]')?.classList).toContain('level--pending');
    const links = [...el.querySelectorAll('a.chan')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['tel:+56911110001', 'https://wa.me/56911110001']);
    expect(el.textContent).toContain('Escalar en');
  });

  it('"No contesta" registra el intento y resalta al siguiente del paso', async () => {
    const { fixture, el } = await renderResolved();
    const noAnswer = [...el.querySelectorAll('[data-step="1"] .member')][0].querySelector('.act--bad') as HTMLButtonElement;
    noAnswer.click();
    await tick();
    const req = httpMock.expectOne((r) => r.url === '/api/escalation/actions' && r.method === 'POST');
    expect(req.request.body).toMatchObject({ assetId: 'a1', policyId: 'p1', stepOrder: 1, memberId: 'm-juan', channelType: 'call', result: 'no_answer' });
    req.flush({
      data: {
        actionLog: { id: 'x1', stepOrder: 1, contactId: 'c-juan', contactName: 'Juan Pérez', channelType: 'call', result: 'no_answer', operatorId: 'u1', operatorUsername: 'admin', createdAt: new Date().toISOString() },
        escalatedToNextStep: false, exhausted: false, nextMember: RESOLUTION.steps[0].team.members[1],
      },
    });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Siguiente en este nivel: Pedro Soto');
    const members = [...el.querySelectorAll('[data-step="1"] .member')];
    expect(members[1].classList).toContain('member--next');
    expect(el.querySelector('.forensic')?.textContent).toContain('Juan Pérez');
  });

  it('"Escalar (correo)" registra el escalamiento y avisa por correo al nivel siguiente', async () => {
    const { fixture, el } = await renderResolved();
    const escalate = [...el.querySelectorAll('[data-step="1"] .member')][0].querySelector('.act--warn') as HTMLButtonElement;
    escalate.click();
    await tick();
    const action = httpMock.expectOne((r) => r.url === '/api/escalation/actions' && r.method === 'POST');
    expect(action.request.body).toMatchObject({ stepOrder: 1, memberId: 'm-juan', result: 'escalated_next_tier' });
    action.flush({
      data: {
        actionLog: { id: 'x2', stepOrder: 1, contactId: 'c-juan', contactName: 'Juan Pérez', channelType: 'call', result: 'escalated_next_tier', operatorId: 'u1', operatorUsername: 'admin', createdAt: new Date().toISOString() },
        escalatedToNextStep: true, exhausted: false, nextStepOrder: 2, nextStepTeam: { id: 't2', name: 'Supervisión' },
      },
    });
    await tick();
    const notify = httpMock.expectOne('/api/escalation/notify');
    expect(notify.request.body).toMatchObject({ assetId: 'a1', stepOrder: 2 });
    expect(notify.request.body.message).toContain('Cuadrilla Calama → Supervisión');
    notify.flush({ data: { sent: true, recipients: [{ name: 'Carlos Gómez', email: 'cg@x.cl' }] } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aviso enviado a Carlos Gómez.');
    expect(el.querySelector('[data-step="1"]')?.classList).toContain('level--failed');
  });
});
