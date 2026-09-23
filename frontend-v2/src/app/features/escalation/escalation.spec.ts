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

  async function renderResolved() {
    const fixture = TestBed.createComponent(EscalationComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, socEnabled: false, nocEnabled: true } });
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

  it('muestra los pasos con el paso 1 en curso y los canales directos', async () => {
    const { el } = await renderResolved();
    expect(el.textContent).toContain('política de la zona');
    expect(el.textContent).toContain('Paso 1 · Cuadrilla Calama');
    expect(el.querySelector('[data-step="1"]')?.classList).toContain('flow-step--current');
    expect(el.querySelector('[data-step="2"]')?.classList).toContain('flow-step--pending');
    const links = [...el.querySelectorAll('a.chan')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['tel:+56911110001', 'https://wa.me/56911110001']);
    expect(el.textContent).toContain('Escalar en');
  });

  it('"No contesta" registra el intento y resalta al siguiente del paso', async () => {
    const { fixture, el } = await renderResolved();
    const noAnswer = [...el.querySelectorAll('[data-step="1"] .member')][0].querySelector('.res--no_answer') as HTMLButtonElement;
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
    expect(el.textContent).toContain('Siguiente en el paso 1: Pedro Soto');
    const members = [...el.querySelectorAll('[data-step="1"] .member')];
    expect(members[1].classList).toContain('member--next');
    expect(el.querySelector('.timeline')?.textContent).toContain('Juan Pérez');
  });
});
