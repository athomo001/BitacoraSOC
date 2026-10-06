import { TestBed } from '@angular/core/testing';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ReportsComponent, defang, salutation } from './reports';

const ORG = { id: 'o1', name: 'Defensoría Penal', code: 'DPP', type: 'client', active: true };
const ALERT = {
  id: 'a1', organizationId: 'o1', organizationName: 'Defensoría Penal', name: 'Control de destinatarios', enabled: true,
  contexts: ['report'], timezone: 'America/Santiago', priority: 100, holidayDates: [], windows: [], channels: [],
  message: '**CONTROL DE DESTINATARIOS DPP**', requiresAck: true, acked: false,
};
const HISTORY = {
  id: 'h1', kind: 'incident', title: 'Ofensa Mg5', subject: '[DPP] Ofensa Mg5 (GLPI-1)', organizationId: 'o1', organizationName: 'Defensoría Penal',
  recipients: ['seguridad@dpp.cl'], cc: ['control@synet.cl'], status: 'sent', sentBy: 'ana', createdAt: '2026-10-03T12:12:00Z', reusable: true,
};

describe('defang y saludo', () => {
  it('defang deja IPs, dominios y URLs sin clic y no toca lo ya defangeado', () => {
    expect(defang('185.220.101.4')).toBe('185[.]220[.]101[.]4');
    expect(defang('https://portal.dpp.cl/login')).toBe('hxxps://portal[.]dpp[.]cl/login');
    expect(defang('185[.]220[.]101[.]4')).toBe('185[.]220[.]101[.]4');
  });

  it('el saludo se propone según la hora', () => {
    expect(salutation(9)).toBe('Buenos días');
    expect(salutation(15)).toBe('Buenas tardes');
    expect(salutation(23)).toBe('Buenas noches');
  });
});

