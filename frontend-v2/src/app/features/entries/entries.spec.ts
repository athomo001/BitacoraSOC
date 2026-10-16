import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { EntriesComponent } from './entries';

const ADMIN_USER = { id: 'u-admin', username: 'admin', email: 'admin@bitacora.local', role: 'admin', mfaEnabled: false, mustChangePassword: false, active: true, createdAt: new Date().toISOString() };

const ENTRY = {
  id: 'e1', authorUsername: 'admin', entryType: 'incidente', scope: 'noc',
  content: '## Corte de fibra confirmado\nTécnico en ruta', tags: ['fibra'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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

  async function render(modules = { socEnabled: false, nocEnabled: true }) {
    const fixture = TestBed.createComponent(EntriesComponent);
    fixture.detectChanges();

    httpMock.expectOne('/api/users/me').flush({ data: ADMIN_USER });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: 'both', capabilities: [] } });
    httpMock.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, ...modules } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/entries').flush({ data: { items: [ENTRY], total: 1 } });
    await tick();
    httpMock.expectOne('/api/notes/admin').flush({ data: { content: 'Pizarrón de prueba' } });
    httpMock.expectOne('/api/notes/personal').flush({ data: { content: 'Nota personal' } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/drafts').flush({ data: { items: [] } });
    await tick();
    httpMock.match('/api/assets').forEach((r) => r.flush({ data: [] }));
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().endsWith(text)) as HTMLButtonElement;
    return { fixture, el, button };
  }

  it('muestra la tabla densa del artboard: ámbito, tipo y la primera línea como resumen', async () => {
    const { el } = await render();
    const row = el.querySelector('tr.en-row') as HTMLElement;
    expect(row.textContent).toContain('NOC');
    expect(row.textContent).toContain('Incidente');
    expect(row.querySelector('.en__summary')?.textContent).toContain('Corte de fibra confirmado');
    expect(row.querySelector('.en__summary')?.textContent).not.toContain('##');
  });

  it('desde el detalle se enlaza la entrada a un ticket de GLPI y se puede quitar', async () => {
    const { fixture, el, button } = await render();
    (el.querySelector('tr.en-row') as HTMLElement).click();
    await tick();
    httpMock.expectOne('/api/entries/e1').flush({ data: { ...ENTRY, comments: [] } });
    await tick();
    fixture.detectChanges();
    button('Enlazar ticket').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = el.querySelector('input[name="linkNumber"]') as HTMLInputElement;
    input.value = '#4521';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Enlazar').click();
    await tick();
    const put = httpMock.expectOne('/api/entries/e1/glpi-ticket');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ glpiTicketId: '#4521' });
    put.flush({ data: {} });
    await tick();
    httpMock.expectOne('/api/entries/e1').flush({ data: { ...ENTRY, comments: [], glpiTicketId: '4521', glpiTicketUrl: 'https://glpi.x.cl/front/ticket.form.php?id=4521' } });
    await tick();
    fixture.detectChanges();
    const link = [...el.querySelectorAll('.en__link a')].find((a) => a.textContent?.includes('GLPI #4521')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://glpi.x.cl/front/ticket.form.php?id=4521');
    (el.querySelector('button[aria-label="Quitar enlace GLPI 4521"]') as HTMLButtonElement).click();
    await tick();
    const clear = httpMock.expectOne('/api/entries/e1/glpi-ticket');
    expect(clear.request.body).toEqual({ glpiTicketId: '' });
    clear.flush({ data: {} });
    await tick();
    httpMock.expectOne('/api/entries/e1').flush({ data: { ...ENTRY, comments: [] } });
  });

  it('solo ofrece los ámbitos que aplican: sin SOC no aparece SOC', async () => {
    const { el } = await render({ socEnabled: false, nocEnabled: true });
    const scopes = [...el.querySelectorAll('.en__toolbar .en__segs')[0].querySelectorAll('.seg')].map((b) => b.textContent?.trim());
    expect(scopes.some((s) => s?.endsWith('SOC'))).toBe(false);
    expect(scopes.some((s) => s?.endsWith('NOC'))).toBe(true);
  });

  it('«Mías», autor y cliente van al servidor; las etiquetas se sugieren al escribir (paridad con el legacy)', async () => {
    const { fixture, el, button } = await render();
    httpMock.match('/api/entries/authors').forEach((r) => r.flush({ data: [{ id: 'u2', name: 'Beto', username: 'beto' }] }));
    httpMock.match((r) => r.url === '/api/organizations').forEach((r) => r.flush({ data: [{ id: 'c1', name: 'Netics', code: 'netics', type: 'client', active: true }] }));
    await tick();
    button('Mías').click();
    await tick();
    httpMock.expectOne((r) => r.url === '/api/entries' && r.params.get('author') === 'me').flush({ data: { items: [], total: 0 } });
    await tick();
    button('Más filtros').click();
    fixture.detectChanges();
    const pick = (name: string, value: string) => {
      const sel = el.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
      sel.value = value;
      sel.dispatchEvent(new Event('change'));
    };
    pick('filterAuthor', 'u2');
    pick('filterClient', 'c1');
    fixture.detectChanges();
    button('Aplicar').click();
    await tick();
    httpMock.expectOne((r) => r.url === '/api/entries' && r.params.get('author') === 'u2' && r.params.get('client') === 'c1').flush({ data: { items: [], total: 0 } });
    await tick();

    const tags = el.querySelector('input[name="tags"]') as HTMLInputElement;
    tags.value = 'fibra, ot';
    tags.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    httpMock.expectOne((r) => r.url === '/api/entries/tags' && r.params.get('q') === 'ot').flush({ data: [{ tag: 'otdr', uses: 12 }, { tag: 'fibra', uses: 3 }] });
    await tick();
    fixture.detectChanges();
    const sug = [...el.querySelectorAll('.en__tagsug button')];
    expect(sug.map((b) => b.textContent?.trim())).toEqual(['otdr 12']);
    sug[0].dispatchEvent(new Event('mousedown'));
    fixture.detectChanges();
    await tick();
    expect((el.querySelector('input[name="tags"]') as HTMLInputElement).value).toBe('fibra, otdr, ');
  });

  it('el filtro rápido de tipo pide al clic; el de tag vive en "Más filtros"', async () => {
    const { fixture, el, button } = await render();
    button('Ofensa').click();
    await tick();
    httpMock.expectOne((r) => r.url === '/api/entries' && r.params.get('type') === 'ofensa').flush({ data: { items: [], total: 0 } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ninguna entrada coincide');

    button('Más filtros').click();
    fixture.detectChanges();
    const tagInput = el.querySelector('input[placeholder="otdr"]') as HTMLInputElement;
    tagInput.value = 'otdr';
    tagInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Aplicar').click();
    await tick();
    httpMock.expectOne((r) => r.url === '/api/entries' && r.params.get('tag') === 'otdr' && r.params.get('type') === 'ofensa').flush({ data: { items: [], total: 0 } });
  });

  it('abrir una entrada muestra el detalle con seguimiento en el panel lateral', async () => {
    const { fixture, el } = await render();
    (el.querySelector('tr.en-row') as HTMLElement).click();
    await tick();
    httpMock.expectOne('/api/entries/e1').flush({ data: { ...ENTRY, comments: [{ id: 'c1', entryId: 'e1', authorUsername: 'admin', comment: 'Seguimiento', isSystemGenerated: false, createdAt: new Date().toISOString() }] } });
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('.en__side')?.textContent).toContain('Seguimiento');
  });

  it('las notas se abren en el panel: pizarrón y libreta', async () => {
    const { fixture, el, button } = await render();
    button('Notas').click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const board = el.querySelector('.en__note-area') as HTMLTextAreaElement;
    expect(board.value).toBe('Pizarrón de prueba');
    button('Mi libreta').click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    expect((el.querySelector('.en__note-area') as HTMLTextAreaElement).value).toBe('Nota personal');
  });

  it('"Defang IoCs" neutraliza URLs e IPs del texto antes de guardar', async () => {
    const { fixture, el, button } = await render();
    const area = el.querySelector('.en__textarea') as HTMLTextAreaElement;
    area.value = 'Conexión a https://malo.cl desde 185.220.1.1';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Defang IoCs').click();
    fixture.detectChanges();
    await tick();
    expect(area.value).toBe('Conexión a hxxps://malo[.]cl desde 185[.]220[.]1[.]1');
  });
});
