import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminIntegrationsComponent } from './admin-integrations';
import { ApiKey, ForwardDestination, IntegrationsMeta } from '../../core/integrations/integrations.service';
import { sampleEvent } from './integrations-forward';

const META: IntegrationsMeta = {
  scopes: ['entries:read', 'entries:write', 'oncall:read', 'tickets:read', 'tickets:write', 'reports:render', 'reports:send'],
  areas: [{ id: 'a-soc', name: 'SOC', code: 'soc' }, { id: 'a-noc', name: 'NOC', code: 'noc' }],
  clients: [{ id: 'c1', name: 'Casinos' }, { id: 'c2', name: 'Netics' }],
  crypto: true,
};

function dest(over: Partial<ForwardDestination>): ForwardDestination {
  return {
    id: 'd1', name: 'Wazuh del SOC', enabled: true, transport: 'tls', host: 'wazuh.soc.interno', port: 6514, url: null, format: 'json', batch: false,
    sendAudit: true, auditLevel: 'info', sendEntries: true, sendEscalation: true, sendTickets: true, hasCaCert: true, hasClientCert: true, headers: [],
    state: 'ok', failingSince: null, lastSentAt: '2026-10-21T13:40:00Z', lastError: null, lastErrorAt: null, sentToday: 3418, lostWeek: 0, pending: 0, ...over,
  };
}

const SPLUNK = dest({
  id: 'd3', name: 'Splunk de prueba', transport: 'http', host: null, port: null, url: 'https://splunk.ejemplo.cl:8088/services/collector/raw', hasCaCert: false,
  hasClientCert: false, headers: ['Authorization'], state: 'failing', failingSince: '2026-10-21T12:12:00Z', lastError: 'HTTP 403 Forbidden: token inválido',
  pending: 1204, sentToday: 96,
});

