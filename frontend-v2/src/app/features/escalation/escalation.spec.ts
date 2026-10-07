import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { EscalationComponent } from './escalation';

const phone = (n: string) => [{ channelType: 'call', value: n, preferred: true, href: `tel:${n}` }];
const member = (id: string, name: string, channels: unknown[] = [], pool?: { id: string; name: string }, poolPosition = 0) => ({
  id: `m-${id}`, contactId: `c-${id}`, name, roleInTeam: 'primary', recipientType: 'to', priority: 0, onCallNow: false, channels,
  ...(pool ? { pool, poolPosition } : {}),
});
const MUNDO = { id: 'p-mundo', name: 'Mundo' };

const RESOLUTION = {
  resolvedVia: 'service',
  policyId: 'p1',
  scope: { serviceId: 's1' },
  reminder: 'Llamar 3 veces y 1 minuto por cada llamada',
  steps: [
    {
      order: 1, mode: 'pool', waitBeforeEscalateMinutes: 0,
      team: {
        id: 't1', name: 'QRADAR · DPP', kind: 'escalation', audience: 'client',
        members: [member('andrea', 'Andrea Pino', phone('+56933334444')), member('jorge', 'Jorge Herrera', phone('+56911112222'), MUNDO, 0), member('mario', 'Mario Aránguiz', phone('+56955556666'), MUNDO, 1)],
      },
    },
    { order: 2, mode: 'unique', waitBeforeEscalateMinutes: 0, team: { id: 't2', name: 'DPP · 1er llamado', kind: 'escalation', audience: 'client', members: [member('anibal', 'Aníbal Ortiz', phone('+56922221111'))] } },
  ],
};
const INCIDENT = { id: 'i1', serviceId: 's1', title: 'Virus en equipo de RRHH', glpiTicket: '5799', openedBy: 'ana', openedAt: '2026-10-05T18:02:00Z' };

