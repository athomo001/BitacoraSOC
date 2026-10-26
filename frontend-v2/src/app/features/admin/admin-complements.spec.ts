import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminComplementsComponent, collectionsFor } from './admin-complements';
import { Complement } from '../../core/complements/complements.service';

const DOOM: Complement = {
  slug: 'doom-browser', name: 'DOOM', icon: 'sports_esports', sourceType: 'zip_static', status: 'active', entryPath: 'index.html',
  scopes: [], allowedCollections: [], connectHosts: [], visibleRoles: ['admin', 'user'], visiblePermissionGroupIds: [], hasToken: false,
  artifactFiles: 11, artifactBytes: 8_120_000, artifactSha256: '3f9ad21c0000', publishedAt: '2026-09-28T17:02:00Z', circuit: 'CLOSED',
  items: [], approved: [], isHouse: false,
};
const MAPA: Complement = {
  slug: 'mapa-enlaces', name: 'Mapa de enlaces', icon: 'hub', sourceType: 'manual', status: 'active', entryPath: '/', baseUrl: 'https://mapa.x.cl',
  healthPath: '/health', scopes: ['READ_CONTEXT'], allowedCollections: [], connectHosts: [], visibleRoles: [], visiblePermissionGroupIds: [],
  hasToken: true, tokenIssuedAt: '2026-09-27T10:00:00Z', circuit: 'OPEN',
  items: [], approved: [], isHouse: false,
};

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('collectionsFor', () => {
  it('saca las colecciones de los permisos, para no dejar un permiso sin su colección', () => {
    expect(collectionsFor(['READ_CONTEXT', 'WRITE_LOGS'])).toEqual([]);
    expect(collectionsFor(['WRITE_ENTRIES', 'WRITE_STORAGE'])).toEqual(['entries', 'shared_storage']);
    expect(collectionsFor(['READ_LOGS'])).toEqual(['entries', 'audit_log']);
  });
});

describe('AdminComplementsComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminComplementsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminComplementsComponent);
    fixture.detectChanges();
    http.expectOne('/api/complements').flush({ data: [DOOM, MAPA] });
    http.expectOne('/api/permission-groups').flush({ data: [{ id: 'g1', name: 'N1', active: true }] });
    await settle();
    http.expectOne('/api/complements/doom-browser').flush({ data: { ...DOOM, entriesCount: 0 } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
    };
    return { fixture, el, button, refresh };
  }

  it('lista con tipo, estado y quién los ve; un servicio sin respuesta se marca', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('ZIP estático');
    expect(rows[0]).toContain('Admin, Usuario');
    expect(rows[1]).toContain('No responde');
    expect(rows[1]).toContain('Todos');
    expect(el.textContent).toContain('11 archivos');
  });

  it('eliminar exige escribir el identificador y avisa qué pasa con las entradas', async () => {
    const { el, button, refresh } = await render();
    button('Eliminar complemento').click();
    await refresh();
    expect(el.textContent).toContain('No creó entradas en la bitácora.');
    const confirm = [...el.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Eliminar').pop() as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const input = el.querySelector('input[name="deleteTyped"]') as HTMLInputElement;
    input.value = 'doom-browser';
    input.dispatchEvent(new Event('input'));
    await refresh();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await refresh();
    const req = http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/complements/doom-browser');
    expect(req.request.body).toEqual({ confirmation: 'doom-browser' });
  });

  it('un ZIP que no es estático (422) muestra el análisis con el motivo y no deja seguir', async () => {
    const { el, button, refresh } = await render();
    button('Subir ZIP').click();
    await refresh();
    const input = el.querySelector('.ac__drop input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'app-vite.zip')] });
    input.dispatchEvent(new Event('change'));
    await refresh();
    http.expectOne('/api/complements/uploads').flush(
      { data: { uploadId: 'u1', expiresAt: '', analysis: { stack: 'vite-frontend', publishable: false, reason: 'es un proyecto Vite: compílalo', entry: 'index.html', files: 12, bytes: 1000, largestPath: 'a.js', largestBytes: 500, features: [], warnings: [], suggestedSlug: 'app-vite', suggestedName: 'app-vite', connectHosts: [], sha256: '' } } },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await refresh();
    expect(el.textContent).toContain('no se puede publicar como complemento estático');
    expect(el.textContent).toContain('es un proyecto Vite: compílalo');
    expect(button('Vista previa').disabled).toBe(true);
  });

  it('en un servicio, marcar un permiso guarda también sus colecciones', async () => {
    const { el, refresh } = await render();
    (el.querySelectorAll('tbody tr')[1] as HTMLElement).click();
    await refresh();
    http.expectOne('/api/complements/mapa-enlaces').flush({ data: MAPA });
    await refresh();
    const writeEntries = [...el.querySelectorAll('.ac__check')].find((l) => l.textContent?.includes('Crear entradas')) as HTMLElement;
    (writeEntries.querySelector('input') as HTMLInputElement).click();
    await refresh();
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url === '/api/complements/mapa-enlaces');
    expect(req.request.body).toEqual({ scopes: ['READ_CONTEXT', 'WRITE_ENTRIES'], allowedCollections: ['entries'] });
  });

  // 10i: lo que declara complement.json se aprueba cosa por cosa.
  const VT: Complement = {
    ...MAPA, slug: 'virustotal', name: 'VirusTotal', circuit: 'CLOSED',
    manifest: { version: '1.3.0', panels: [{ id: 'reputacion', target: 'ticket', title: 'Reputación' }], topbar: { path: 'barra.html' }, data: ['entries:read'] },
    items: [{ key: 'panel:reputacion', kind: 'panel', house: false }, { key: 'topbar', kind: 'topbar', house: true }, { key: 'data:entries:read', kind: 'data', house: false }],
    approved: ['data:entries:read'], isHouse: false,
  };

  it('lo que espera revisión se ve en la lista y abre «Qué agrega»; aprobar guarda solo esa cosa', async () => {
    const fixture = TestBed.createComponent(AdminComplementsComponent);
    fixture.detectChanges();
    http.expectOne('/api/complements').flush({ data: [VT] });
    http.expectOne('/api/permission-groups').flush({ data: [] });
    await settle();
    http.expectOne('/api/complements/virustotal').flush({ data: VT });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // La barra pide «de la casa»: no cuenta como pendiente.
    expect(el.querySelector('tbody tr')?.textContent).toContain('1 por revisar');
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Qué agrega');
    expect(el.textContent).toContain('Esta versión pide 1 cosa nueva');
    const rows = [...el.querySelectorAll('.ca__row')].map((r) => r.textContent ?? '');
    expect(rows.find((r) => r.includes('Pestaña en el ticket'))).toContain('Esperando tu revisión');
    const bar = rows.find((r) => r.includes('Barra superior')) ?? '';
    expect(bar).toContain('Requiere «de la casa»');
    expect(bar).not.toContain('Aprobar');
    expect(rows.find((r) => r.includes('Lee entradas de la Bitácora'))).toContain('Aprobado');
    const approve = [...el.querySelectorAll('.ca__row')].find((r) => r.textContent?.includes('Pestaña en el ticket'))?.querySelector('button') as HTMLButtonElement;
    approve.click();
    await settle();
    const req = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/complements/virustotal/approvals');
    expect(req.request.body).toEqual({ approved: ['data:entries:read', 'panel:reputacion'], house: false });
  });
});
