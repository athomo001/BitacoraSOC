import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminGlpiTicketsComponent } from './admin-glpi-tickets';
import { GlpiTicketRun, GlpiTicketsConfig } from '../../core/glpi/glpi.service';

const CONFIG: GlpiTicketsConfig = {
  enabled: true, every: '5m', sinceDays: 90, entities: [3], clients: { '3': 'o1' }, groupAreas: { '10': 'a-noc' },
  firstLoadPending: false, nextAutoAt: '2026-10-20T13:45:00Z', connected: true,
};
const CATALOG = {
  entities: [
    { id: 0, name: 'Raíz', parentId: -1 },
    { id: 3, name: 'Raíz > Casinos', parentId: 0 },
    { id: 5, name: 'Raíz > Contabilidad', parentId: 0 },
  ],
  groups: [{ id: 10, name: 'Redes y comunicaciones', openCount: 9 }, { id: 11, name: 'Mesa Contabilidad', openCount: 0 }],
};
const RUN: GlpiTicketRun = {
  id: 'r1', trigger: 'auto', firstLoad: false, startedAt: '2026-10-20T13:40:00Z', finishedAt: '2026-10-20T13:40:05Z', running: false, ok: true,
  created: 3, updated: 11, skipped: 1, deleted: 0, message: '1 sin un grupo técnico con área: no se traen.',
};
const SCOPE = {
  all: true, myAreas: [], defaultArea: 'soc',
  areas: [{ id: 'a-soc', code: 'soc', name: 'SOC', resolves: true }, { id: 'a-noc', code: 'noc', name: 'NOC', resolves: true }, { id: 'a-csm', code: 'csm', name: 'CSM', resolves: false }],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Administración → GLPI, tickets (10d.1)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminGlpiTicketsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(runs: GlpiTicketRun[] = [RUN]) {
    const fixture = TestBed.createComponent(AdminGlpiTicketsComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/glpi/tickets/config').flush({ data: CONFIG });
    httpMock.expectOne('/api/glpi/tickets/runs').flush({ data: runs });
    httpMock.expectOne((r) => r.url === '/api/organizations').flush({ data: [{ id: 'o1', name: 'Casinos', code: 'cas' }, { id: 'o2', name: 'Netics', code: 'net' }] });
    httpMock.expectOne('/api/tickets/scope').flush({ data: SCOPE });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  async function loadCatalog(fixture: Awaited<ReturnType<typeof render>>['fixture'], el: HTMLElement) {
    button(el, 'Traer entidades y grupos').click();
    httpMock.expectOne('/api/glpi/tickets/catalog').flush({ data: CATALOG });
    await settle();
    fixture.detectChanges();
  }

  it('muestra la última corrida y solo deja elegir áreas que reciben tickets', async () => {
    const { fixture, el } = await render();
    expect(el.textContent).toContain('1 sin un grupo técnico con área');
    expect(el.querySelector('.gt__stats')?.textContent).toContain('11');
    await loadCatalog(fixture, el);
    const group = el.querySelector<HTMLSelectElement>('select[name="group-10"]')!;
    expect(group.value).toBe('a-noc');
    expect([...group.options].map((o) => o.textContent?.trim())).toEqual(['No traer', 'SOC', 'NOC']);
    expect(el.textContent).toContain('9');
  });

  it('avisa de una entidad marcada sin cliente y guarda solo los clientes que cambiaron', async () => {
    const { fixture, el } = await render();
    await loadCatalog(fixture, el);
    el.querySelector<HTMLInputElement>('input[name="bring-5"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.gt__warn')?.textContent).toContain('Raíz > Contabilidad');
    const client = el.querySelector<HTMLSelectElement>('select[name="client-5"]')!;
    client.value = 'o2';
    client.dispatchEvent(new Event('change'));
    const area = el.querySelector<HTMLSelectElement>('select[name="group-11"]')!;
    area.value = 'a-soc';
    area.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('.gt__warn')).toBeNull();
    let emitted = 0;
    fixture.componentInstance.clientsSaved.subscribe(() => emitted++);
    button(el, 'Guardar').click();
    const req = httpMock.expectOne('/api/glpi/tickets/config');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      enabled: true, every: '5m', sinceDays: 90, entities: [3, 5], clients: { '5': 'o2' }, groupAreas: { '10': 'a-noc', '11': 'a-soc' },
    });
    req.flush({ data: { ...CONFIG, entities: [3, 5], clients: { '3': 'o1', '5': 'o2' }, groupAreas: { '10': 'a-noc', '11': 'a-soc' }, firstLoadPending: true } });
    await settle();
    fixture.detectChanges();
    expect(emitted).toBe(1);
    expect(el.textContent).toContain('La próxima corrida hace la primera carga.');
  });

  it('«Sincronizar ahora» mira las corridas hasta que termina', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { fixture, el } = await render();
      button(el, 'Sincronizar ahora').click();
      httpMock.expectOne('/api/glpi/tickets/sync').flush({ data: { started: true } }, { status: 202, statusText: 'Accepted' });
      await settle();
      const running = { ...RUN, id: 'r2', trigger: 'manual' as const, running: true, finishedAt: undefined, userName: 'Lucía Vera' };
      httpMock.expectOne('/api/glpi/tickets/runs').flush({ data: [running, RUN] });
      await settle();
      fixture.detectChanges();
      expect(button(el, 'Sincronizando').disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      httpMock.expectOne('/api/glpi/tickets/runs').flush({ data: [{ ...running, running: false, finishedAt: '2026-10-20T13:41:00Z', created: 2 }, RUN] });
      await settle();
      httpMock.expectOne('/api/glpi/tickets/config').flush({ data: CONFIG });
      await settle();
      fixture.detectChanges();
      expect(button(el, 'Sincronizar ahora').disabled).toBe(false);
      expect(el.textContent).toContain('Lucía Vera');
    } finally {
      vi.useRealTimers();
    }
  });
});
