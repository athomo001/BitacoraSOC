import { TestBed } from '@angular/core/testing';
import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminAuditComponent } from './admin-audit';
import { AuditRecord } from '../../core/audit/audit.service';

const record = (overrides: Partial<AuditRecord>): AuditRecord => ({
  id: 'r1', timestamp: '2026-09-30T12:41:03Z', event: 'auth.session.ip_change', level: 'warn', actorUsername: 'ana.rojas', actorRole: 'user',
  requestIp: '190.100.4.21', requestMethod: 'GET', requestPath: '/api/entries', requestId: 'req-1', ipChanged: true, previousIp: '10.20.0.14',
  success: true, metadata: { previousIp: '10.20.0.14' }, ...overrides,
});

const RECORDS = [
  record({}),
  record({ id: 'r2', event: 'auth.login.fail', level: 'warn', success: false, reason: 'credenciales inválidas', actorUsername: 'jperez', actorRole: undefined, ipChanged: false }),
  record({ id: 'r3', event: 'backup.created', level: 'info', actorUsername: 'admin', actorRole: 'admin', ipChanged: false, metadata: {} }),
];

/** Deja correr promesas y temporizadores pendientes (la app no usa zone.js). */
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AdminAuditComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminAuditComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const isList = (r: HttpRequest<unknown>) => r.url === '/api/audit-logs';

  async function answer(fixture: { detectChanges(): void }, items: AuditRecord[], total = items.length) {
    fixture.detectChanges();
    const req = http.expectOne(isList);
    req.flush({ data: items, meta: { page: 1, pageSize: 50, total } });
    await settle();
    fixture.detectChanges();
    return req.request;
  }

  async function render(total = 1284) {
    const fixture = TestBed.createComponent(AdminAuditComponent);
    const first = await answer(fixture, RECORDS, total);
    return { fixture, el: fixture.nativeElement as HTMLElement, first };
  }

  it('arranca con los últimos 7 días, 50 por página, y muestra la tabla con el primer evento en el detalle', async () => {
    const { el, first } = await render();
    expect(first.params.get('pageSize')).toBe('50');
    expect(first.params.get('page')).toBe('1');
    expect(first.params.has('from')).toBe(true);
    expect(first.params.has('event')).toBe(false);

    const rows = el.querySelectorAll('.aud-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Acceso');
    expect(rows[0].textContent).toContain('auth.session.ip_change');
    expect(rows[0].querySelector('[title="Cambió de IP en la misma sesión"]')).not.toBeNull();
    expect(rows[1].textContent).toContain('Fallo');
    expect(rows[2].textContent).toContain('Respaldos');
    expect(el.querySelector('.aud__pager')?.textContent).toContain('1–50 de 1.284');

    const detail = el.querySelector('.aud__detail')!.textContent!;
    expect(detail).toContain('Antes en esta sesión: 10.20.0.14');
    expect(detail).toContain('GET /api/entries');
    expect(detail).toContain('"previousIp": "10.20.0.14"');
  });

  it('al elegir una fila muestra su motivo en el detalle', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('.aud-row')[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.aud__detail')?.textContent).toContain('credenciales inválidas');
  });

  it('la categoría manda todos sus dominios, vuelve a la página 1 y el export lleva lo filtrado', async () => {
    const { fixture, el } = await render();
    const next = el.querySelector('[aria-label="Página siguiente"]') as HTMLButtonElement;
    next.click();
    const page2 = await answer(fixture, RECORDS, 1284);
    expect(page2.params.get('page')).toBe('2');

    const access = [...el.querySelectorAll('.aud__cats .seg')].find((b) => b.textContent?.trim() === 'Acceso') as HTMLButtonElement;
    access.click();
    const filtered = await answer(fixture, RECORDS.slice(0, 2), 2);
    expect(filtered.params.get('event')).toBe('auth,setup');
    expect(filtered.params.get('page')).toBe('1');
    expect(el.textContent).toContain('Exportar CSV (2)');
    expect(el.textContent).toContain('Limpiar filtros');

    (el.querySelector('app-button button') as HTMLButtonElement).click();
    await settle();
    const csv = http.expectOne((r) => r.url === '/api/audit-logs/export');
    expect(csv.request.params.get('event')).toBe('auth,setup');
    expect(csv.request.params.has('page')).toBe(false);
    csv.flush(new Blob(['x']));
  });

  it('nivel y resultado filtran; la búsqueda espera a que se deje de escribir', async () => {
    const { fixture, el } = await render();
    const [levelSel, resultSel] = el.querySelectorAll('.aud__select select') as NodeListOf<HTMLSelectElement>;
    levelSel.value = 'error';
    levelSel.dispatchEvent(new Event('change'));
    expect((await answer(fixture, [])).params.get('level')).toBe('error');
    expect(el.querySelector('.aud__empty')?.textContent).toContain('Ningún evento coincide');

    resultSel.value = 'fail';
    resultSel.dispatchEvent(new Event('change'));
    expect((await answer(fixture, [])).params.get('result')).toBe('fail');

    const search = el.querySelector('.aud__search input') as HTMLInputElement;
    search.value = '181.43';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    http.expectNone(isList);
    await settle(320);
    expect((await answer(fixture, [])).params.get('q')).toBe('181.43');
  });
});