const KEY: ApiKey = {
  id: 'k1', name: 'n8n alarmas Wazuh', description: 'Una alarma deja su entrada y abre un ticket.', prefix: 'bop_7Hq2mX9a',
  scopes: ['entries:write', 'tickets:write'], clientIds: ['c1'], areaId: 'a-soc', areaName: 'SOC', state: 'active', expiresAt: '2027-10-21T00:00:00Z',
  lastUsedAt: '2026-10-21T13:38:00Z', createdAt: '2026-10-21T10:00:00Z', createdByName: 'lucia', revokedAt: null, revokeReason: null, callsWeek: 1286,
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Administración → Integraciones (10b)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminIntegrationsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(dests: ForwardDestination[]) {
    const fixture = TestBed.createComponent(AdminIntegrationsComponent);
    fixture.detectChanges();
    http.expectOne('/api/integrations/meta').flush({ data: META });
    await settle();
    fixture.detectChanges();
    http.expectOne('/api/integrations/destinations').flush({ data: dests });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  it('un destino caído dice desde cuándo, el error y lo que espera en cola', async () => {
    const { fixture, el } = await render([dest({}), SPLUNK]);
    const rows = el.querySelectorAll('.fw__row');
    expect(rows[0].textContent).toContain('Enviando');
    expect(rows[1].textContent).toContain('Sin conexión desde');
    expect(rows[1].textContent).toContain('1204 en cola');
    (rows[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    const note = el.querySelector('.fw__note--bad')!.textContent!;
    expect(note).toContain('HTTP 403 Forbidden');
    expect(note).toContain('1204 eventos esperando');
    // La cabecera guardada no muestra su valor.
    expect(el.textContent).toContain('Guardada, cifrada');
    expect(el.querySelector('input[type="password"]')).toBeNull();
  });

  it('el valor guardado de una cabecera se mantiene si no se reemplaza', async () => {
    const { fixture, el } = await render([SPLUNK]);
    (el.querySelector('input[name="fwBatch"]') as HTMLInputElement).click();
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = http.expectOne('/api/integrations/destinations/d3');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ transport: 'http', batch: true, headers: [{ name: 'Authorization', value: null }] });
    expect('caCert' in req.request.body).toBe(false);
    req.flush({ data: { ...SPLUNK, batch: true } });
    await settle();
    http.expectOne('/api/integrations/destinations').flush({ data: [{ ...SPLUNK, batch: true }] });
    await settle();
  });

  it('un destino nuevo parte en Syslog TLS y elige qué se manda', async () => {
    const { fixture, el } = await render([]);
    expect(el.textContent).toContain('Sin destinos');
    button(el, 'Nuevo destino').click();
    fixture.detectChanges();
    (el.querySelector('input[name="fwHost"]') as HTMLInputElement).value = 'graylog.noc';
    el.querySelector('input[name="fwHost"]')!.dispatchEvent(new Event('input'));
    button(el, 'Syslog UDP').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('UDP no confirma la entrega');
    (el.querySelector('input[name="fwAudit"]') as HTMLInputElement).click();
    fixture.detectChanges();
    button(el, 'Crear destino').click();
    const req = http.expectOne('/api/integrations/destinations');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ transport: 'udp', host: 'graylog.noc', port: 514, sendAudit: false, sendEntries: true, sendTickets: true });
    req.flush({ data: dest({ id: 'd9', transport: 'udp', host: 'graylog.noc', port: 514 }) });
    await settle();
    http.expectOne('/api/integrations/destinations').flush({ data: [dest({ id: 'd9', transport: 'udp', host: 'graylog.noc', port: 514 })] });
    await settle();
  });

  it('el ejemplo de RFC 5424 lleva prioridad, nodo y el tipo de evento', () => {
    expect(sampleEvent('rfc5424')).toMatch(/^<132>1 \S+ bitacora-1 bitacora - ticket\.sla_breached - \{"v":1/);
    expect(JSON.parse(sampleEvent('json')).group).toBe('ticketera');
  });

  it('una llave nueva se muestra una sola vez, con su ejemplo de curl', async () => {
    const { fixture, el } = await render([]);
    button(el, 'Llaves de API').click();
    fixture.detectChanges();
    http.expectOne('/api/integrations/keys').flush({ data: [KEY] });
    await settle();
    http.expectOne('/api/integrations/keys/k1/requests').flush({ data: [
      { at: '2026-10-21T13:41:07Z', method: 'POST', path: '/api/v1/tickets', scope: 'tickets:write', status: 200, latencyMs: 9, ip: '10.20.0.31', note: 'Reintento: mismo Idempotency-Key, no se duplicó' },
    ] });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('tbody')!.textContent).toContain('Casinos');
    expect(el.textContent).toContain('no se duplicó');

    button(el, 'Nueva llave').click();
    fixture.detectChanges();
    const name = el.querySelector('input[name="ikName"]') as HTMLInputElement;
    name.value = 'n8n alertas Graylog';
    name.dispatchEvent(new Event('input'));
    (el.querySelector('input[name="ikSctickets:write"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(button(el, 'Crear llave').disabled).toBe(true);
    expect(el.textContent).toContain('Elige el área de los tickets.');
    const area = el.querySelector('select[name="ikArea"]') as HTMLSelectElement;
    area.value = 'a-noc';
    area.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button(el, 'Crear llave').click();
    const req = http.expectOne('/api/integrations/keys');
    expect(req.request.body).toEqual({ name: 'n8n alertas Graylog', description: '', scopes: ['entries:write', 'tickets:write'], clientIds: [], areaId: 'a-noc', expiresInDays: 365 });
    const secret = 'bop_Rk3vN8wQ2Lx7hT5yB1cZ9mP4sD6fG0jAaaaaaaaa';
    req.flush({ data: { key: { ...KEY, id: 'k2', name: 'n8n alertas Graylog' }, secret } });
    await settle();
    http.expectOne('/api/integrations/keys').flush({ data: [{ ...KEY, id: 'k2', name: 'n8n alertas Graylog' }, KEY] });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('code')!.textContent).toBe(secret);
    expect(el.querySelector('.ik__pre')!.textContent).toContain(`X-API-Key: ${secret}`);
    button(el, 'Listo').click();
    fixture.detectChanges();
    http.expectOne('/api/integrations/keys/k2/requests').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).not.toContain(secret);
  });

  it('revocar pide confirmación', async () => {
    const { fixture, el } = await render([]);
    button(el, 'Llaves de API').click();
    fixture.detectChanges();
    http.expectOne('/api/integrations/keys').flush({ data: [KEY] });
    await settle();
    http.expectOne('/api/integrations/keys/k1/requests').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    button(el, 'Revocar').click();
    fixture.detectChanges();
    expect(el.querySelector('.ik__note')!.textContent).toContain('no se puede deshacer');
    [...el.querySelectorAll<HTMLButtonElement>('.ik__note button')].find((b) => b.textContent?.includes('Revocar'))!.click();
    http.expectOne('/api/integrations/keys/k1/revoke').flush(null);
    await settle();
    http.expectOne('/api/integrations/keys').flush({ data: [{ ...KEY, state: 'revoked', revokedAt: '2026-10-21T14:00:00Z', revokedByName: 'lucia' }] });
    await settle();
    http.expectOne('/api/integrations/keys/k1/requests').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Revocada');
  });
});