describe('ReportsComponent (comentario del dueño #10)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // sin almacenamiento
    }
    TestBed.configureTestingModule({
      imports: [ReportsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((n) => (n.innerHTML = '')));

  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Responde todo lo pendiente según la URL; devuelve lo atendido. */
  function answer(overrides: Record<string, unknown> = {}): TestRequest[] {
    const reqs = httpMock.match(() => true);
    for (const r of reqs) {
      if (r.cancelled) continue;
      const key = `${r.request.method} ${r.request.url}`;
      if (key in overrides) {
        r.flush(overrides[key] as object);
        continue;
      }
      switch (key) {
        case 'GET /api/users/me':
          r.flush({ data: { id: 'u1', username: 'ana', role: 'user' } });
          break;
        case 'GET /api/users/me/capabilities':
          r.flush({ data: { moduleScope: 'both', capabilities: [] } });
          break;
        case 'GET /api/setup/status':
          r.flush({ data: { setupCompleted: true, socEnabled: true, nocEnabled: true } });
          break;
        case 'GET /api/organizations':
          r.flush({ data: [ORG] });
          break;
        case 'GET /api/services':
          r.flush({ data: [{ id: 's1', organizationId: 'o1', name: 'QRADAR', code: 'QR', active: true }] });
          break;
        case 'GET /api/log-sources':
          r.flush({ data: [] });
          break;
        case 'GET /api/report-operation-types':
          r.flush({ data: [{ id: 't1', name: 'Ofensas', infoDefault: 'Texto por defecto de ofensas.', enabled: true }] });
          break;
        case 'GET /api/reports/history':
          r.flush({ data: [HISTORY], meta: { page: 1, pageSize: 50, total: 1 } });
          break;
        case 'POST /api/reports/incident/preview':
        case 'POST /api/reports/bulletin/preview':
          r.flush({ data: { html: '<html><body>vista</body></html>', title: 'x' } });
          break;
        default:
          r.flush({ data: [] });
      }
    }
    return reqs;
  }

  async function render() {
    const fixture = TestBed.createComponent(ReportsComponent);
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) {
      answer();
      await tick();
    }
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: { detectChanges: () => void; whenStable: () => Promise<unknown> }) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await tick();
  }

  function setValue(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
  }

  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text)) as HTMLButtonElement;

  it('elegir el cliente propone Para/CC del escalamiento y el asunto con su código', async () => {
    const { fixture, el } = await render();
    setValue(el, 'select[name="org"]', 'o1');
    await tick();
    httpMock.expectOne((r) => r.url === '/api/reports/recipients' && r.params.get('organizationId') === 'o1').flush({ data: { to: ['seguridad@dpp.cl'], cc: ['control@synet.cl'] } });
    await tick();
    setValue(el, 'input[name="ticket"]', 'GLPI-1');
    setValue(el, 'input[name="evento"]', 'Ofensa Mg5');
    await settle(fixture);
    expect(el.textContent).toContain('seguridad@dpp.cl');
    expect(el.textContent).toContain('control@synet.cl');
    expect((el.querySelector('input[name="subject"]') as HTMLInputElement).value).toBe('[DPP] Ofensa Mg5 (GLPI-1)');
  });

  it('el tipo de operación rellena "Información adicional" como el legacy', async () => {
    const { fixture, el } = await render();
    setValue(el, 'select[name="tipo"]', 'Ofensas');
    fixture.detectChanges();
    await fixture.whenStable();
    expect((el.querySelector('textarea[name="info"]') as HTMLTextAreaElement).value).toBe('Texto por defecto de ofensas.');
  });

  it('sin los campos obligatorios no envía y dice qué falta', async () => {
    const { fixture, el } = await render();
    button(el, 'Enviar').click();
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Elige el cliente del informe.');
    httpMock.expectNone((r) => r.url.endsWith('/send'));
  });

  it('con aviso del cliente pide "Leí el aviso" antes de enviar y registra el acuse', async () => {
    const { fixture, el } = await render();
    setValue(el, 'select[name="org"]', 'o1');
    await tick();
    httpMock.expectOne((r) => r.url === '/api/reports/recipients').flush({ data: { to: ['seguridad@dpp.cl'], cc: [] } });
    await tick();
    for (const [name, value] of [['ticket', 'GLPI-1'], ['ofensa', '5799'], ['evento', 'Ofensa Mg5']]) setValue(el, `input[name="${name}"]`, value);
    setValue(el, 'select[name="tipo"]', 'Ofensas');
    setValue(el, 'textarea[name="obs"]', 'Intentos fallidos.');
    fixture.detectChanges();

    button(el, 'Enviar').click();
    await tick();
    httpMock.expectOne((r) => r.url === '/api/client-alerts/active' && r.params.get('context') === 'report').flush({ data: [ALERT] });
    await tick();
    fixture.detectChanges();
    const dialog = document.querySelector('app-client-alert-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Aviso de Defensoría Penal antes de enviar');
    expect(dialog.querySelector('strong')?.textContent).toBe('CONTROL DE DESTINATARIOS DPP');
    const confirm = button(dialog, 'Enviar');
    expect(confirm.disabled).toBe(true);
    (dialog.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    TestBed.tick();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await tick();
    httpMock.expectOne((r) => r.url === '/api/client-alerts/a1/ack').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    await tick();
    const send = httpMock.expectOne((r) => r.url === '/api/reports/incident/send');
    expect(send.request.body.to).toEqual(['seguridad@dpp.cl']);
    expect(send.request.body.subject).toBe('[DPP] Ofensa Mg5 (GLPI-1)');
    expect(send.request.body.greeting).toMatch(/^Buen(os|as) (días|tardes|noches),\n\n/);
    expect(send.request.body.incident.informacionAdicional).toBe('Texto por defecto de ofensas.');
    send.flush({ data: { status: 'sent', batches: 1, failures: [], historyId: 'h2' } });
    await tick();
    answer();
    await settle(fixture);
    expect(el.textContent).toContain('Enviado ✓');
    expect((el.querySelector('input[name="ticket"]') as HTMLInputElement).value).toBe('');
  });

  it('el historial muestra el correo enviado y "Reenviar" lo vuelve a armar con sus destinatarios', async () => {
    const { fixture, el } = await render();
    button(el, 'Historial').click();
    fixture.detectChanges();
    answer();
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('[DPP] Ofensa Mg5 (GLPI-1)');
    (el.querySelector('tbody tr') as HTMLElement).click();
    await tick();
    httpMock.expectOne('/api/reports/history/h1').flush({
      data: { ...HISTORY, html: '<p>correo</p>', payload: { incident: { codigoTicket: 'GLPI-1', nombreEvento: 'Ofensa Mg5', ofensa: '5799' } } },
    });
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('iframe')).not.toBeNull();
    button(el, 'Reenviar').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect((el.querySelector('input[name="ticket"]') as HTMLInputElement).value).toBe('GLPI-1');
    expect(el.textContent).toContain('seguridad@dpp.cl');
    expect((el.querySelector('input[name="subject"]') as HTMLInputElement).value).toBe('[DPP] Ofensa Mg5 (GLPI-1)');
  });

  it('con solo NOC también se puede reportar (sin el campo Servicio, que es de SOC)', async () => {
    const fixture = TestBed.createComponent(ReportsComponent);
    fixture.detectChanges();
    const nocOnly = { 'GET /api/setup/status': { data: { setupCompleted: true, socEnabled: false, nocEnabled: true } } };
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(...answer(nocOnly).map((r) => r.request.url));
      await tick();
    }
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(seen).not.toContain('/api/services');
    expect(el.querySelector('select[name="svc"]')).toBeNull();
    expect(el.querySelector('select[name="org"]')).not.toBeNull();
  });

  it('la vista previa la arma el servidor (mismo HTML que se envía)', async () => {
    const { fixture, el } = await render();
    await tick(700);
    answer();
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('iframe.rp__frame')?.getAttribute('sandbox')).toBe('');
  });
});
