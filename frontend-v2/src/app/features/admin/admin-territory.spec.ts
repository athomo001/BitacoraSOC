import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminTerritoryComponent } from './admin-territory';

const unit = (id: string, name: string, code: string, depth: number, active = true) => ({ id, name, code, kind: depth ? 'region' : 'country', depth, active });

describe('AdminTerritoryComponent (activar/desactivar masivo, pedido del dueño 2026-10-07)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminTerritoryComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminTerritoryComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, socEnabled: false, nocEnabled: true } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/territorial-units').flush({
      data: [unit('u0', 'Chile', 'CL', 0), unit('u1', 'Aisén', 'CL-AI', 1), unit('u2', 'Los Ríos', 'CL-LR', 1), unit('u3', 'Río Ibáñez', 'CL-AI-RI', 2)],
      meta: { page: 1, pageSize: 5000, total: 4 },
    });
    httpMock.match(() => true).forEach((r) => r.flush({ data: {} }));
    await tick();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text)) as HTMLButtonElement;

  it('con la búsqueda, "seleccionar las que coinciden" y Desactivar va en una sola llamada', async () => {
    const { fixture, el } = await render();
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'rio';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const all = el.querySelector('input[name="selectVisible"]') as HTMLInputElement;
    expect(all.parentElement?.textContent).toContain('Seleccionar las que coinciden (2)');
    all.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('2 seleccionadas');

    button(el, 'Desactivar').click();
    const req = httpMock.expectOne('/api/territorial-units/bulk-active');
    expect(req.request.body).toEqual({ ids: ['u2', 'u3'], active: false });
    req.flush({ data: { changed: 2 } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('2 desactivadas');
    expect(el.textContent).not.toContain('seleccionadas');
    expect(el.querySelectorAll('.tr__inactive').length).toBe(2);
  });

  it('marcar una por una y quitar la selección', async () => {
    const { fixture, el } = await render();
    const boxes = () => [...el.querySelectorAll<HTMLInputElement>('.tr__name input[type="checkbox"]')];
    boxes()[1].click();
    fixture.detectChanges();
    expect(el.textContent).toContain('1 seleccionadas');
    expect((el.querySelector('input[name="selectVisible"]') as HTMLInputElement).indeterminate).toBe(true);
    button(el, 'Quitar selección').click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('seleccionadas');
    httpMock.expectNone('/api/territorial-units/bulk-active');
  });
});
