import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { DirectoryComponent } from './directory';

const CONTACT = {
  id: 'c1', organizationId: 'o1', organizationName: 'Contrata Norte', organizationType: 'contractor',
  name: 'José Pérez', position: 'Supervisor', specialty: 'Fibra Óptica', scope: 'external', source: 'manual',
  isFavorite: true, email: 'jose@x.cl', phone: '+56912345678', channels: [],
};

describe('DirectoryComponent (portado del legacy)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DirectoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve));

  async function render(role: string, capabilities: string[]) {
    const fixture = TestBed.createComponent(DirectoryComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ data: { id: 'u1', username: 'x', role } });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: 'both', capabilities } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/organizations').flush({ data: [{ id: 'o1', name: 'Contrata Norte', code: 'CN', type: 'contractor', active: true }] });
    await tick();
    httpMock
      .expectOne((r) => r.url === '/api/directory')
      .flush({ data: [CONTACT], meta: { page: 1, pageSize: 50, total: 1 } });
    await tick();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('sin directory:write muestra solo lectura y deshabilita crear/editar', async () => {
    const { el } = await render('user', []);
    expect(el.textContent).toContain('Vista de solo lectura');
    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Agregar contacto'));
    expect(add?.disabled).toBe(true);
    const edit = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Editar');
    expect(edit?.disabled).toBe(true);
    expect(el.textContent).not.toContain('Consolidar duplicados');
  });

  it('con directory:write puede editar pero no eliminar sin directory:delete', async () => {
    const { el } = await render('user', ['directory:write']);
    expect(el.textContent).not.toContain('Vista de solo lectura');
    const edit = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Editar');
    const del = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Eliminar');
    expect(edit?.disabled).toBe(false);
    expect(del?.disabled).toBe(true);
  });

  it('admin ve Consolidar duplicados y la tabla muestra los datos del contacto', async () => {
    const { el } = await render('admin', []);
    expect(el.textContent).toContain('Consolidar duplicados');
    expect(el.textContent).toContain('José Pérez');
    expect(el.textContent).toContain('+56912345678');
    expect(el.textContent).toContain('★');
    expect(el.textContent).toContain('1-1 de 1');
  });

  it('la búsqueda viaja al backend (no filtra en el navegador como el legacy)', async () => {
    const { el } = await render('admin', []);
    const input = el.querySelector('input[name="q"]') as HTMLInputElement;
    input.value = 'perez';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const req = httpMock.expectOne((r) => r.url === '/api/directory');
    expect(req.request.params.get('q')).toBe('perez');
    expect(req.request.params.get('page')).toBe('1');
    req.flush({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });
});
