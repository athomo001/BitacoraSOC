import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminGlpiComponent } from './admin-glpi';

const META = {
  kinds: [
    { code: 'server', name: 'Servidor', icon: 'dns', baseType: 'device', sortOrder: 10, active: true, fields: [] },
    { code: 'computer', name: 'Computador', icon: 'computer', baseType: 'device', sortOrder: 20, active: true, fields: [] },
  ],
  responsibleTypes: [], areas: [{ id: 'a1', code: 'infra', name: 'Infraestructura' }], myAreas: [], viewAll: true, admin: true, pendingRequests: 0, canCreate: true,
};
const CONFIG = {
  url: 'https://glpi.netics.cl/apirest.php', hasAppToken: true, hasUserToken: true, verifyTls: true, timeoutSeconds: 8,
  importComputers: true, importNetwork: true, areaId: 'a1', computerTypes: { Server: 'server' }, entities: {}, autoMode: 'off',
  lastTest: { at: '2026-10-15T10:42:00Z', ok: false, entities: 0, computers: 0, network: 0,
    explanation: { error: 'GLPI rechazó el User-Token.', cause: 'El token se regeneró.', next: 'Cópialo de nuevo.', raw: 'ERROR_GLPI_LOGIN_USER_TOKEN' } },
};
const PLAN = {
  readAt: '2026-10-15T11:00:00Z', computers: 3, network: 1, linked: 2, holdBack: false, warnings: [],
  counts: { create: 1, update: 1, unchanged: 5, reactivate: 0, deactivate: 0, skip: 1, error: 0 },
  rows: [
    { action: 'create', itemtype: 'Computer', glpiId: 1377, name: 'SRV-BKP-02', kind: 'server', code: 'srv_bkp_02', detail: 'Servidor · Ubuntu 24.04' },
    { action: 'update', itemtype: 'Computer', glpiId: 1042, name: 'SRV-ERP-01', kind: 'server', changes: ['RAM (GB): 64 → 128'] },
    { action: 'skip', itemtype: 'Computer', glpiId: 1050, name: 'SRV-FILES-01', kind: 'server', linkAssetId: 'x1', detail: 'Ya existe en la app con la misma serie.' },
  ],
};

describe('Administración → GLPI (9.6)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminGlpiComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminGlpiComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/glpi/config').flush({ data: CONFIG });
    httpMock.expectOne('/api/inventory/meta').flush({ data: META });
    httpMock.expectOne((r) => r.url === '/api/organizations').flush({ data: [{ id: 'o1', name: 'Casinos', code: 'cas' }] });
    httpMock.expectOne('/api/glpi/runs').flush({ data: [] });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  it('explica por qué no conecta y nunca muestra los tokens', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('GLPI rechazó el User-Token.');
    expect(el.textContent).toContain('Cópialo de nuevo.');
    const token = el.querySelector<HTMLInputElement>('input[name="glpiUserToken"]')!;
    expect(token.value).toBe('');
    expect(token.placeholder).toContain('guardado');
  });

  it('guarda sin reenviar los tokens vacíos', async () => {
    const { fixture, el } = await render();
    const timeout = el.querySelector<HTMLInputElement>('input[name="glpiTimeout"]')!;
    timeout.value = '15';
    timeout.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/glpi/config' });
    expect(req.request.body.timeoutSeconds).toBe(15);
    expect(req.request.body.userToken).toBeUndefined();
    expect(req.request.body.appToken).toBeUndefined();
  });

  it('revisa, muestra los cambios, vincula por serie e importa', async () => {
    const { fixture, el } = await render();
    button(el, 'Revisar ahora').click();
    httpMock.expectOne({ method: 'POST', url: '/api/glpi/preview' }).flush({ data: PLAN });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(el.textContent).toContain('SRV-BKP-02');
    button(el, 'Cambian').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('RAM (GB): 64 → 128');
    button(el, 'Se saltan').click();
    fixture.detectChanges();
    button(el, 'Vincular').click();
    const link = httpMock.expectOne({ method: 'POST', url: '/api/glpi/link' });
    expect(link.request.body).toEqual({ assetId: 'x1', itemtype: 'Computer', glpiId: 1050 });
    link.flush({ data: { linked: true } });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(el.textContent).toContain('Vinculado');
    button(el, 'Importar').click();
    httpMock.expectOne({ method: 'POST', url: '/api/glpi/import' }).flush({
      data: { id: 'r1', trigger: 'manual', startedAt: '2026-10-15T11:01:00Z', ok: true, created: 1, updated: 1, deactivated: 0, reactivated: 0, skipped: 1, unchanged: 5, heldBack: 0, message: '' },
    });
    await new Promise((resolve) => setTimeout(resolve));
    httpMock.expectOne('/api/glpi/runs').flush({ data: [] });
    httpMock.expectOne('/api/glpi/config').flush({ data: CONFIG });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(el.textContent).toContain('Importación terminada');
    expect(el.textContent).toContain('1 nuevos · 1 actualizados · 1 saltados');
  });
});
