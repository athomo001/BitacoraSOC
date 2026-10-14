import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Component, input } from '@angular/core';
import { AdminTerritoryComponent } from './admin-territory';
import { AdminTerritoryMapComponent } from './admin-territory-map';

/** La parte del mapa tiene su propia prueba; acá solo se prueba el árbol. */
@Component({ selector: 'app-admin-territory-map', standalone: true, template: '' })
class MapStubComponent {
  readonly units = input<unknown[]>([]);
}

const unit = (id: string, name: string, path: string, parentId: string | null, childCount = 0) => {
  const code = path.split('.').pop()!;
  const depth = path.split('.').length - 1;
  return { id, name, code, path, parentId, childCount, kind: ['country', 'region', 'zone'][depth], depth, active: true };
};

describe('AdminTerritoryComponent (activar/desactivar masivo, pedido del dueño 2026-10-07)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminTerritoryComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.overrideComponent(AdminTerritoryComponent, { remove: { imports: [AdminTerritoryMapComponent] }, add: { imports: [MapStubComponent] } });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminTerritoryComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, socEnabled: false, nocEnabled: true } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/territorial-units').flush({
      data: [
        unit('u0', 'Chile', 'CL', null, 2),
        unit('u1', 'Aisén', 'CL.CL-AI', 'u0', 1),
        unit('u3', 'Río Ibáñez', 'CL.CL-AI.CL-AI-RI', 'u1'),
        unit('u2', 'Los Ríos', 'CL.CL-LR', 'u0'),
      ],
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
    expect(req.request.body).toEqual({ ids: ['u3', 'u2'], active: false });
    req.flush({ data: { changed: 2 } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('2 desactivadas');
    expect(el.textContent).not.toContain('seleccionadas');
    expect(el.querySelectorAll('.tr__inactive').length).toBe(2);
  });

  it('con la región cerrada, avisa cuántas inactivas tiene abajo y se actualiza al activar', async () => {
    const { fixture, el } = await render();
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'ibanez';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.tr__name input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    button(el, 'Desactivar').click();
    httpMock.expectOne('/api/territorial-units/bulk-active').flush({ data: { changed: 1 } });
    await tick();
    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('.tr__off')].map((x) => x.textContent?.trim())).toEqual(['1 inactivas abajo', '1 inactivas abajo']);
    (el.querySelectorAll('.tr__name input[type="checkbox"]')[1] as HTMLInputElement).click(); // Aisén
    fixture.detectChanges();
    button(el, 'Activar').click();
    httpMock.expectOne('/api/territorial-units/bulk-active').flush({ data: { changed: 1 } });
    await tick();
    fixture.detectChanges();
    expect(el.querySelectorAll('.tr__off').length).toBe(0);
  });

  it('árbol: las regiones arrancan cerradas y se abren con la flecha', async () => {
    const { fixture, el } = await render();
    expect(el.textContent).not.toContain('Río Ibáñez');
    (el.querySelector('button.tr__twist[aria-expanded="false"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Río Ibáñez');
  });

  it('marcar una región marca todo lo que tiene abajo; desmarcarla lo quita entero', async () => {
    const { fixture, el } = await render();
    const boxes = () => [...el.querySelectorAll<HTMLInputElement>('.tr__name input[type="checkbox"]')];
    boxes()[1].click(); // Aisén
    fixture.detectChanges();
    expect(el.textContent).toContain('2 seleccionadas');
    expect(boxes()[0].indeterminate).toBe(true); // Chile: una parte
    boxes()[1].click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('seleccionadas');
  });

  it('marcar y quitar la selección', async () => {
    const { fixture, el } = await render();
    const boxes = () => [...el.querySelectorAll<HTMLInputElement>('.tr__name input[type="checkbox"]')];
    boxes()[2].click(); // Los Ríos, sin nada abajo
    fixture.detectChanges();
    expect(el.textContent).toContain('1 seleccionadas');
    expect((el.querySelector('input[name="selectVisible"]') as HTMLInputElement).indeterminate).toBe(true);
    button(el, 'Quitar selección').click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('seleccionadas');
    httpMock.expectNone('/api/territorial-units/bulk-active');
  });
});
