import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { InventoryComponent } from './inventory';
import { SseService } from '../../core/sse/sse.service';
import { InventoryAsset, InventoryMeta } from '../../core/inventory/inventory.service';

/** Inventario (9.2, diseño aprobado 2026-10-14). */
const META: InventoryMeta = {
  kinds: [
    { code: 'server', name: 'Servidor', icon: 'dns', baseType: 'device', sortOrder: 10, active: true, fields: [
      { key: 'os', label: 'Sistema operativo', kind: 'text' }, { key: 'os_version', label: 'Versión', kind: 'text' }, { key: 'ram_gb', label: 'RAM (GB)', kind: 'number' }] },
    { code: 'network', name: 'Red', icon: 'router', baseType: 'device', sortOrder: 30, active: true, fields: [
      { key: 'ports', label: 'Puertos', kind: 'text' }, { key: 'role', label: 'Rol', kind: 'list', options: ['Core', 'Acceso'] }] },
  ],
  responsibleTypes: [{ code: 'config', name: 'Configuración y sistema', active: true }, { code: 'power', name: 'Energía y conectividad', active: true }],
  areas: [{ id: 'a-infra', code: 'infra', name: 'Infraestructura' }, { id: 'a-ti', code: 'ti', name: 'TI' }],
  myAreas: ['infra'],
  viewAll: false,
  admin: false,
  pendingRequests: 0,
  canCreate: true,
};

