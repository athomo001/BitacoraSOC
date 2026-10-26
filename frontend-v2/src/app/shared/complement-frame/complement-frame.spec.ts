import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComplementFrameComponent } from './complement-frame';

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));
const ORIGIN = 'https://complementos.test';

describe('ComplementFrameComponent (10i)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ComplementFrameComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function open() {
    const fixture = TestBed.createComponent(ComplementFrameComponent);
    fixture.componentRef.setInput('slug', 'virustotal');
    fixture.componentRef.setInput('slot', 'panel:reputacion');
    fixture.componentRef.setInput('objectType', 'ticket');
    fixture.componentRef.setInput('objectId', 't-1');
    fixture.detectChanges();
    const embed = http.expectOne('/api/complements/virustotal/embed');
    expect(embed.request.body).toEqual({ slot: 'panel:reputacion', objectType: 'ticket', objectId: 't-1' });
    embed.flush({ data: { url: ORIGIN + '/c/virustotal/panel.html?object=ticket%3At-1&embed=x', origin: ORIGIN, settings: { umbral: 5 } } });
    await settle();
    fixture.detectChanges();
    const iframe = (fixture.nativeElement as HTMLElement).querySelector('iframe') as HTMLIFrameElement;
    const win = iframe.contentWindow as Window;
    const sent: { type: string; payload: Record<string, unknown> }[] = [];
    vi.spyOn(win, 'postMessage').mockImplementation(((msg: { type: string; payload: Record<string, unknown> }) => sent.push(msg)) as never);
    const send = (data: unknown, origin = ORIGIN) => window.dispatchEvent(new MessageEvent('message', { data, origin, source: win }));
    return { fixture, iframe, sent, send };
  }

  it('al cargar manda el contexto con la ficha abierta y la configuración común', async () => {
    const { iframe, sent } = await open();
    iframe.dispatchEvent(new Event('load'));
    const ctx = sent.find((m) => m.type === 'CONTEXT_UPDATE');
    expect(ctx?.payload['object']).toEqual({ type: 'ticket', id: 't-1' });
    expect(ctx?.payload['settings']).toEqual({ umbral: 5 });
    expect(ctx?.payload['slot']).toBe('panel:reputacion');
  });

  it('API_REQUEST lee como la persona y responde con el mismo id', async () => {
    const { sent, send } = await open();
    send({ type: 'API_REQUEST', version: 1, payload: { id: 7, path: '/tickets?status=new' } });
    const req = http.expectOne('/api/complements/virustotal/api');
    expect(req.request.body).toEqual({ method: 'GET', path: '/tickets?status=new' });
    req.flush({ data: [{ number: 'TKT-1' }] });
    await settle();
    const res = sent.find((m) => m.type === 'API_RESPONSE');
    expect(res?.payload).toEqual({ id: 7, ok: true, status: 200, body: { data: [{ number: 'TKT-1' }] } });
  });

  it('ADD_NOTE deja el seguimiento en la ficha abierta y avisa para recargarla', async () => {
    const { fixture, sent, send } = await open();
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    send({ type: 'ADD_NOTE', version: 1, payload: { id: 'n1', content: '41 de 72 motores' } });
    const req = http.expectOne('/api/complements/virustotal/note');
    expect(req.request.body).toEqual({ target: 'ticket', id: 't-1', content: '41 de 72 motores' });
    req.flush({ data: { id: 'c1' } });
    await settle();
    expect(sent.find((m) => m.type === 'NOTE_ADDED')?.payload).toEqual({ id: 'n1', ok: true });
    expect(changed).toBe(1);
  });

  it('ignora mensajes de otro origen', async () => {
    const { send } = await open();
    send({ type: 'API_REQUEST', version: 1, payload: { id: 1, path: '/entries' } }, 'https://evil.test');
    http.expectNone('/api/complements/virustotal/api');
  });
});