describe('EscalationComponent (flujo de llamados, canvas v26)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EscalationComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

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
  });

  it('al escribir en Zona propone lo más probable primero, sin importar tildes', async () => {
    const fixture = TestBed.createComponent(EscalationComponent);
    fixture.detectChanges();
    answerModules({ socEnabled: false, nocEnabled: true }, 'noc');
    await tick();
    httpMock.expectOne('/api/assets').flush({ data: [] });
    const unit = (id: string, name: string, code: string, depth: number) => ({ id, name, code, kind: depth ? 'region' : 'country', depth, active: true });
    httpMock.expectOne((r) => r.url === '/api/territorial-units').flush({
      data: [unit('u0', 'Chile', 'CL', 0), unit('u1', 'Aisén del General Carlos Ibáñez del Campo', 'CL-AI', 1), unit('u2', 'Los Ríos', 'CL-LR', 1), unit('u3', 'Río Ibáñez', 'CL-AI-RI', 2)],
      meta: { page: 1, pageSize: 5000, total: 4 },
    });
    httpMock.match((r) => r.url === '/api/organizations').forEach((r) => r.flush({ data: [] }));
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    ([...el.querySelectorAll('.esc__segs .seg')].find((b) => b.textContent?.trim() === 'Zona') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = el.querySelector('input[name="scopeTarget"]') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    input.value = 'rio';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const labels = () => [...el.querySelectorAll('.pick__opt .pick__label')].map((o) => o.textContent?.trim());
    expect(labels()).toEqual(['Río Ibáñez', 'Los Ríos']);

    input.value = 'aisen';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(labels()[0]).toBe('Aisén del General Carlos Ibáñez del Campo');

    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('.pick__list')?.textContent).toContain('Sin coincidencias');

    input.value = 'cl-lr';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    fixture.detectChanges();
    expect(httpMock.match((r) => r.url === '/api/escalation/resolve' && r.params.get('territorialUnitId') === 'u2').length).toBe(1);
    expect(input.value).toBe('Los Ríos');
  });

  async function render(incidents: unknown[] = [INCIDENT]) {
    const fixture = TestBed.createComponent(EscalationComponent);
    fixture.detectChanges();
    answerModules({ socEnabled: true, nocEnabled: false }, 'soc');
    await tick();
    httpMock.expectOne('/api/services').flush({ data: [{ id: 's1', organizationId: 'o-dpp', organizationName: 'DPP', name: 'QRADAR', code: 'DPP-QRADAR', active: true }] });
    httpMock.expectOne((r) => r.url === '/api/organizations').flush({ data: [{ id: 'o-dpp', name: 'DPP', code: 'dpp', type: 'client', active: true, viaName: 'Mundo' }] });
    await tick();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input[name="scopeTarget"]') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    input.value = 'qrad';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    httpMock.expectOne((r) => r.url === '/api/escalation/resolve').flush({ data: RESOLUTION });
    httpMock.expectOne((r) => r.url === '/api/escalation/incidents').flush({ data: incidents });
    await tick();
    if (incidents.length) {
      httpMock.expectOne((r) => r.url === '/api/escalation/actions' && r.params.get('incidentId') === 'i1').flush({ data: [] });
      httpMock.expectOne('/api/escalation/incidents/i1/notes').flush({ data: [] });
    }
    await tick();
    httpMock.match((r) => r.url === '/api/maintenance-windows').forEach((r) => r.flush({ data: [] }));
    await tick();
    fixture.detectChanges();
    const rowOf = (name: string) => [...el.querySelectorAll('.rows li')].find((r) => r.textContent?.includes(name)) as HTMLElement;
    const buttonIn = (scope: Element, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    return { fixture, el, rowOf, buttonIn };
  }

  it('destaca servicio y cliente, el flujo con el recordatorio y el pool como una fila', async () => {
    const { el } = await render();
    expect(el.querySelector('.hero')?.textContent).toContain('QRADAR');
    expect(el.querySelector('.hero')?.textContent).toContain('DPP');
    expect(el.querySelector('.hero')?.textContent).toContain('Mundo');
    expect(el.querySelector('.incident--active')?.textContent).toContain('GLPI #5799');
    const cards = [...el.querySelectorAll('.flow__card')].map((c) => c.textContent?.replace(/\s+/g, ' '));
    expect(cards[0]).toContain('Pool Mundo (2)');
    expect(cards[1]).toContain('Aníbal Ortiz · +56922221111');
    expect(el.querySelector('.flow__reminder')?.textContent).toContain('Llamar 3 veces');
    expect(el.querySelector('.row--pool')?.textContent).toContain('Siguiente: Jorge Herrera');
  });

  it('"No contesta" registra el intento en el incidente y el flujo pasa al nivel siguiente', async () => {
    const { fixture, el, rowOf, buttonIn } = await render();
    buttonIn(rowOf('Andrea Pino'), 'No contesta').click();
    const req = httpMock.expectOne('/api/escalation/actions');
    expect(req.request.body).toMatchObject({ serviceId: 's1', stepOrder: 1, memberId: 'm-andrea', result: 'no_answer', incidentId: 'i1' });
    req.flush({ data: { actionLog: { id: 'a1', stepOrder: 1, contactId: 'c-andrea', channelType: 'call', result: 'no_answer', operatorId: 'u1', incidentId: 'i1', createdAt: '2026-10-05T18:05:00Z' }, escalatedToNextStep: true, exhausted: false, nextStepOrder: 2 } });
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('.flow__card--current')?.textContent).toContain('DPP · 1er llamado');
    expect(buttonIn(rowOf('Aníbal Ortiz'), 'Contestó')).toBeTruthy();
  });

  it('sin incidente pide crearlo, enlazado a GLPI, y el comentario va a su historial', async () => {
    const { fixture, el, buttonIn } = await render([]);
    expect(el.textContent).toContain('Crea o elige un incidente');
    const title = el.querySelector('input[name="incTitle"]') as HTMLInputElement;
    title.value = 'Phishing a gerencia';
    title.dispatchEvent(new Event('input'));
    const glpi = el.querySelector('input[name="glpi"]') as HTMLInputElement;
    glpi.value = '5812';
    glpi.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonIn(el, 'Crear y escalar').click();
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === '/api/escalation/incidents');
    expect(req.request.body).toEqual({ serviceId: 's1', title: 'Phishing a gerencia', glpiTicket: '5812' });
    req.flush({ data: { ...INCIDENT, title: 'Phishing a gerencia', glpiTicket: '5812' } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/escalation/actions').flush({ data: [] });
    httpMock.expectOne('/api/escalation/incidents/i1/notes').flush({ data: [] });
    await tick();
    fixture.detectChanges();
    const comment = el.querySelector('textarea[name="comment"]') as HTMLTextAreaElement;
    comment.value = 'El cliente aisló el equipo';
    comment.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonIn(el.querySelector('.forensic__comment') as HTMLElement, 'Comentar').click();
    const note = httpMock.expectOne((r) => r.method === 'POST' && r.url === '/api/escalation/incidents/i1/notes');
    expect(note.request.body).toEqual({ note: 'El cliente aisló el equipo' });
    note.flush({ data: { id: 'n1', note: 'El cliente aisló el equipo', username: 'ana', createdAt: '2026-10-05T18:10:00Z' } });
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('.forensic')?.textContent).toContain('El cliente aisló el equipo');
  });
});
