import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { EntriesComponent } from './entries';

const ADMIN_USER = { id: 'u-admin', username: 'admin', email: 'admin@bitacora.local', role: 'admin', mfaEnabled: false, mustChangePassword: false, active: true, createdAt: new Date().toISOString() };

const ENTRY = {
  id: 'e1', authorUsername: 'admin', entryType: 'incidente', scope: 'noc',
  content: 'Corte de fibra confirmado', tags: ['fibra'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

describe('EntriesComponent (Bitácora)', () => {
  let httpMock: HttpTestingController;
  let originalFetch: typeof fetch;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EntriesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    originalFetch = globalThis.fetch;
    // El banner de despliegue usa fetch() crudo (SseService), no HttpClient —
    // se simula un stream vacío para que no salga a la red real en el test.
    globalThis.fetch = (async () => new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function render() {
    const fixture = TestBed.createComponent(EntriesComponent);
    fixture.detectChanges();

    httpMock.expectOne('/api/users/me').flush({ data: ADMIN_USER });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: 'both', capabilities: [] } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/entries').flush({ data: { items: [ENTRY], total: 1 } });
    await tick();
    httpMock.expectOne('/api/notes/admin').flush({ data: { content: 'Pizarrón de prueba' } });
    httpMock.expectOne('/api/notes/personal').flush({ data: { content: 'Nota personal' } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/drafts').flush({ data: { items: [] } });
    await tick();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra las entradas del muro y las notas cargadas', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Corte de fibra confirmado');
    // <textarea> con [ngModel] no refleja su valor en textContent — se lee la propiedad .value.
    const adminNotesArea = el.querySelectorAll('.entries__notes textarea')[0] as HTMLTextAreaElement;
    expect(adminNotesArea.value).toBe('Pizarrón de prueba');
  });

  it('filtrar por tag vuelve a pedir /api/entries con el parámetro tag', async () => {
    const { fixture, el } = await render();
    const tagInput = [...el.querySelectorAll('input')].find((i) => i.placeholder === 'ej. otdr') as HTMLInputElement;
    tagInput.value = 'otdr';
    tagInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const buscarBtn = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Buscar');
    buscarBtn?.dispatchEvent(new Event('click'));
    await tick();
    const req = httpMock.expectOne((r) => r.url === '/api/entries' && r.params.get('tag') === 'otdr');
    req.flush({ data: { items: [], total: 0 } });
  });

  it('abrir una entrada pide el detalle con comentarios', async () => {
    const { fixture, el } = await render();
    const row = el.querySelector('tr.entries__row') as HTMLElement;
    row.dispatchEvent(new Event('click'));
    await tick();
    httpMock.expectOne('/api/entries/e1').flush({ data: { ...ENTRY, comments: [{ id: 'c1', entryId: 'e1', authorUsername: 'admin', comment: 'Seguimiento', isSystemGenerated: false, createdAt: new Date().toISOString() }] } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Seguimiento');
  });
});