function asset(overrides: Partial<InventoryAsset> = {}): InventoryAsset {
  return {
    id: 's1', name: 'SRV-FILES-01', code: 'srv-files-01', kind: 'server', area: 'infra', areaName: 'Infraestructura',
    attributes: { os: 'Ubuntu Server', os_version: '20.04', ram_gb: '32' }, extra: { Garantía: '2027-03' }, active: true,
    ips: [{ kind: 'network', address: '10.10.4.21' }, { kind: 'network', address: '10.10.4.31' }, { kind: 'vip', address: '10.10.4.20', note: 'compartida' }, { kind: 'management', address: '10.10.99.21' }],
    responsibles: [{ type: 'config', typeName: 'Configuración y sistema', area: 'ti', areaName: 'TI' }, { type: 'power', typeName: 'Energía y conectividad', organizationId: 'o1', organizationName: 'Datahouse' }],
    events: [{ id: 'e1', kind: 'edited', description: 'RAM (GB): 16 → 32', happenedAt: '2026-09-30T12:00:00Z', userName: 'Ana Rojas' }],
    tickets: [], canEdit: true, canDecide: false, ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Inventario (9.2)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InventoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: SseService, useValue: { connect: () => () => undefined } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(a: InventoryAsset = asset(), meta: InventoryMeta = META) {
    const fixture = TestBed.createComponent(InventoryComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/inventory/meta').flush({ data: meta });
    await settle();
    httpMock.expectOne((r) => r.url === '/api/inventory').flush({ data: [{ id: a.id, name: a.name, code: a.code, kind: a.kind, areaId: 'a-infra', areaName: a.areaName, attributes: a.attributes, active: a.active, firstIp: '10.10.4.21', ipCount: 4 }] });
    await settle();
    httpMock.expectOne(`/api/inventory/${a.id}`).flush({ data: a });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('un equipo de GLPI: aviso con enlace, nube en lo que trae GLPI y no en lo de la Bitácora', async () => {
    const { el } = await render(asset({
      glpi: { itemtype: 'Computer', id: 1042, url: 'https://glpi.netics.cl/front/computer.form.php?id=1042' }, rack: 'DC1-R06',
      events: [{ id: 'e2', kind: 'glpi', description: 'RAM (GB): 64 → 128', happenedAt: '2026-10-15T05:00:00Z' }],
    }));
    const panel = el.querySelector('.iv__panel')!;
    expect(panel.querySelector('.iv__glpibar')!.textContent).toContain('GLPI #1042');
    expect(panel.querySelector<HTMLAnchorElement>('.iv__glpibar a')!.href).toContain('computer.form.php?id=1042');
    // SO, versión y RAM, más las 2 IP de red: 5 nubes. VIP, iLO y rack son de la Bitácora.
    expect(panel.querySelectorAll('.iv__cloud').length).toBe(5);
    expect(panel.textContent).toContain('cloud_download');
  });

  it('lista y ficha: campos del tipo, varias IP, responsables e historial', async () => {
    const { el } = await render();
    const row = el.querySelector('.iv__row[aria-current="true"]')!;
    expect(row.textContent).toContain('Ubuntu Server 20.04');
    expect(row.textContent).toContain('+3 más');
    const panel = el.querySelector('.iv__panel')!.textContent!;
    expect(panel).toContain('Datos de servidor');
    expect(panel).toContain('Balanceo (VIP)');
    expect(panel).toContain('10.10.99.21');
    expect(panel).toContain('Energía y conectividad');
    expect(panel).toContain('Datahouse');
    expect(panel).toContain('Garantía');
    expect(panel).toContain('RAM (GB): 16 → 32');
    // No decide: pide la baja en vez de darla.
    expect(button(el, 'Dar de baja')).toBeUndefined();
    expect(button(el, 'Pedir baja')).toBeDefined();
  });

  it('editar: los campos cambian con el tipo y se guarda la ficha completa', async () => {
    const { fixture, el } = await render();
    button(el, 'Editar').click();
    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush({ data: [] }));
    await settle();
    fixture.detectChanges();
    const version = el.querySelector<HTMLInputElement>('input[name="attr-os_version"]')!;
    expect(version.value).toBe('20.04');
    version.value = '24.04';
    version.dispatchEvent(new Event('input'));
    // Al pasar a Red aparecen sus campos (puertos, rol).
    button(el, 'Red').click();
    fixture.detectChanges();
    expect(el.querySelector('select[name="attr-role"]')).not.toBeNull();
    button(el, 'Servidor').click();
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/inventory/s1' });
    expect(req.request.body.attributes.os_version).toBe('24.04');
    expect(req.request.body.ips).toHaveLength(4);
    expect(req.request.body.responsibles).toEqual([{ type: 'config', area: 'ti', userId: undefined, organizationId: undefined }, { type: 'power', area: undefined, userId: undefined, organizationId: 'o1' }]);
    expect(req.request.body.extra).toEqual({ Garantía: '2027-03' });
  });

  it('pedir la baja manda motivo; quien decide ve Dar de baja y Borrar', async () => {
    const first = await render();
    button(first.el, 'Pedir baja').click();
    first.fixture.detectChanges();
    const reason = first.el.querySelector<HTMLTextAreaElement>('textarea[name="askReason"]')!;
    reason.value = 'Reemplazado por SRV-02';
    reason.dispatchEvent(new Event('input'));
    first.fixture.detectChanges();
    button(first.el, 'Enviar solicitud').click();
    const req = httpMock.expectOne({ method: 'POST', url: '/api/inventory/s1/requests' });
    expect(req.request.body).toEqual({ action: 'deactivate', reason: 'Reemplazado por SRV-02' });
    first.fixture.destroy();

    const lead = await render(asset({ canDecide: true }));
    expect(button(lead.el, 'Dar de baja')).toBeDefined();
    expect(button(lead.el, 'Borrar')).toBeDefined();
    expect(button(lead.el, 'Pedir baja')).toBeUndefined();
  });

  it('CSV: revisa sin guardar y después carga el mismo archivo', async () => {
    const { fixture, el } = await render();
    button(el, 'Cargar CSV').click();
    fixture.detectChanges();
    const file = new File(['codigo;nombre;area\nsrv-02;SRV-02;Infraestructura\n'], 'servidores.csv', { type: 'text/csv' });
    const input = el.querySelector<HTMLInputElement>('input[name="csvFile"]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle();
    const review = httpMock.expectOne((r) => r.url === '/api/inventory/import' && r.params.get('dryRun') === 'true');
    expect(review.request.params.get('kind')).toBe('server');
    expect(review.request.body).toContain('srv-02');
    review.flush({ data: { rows: [{ line: 2, code: 'srv-02', name: 'SRV-02', action: 'create', detail: '0 IP' }], created: 1, updated: 0, unchanged: 0, errors: 0, applied: false } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('nuevo');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'done_allCargar')!.click();
    const load = httpMock.expectOne((r) => r.url === '/api/inventory/import' && r.params.get('dryRun') === 'false');
    expect(load.request.body).toContain('srv-02');
  });
});
