import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { AdminGlpiWriteComponent } from './admin-glpi-write';
import { GlpiCreateDialogComponent, GlpiCreateDialogData } from '../tickets/glpi-create-dialog';
import { TicketGlpiCommentComponent } from '../tickets/ticket-glpi-comment';
import { GlpiCreatePreview, GlpiOutboxItem, GlpiWriteConfig } from '../../core/glpi/glpi.service';

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

const CONFIG: GlpiWriteConfig = {
  enabled: false, hasToken: false, defaultType: 1,
  clients: [
    { clientId: 'c1', clientName: 'Casinos', entities: [{ id: 3, name: 'Raíz > Casinos' }, { id: 8, name: 'Raíz > Casinos > Sucursales' }], entityId: null },
    { clientId: 'c2', clientName: 'Netics', entities: [{ id: 5, name: 'Raíz > Netics' }], entityId: 5 },
    { clientId: 'c3', clientName: 'JUNJI', entities: [], entityId: null },
  ],
  areas: [{ areaId: 'a1', areaName: 'SOC', groups: [{ id: 10, name: 'Seguridad SOC' }], groupId: 10 }],
};
const FAILED: GlpiOutboxItem = { id: 'o1', kind: 'followup', glpiTicketId: 48177, state: 'failed', attempts: 1, lastError: 'GLPI respondió 400: el ticket está cerrado',
  lastAttemptAt: '2026-10-21T18:40:00Z', nextAttemptAt: '2026-10-21T18:40:00Z', createdAt: '2026-10-21T18:40:00Z' };

describe('Administración → GLPI → Escribir en GLPI (10d.2)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminGlpiWriteComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(config = CONFIG, queue: GlpiOutboxItem[] = [FAILED]) {
    const fixture = TestBed.createComponent(AdminGlpiWriteComponent);
    fixture.detectChanges();
    http.expectOne('/api/glpi/write/config').flush({ data: config });
    http.expectOne('/api/glpi/write/queue').flush({ data: queue });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('encender pide el token; se guarda con la entidad elegida para el cliente con más de una', async () => {
    const { fixture, el } = await render();
    expect(el.textContent).toContain('Sin entidad: no se puede crear en GLPI');
    expect(el.textContent).toContain('Raíz > Netics (la única)');
    (el.querySelector('input[name="glpiWrite"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('falta el User-Token de escritura');
    expect(button(el, 'Guardar').disabled).toBe(true);
    const token = el.querySelector('input[name="glpiWriteToken"]') as HTMLInputElement;
    token.value = 'tok-escritura';
    token.dispatchEvent(new Event('input'));
    const select = el.querySelector('select[aria-label="Casinos"]') as HTMLSelectElement;
    select.value = '8';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button(el, 'Guardar').click();
    const req = http.expectOne('/api/glpi/write/config');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ enabled: true, token: 'tok-escritura', defaultType: 1, clientEntities: { c1: 8 }, areaGroups: {} });
    req.flush({ data: { ...CONFIG, enabled: true, hasToken: true, clients: [{ ...CONFIG.clients[0], entityId: 8 }, CONFIG.clients[1], CONFIG.clients[2]] } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado, cifrado');
  });

  it('«Probar» dice con quién conectó, sin crear nada; lo fallido se reintenta', async () => {
    const { fixture, el } = await render({ ...CONFIG, enabled: true, hasToken: true });
    button(el, 'Probar').click();
    http.expectOne('/api/glpi/write/test').flush({ data: { ok: true, user: 'bitacora-escritura', profile: 'Técnico' } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Conectó como «bitacora-escritura» (perfil Técnico). No se creó nada.');
    expect(el.textContent).toContain('Seguimiento en GLPI-48177');
    expect(el.textContent).toContain('el ticket está cerrado');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reintentar')!.click();
    const retry = http.expectOne('/api/glpi/write/retry');
    expect(retry.request.body).toEqual({ id: 'o1' });
    retry.flush({ data: { queued: 1 } });
    await settle();
    http.expectOne('/api/glpi/write/queue').flush({ data: [{ ...FAILED, state: 'sent' }] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Enviado');
  });
});

describe('«Crear en GLPI» (10d.2)', () => {
  const PREVIEW: GlpiCreatePreview = {
    entities: [{ id: 3, name: 'Raíz > Casinos' }], entityId: 3, groups: [{ id: 10, name: 'Seguridad SOC' }], groupId: 10, type: 1,
    urgency: 4, impact: 3, title: 'Fuerza bruta en VPN', description: 'TKT-2026-00061 en Bitácora Ops\n\n312 intentos',
  };

  function render(preview: GlpiCreatePreview) {
    const create = vi.fn().mockResolvedValue({ id: 48240 });
    const close = vi.fn();
    const data: GlpiCreateDialogData<{ id: number }> = { load: () => Promise.resolve(preview), create };
    TestBed.configureTestingModule({ imports: [GlpiCreateDialogComponent], providers: [{ provide: DIALOG_DATA, useValue: data }, { provide: DialogRef, useValue: { close } }] });
    const fixture = TestBed.createComponent(GlpiCreateDialogComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, create, close };
  }

  it('la vista previa trae entidad, grupo y urgencia; crear manda lo elegido y cierra', async () => {
    const { fixture, el, create, close } = render(PREVIEW);
    await settle();
    fixture.detectChanges();
    expect((el.querySelector('select[name="gcEntity"]') as HTMLSelectElement).value).toBe('3');
    expect(el.textContent).toContain('4 · 3');
    expect(el.textContent).toContain('TKT-2026-00061 en Bitácora Ops');
    button(el, 'Requerimiento').click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('app-button button')].find((b) => b.textContent?.includes('Crear en GLPI'))!.click();
    await settle();
    expect(create).toHaveBeenCalledWith({ entityId: 3, groupId: 10, type: 2, title: 'Fuerza bruta en VPN' });
    expect(close).toHaveBeenCalledWith({ id: 48240 });
  });

  it('si el cliente no tiene entidad, lo dice y no deja crear', async () => {
    const { fixture, el } = render({ ...PREVIEW, entities: [], entityId: null, problem: 'el cliente no tiene una entidad de GLPI' });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('no tiene una entidad');
    expect([...el.querySelectorAll<HTMLButtonElement>('app-button button')].find((b) => b.textContent?.includes('Crear en GLPI'))!.disabled).toBe(true);
  });
});

describe('Comentar un ticket de GLPI (10d.2)', () => {
  it('es privado por defecto y se puede marcar visible para el solicitante', async () => {
    TestBed.configureTestingModule({ imports: [TicketGlpiCommentComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TicketGlpiCommentComponent);
    fixture.componentRef.setInput('ticketId', 't1');
    const sent = vi.fn();
    fixture.componentInstance.sent.subscribe(sent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Sin marcar: seguimiento privado en GLPI.');
    const area = el.querySelector('textarea') as HTMLTextAreaElement;
    area.value = 'Cuadrilla en camino';
    area.dispatchEvent(new Event('input'));
    (el.querySelector('input[name="glpiPublic"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Lo verá el solicitante en GLPI.');
    button(el, 'Comentar en GLPI').click();
    const req = http.expectOne('/api/tickets/t1/comments');
    expect(req.request.body).toMatchObject({ content: 'Cuadrilla en camino', isPublic: true });
    req.flush({ data: { id: 'c9', glpiPush: 'sent' } });
    await settle();
    expect(sent).toHaveBeenCalled();
  });
});
