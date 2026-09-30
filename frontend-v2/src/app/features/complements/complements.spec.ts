import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ComplementsComponent } from './complements';
import { ActiveComplement } from '../../core/complements/complements.service';

const LIST: ActiveComplement[] = [
  { slug: 'diccionario', name: 'Diccionario de logs', icon: 'menu_book', status: 'active', sourceType: 'zip_static', circuit: 'CLOSED' },
  { slug: 'asistente', name: 'Asistente de turnos', icon: 'smart_toy', status: 'maintenance', sourceType: 'manual', circuit: 'CLOSED' },
  { slug: 'mapa', name: 'Mapa de enlaces', icon: 'hub', status: 'active', sourceType: 'manual', circuit: 'OPEN' },
];

const ORIGIN = 'http://127.0.0.1:8082';

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('ComplementsComponent', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({ slug: 'diccionario' }));
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [ComplementsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(ComplementsComponent);
    fixture.detectChanges();
    http.expectOne('/api/complements/active').flush({ data: LIST });
    await settle();
    http.expectOne('/api/complements/diccionario/embed').flush({ data: { url: `${ORIGIN}/c/diccionario/index.html?embed=x`, origin: ORIGIN } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, frame: () => el.querySelector('iframe') as HTMLIFrameElement | null };
  }

  it('muestra una pestaña por complemento y abre el elegido en un iframe aislado', async () => {
    const { el, frame } = await render();
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '');
    expect(tabs.length).toBe(3);
    expect(tabs[0]).toContain('Diccionario de logs');
    expect(tabs[1]).toContain('construction'); // marca de mantenimiento
    expect(tabs[2]).toContain('cloud_off'); // marca de sin respuesta
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Diccionario de logs');
    expect(frame()?.getAttribute('src')).toContain('/c/diccionario/index.html?embed=');
    expect(frame()?.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(el.textContent).toContain('127.0.0.1:8082');
  });

  it('en mantenimiento o sin respuesta muestra el aviso en vez del iframe (sin pedir el enlace)', async () => {
    const { fixture, el, frame } = await render();
    params.next(convertToParamMap({ slug: 'asistente' }));
    await settle();
    fixture.detectChanges();
    expect(frame()).toBeNull();
    expect(el.textContent).toContain('En mantenimiento');
    params.next(convertToParamMap({ slug: 'mapa' }));
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('No disponible');
    http.expectNone('/api/complements/asistente/embed');
    http.expectNone('/api/complements/mapa/embed');
  });

  it('el puente responde REQUEST_CONTEXT y CREATE_ENTRY solo desde el iframe y el origen correctos', async () => {
    const { frame } = await render();
    const win = frame()!.contentWindow!;
    const post = vi.spyOn(win, 'postMessage');

    // Otro origen o sin version: se ignora.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'REQUEST_CONTEXT', version: 1 }, origin: 'https://evil.example', source: win }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'REQUEST_CONTEXT' }, origin: ORIGIN, source: win }));
    expect(post).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'REQUEST_CONTEXT', version: 1 }, origin: ORIGIN, source: win }));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'CONTEXT_UPDATE', version: 1 }), ORIGIN);
    const payload = post.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(Object.keys(payload.payload)).toEqual(['user', 'theme', 'dyslexiaFont', 'language']);

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'CREATE_ENTRY', version: 1, payload: { content: 'Desde el complemento', entryType: 'incidente' } }, origin: ORIGIN, source: win }));
    const req = http.expectOne('/api/complements/diccionario/entries');
    expect(req.request.body).toEqual({ content: 'Desde el complemento', entryType: 'incidente', tags: undefined });
    req.flush({ data: {} });
  });

  it('más de 100 mensajes en 10 s desconecta el iframe', async () => {
    const { fixture, el, frame } = await render();
    const win = frame()!.contentWindow!;
    for (let i = 0; i < 101; i++) {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'NOOP', version: 1 }, origin: ORIGIN, source: win }));
    }
    fixture.detectChanges();
    expect(frame()).toBeNull();
    expect(el.textContent).toContain('Complemento desconectado');
  });
});
