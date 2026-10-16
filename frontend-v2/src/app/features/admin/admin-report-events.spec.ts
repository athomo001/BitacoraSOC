import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminReportEventsComponent } from './admin-report-events';

const ev = (id: string, name: string, enabled = true) => ({ id, name, parent: 'Email Security', description: '', motivoDefault: `Motivo de ${name}`, enabled });

describe('AdminReportEventsComponent (catalogEvents del legacy)', () => {
  let httpMock: HttpTestingController;
  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminReportEventsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminReportEventsComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/report-events/all' && r.params.get('page') === '1').flush({ data: [ev('e1', 'Phishing detectado'), ev('e2', 'Malware')], meta: { total: 1858 } });
    await tick();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra el total, pagina de a 50 y busca en el servidor', async () => {
    const { fixture, el } = await render();
    expect(el.textContent).toContain('1858');
    expect(el.textContent).toContain('1 / 38');
    const search = el.querySelector('input[name="revSearch"]') as HTMLInputElement;
    search.value = 'phish';
    search.dispatchEvent(new Event('input'));
    await tick(300);
    httpMock.expectOne((r) => r.url === '/api/report-events/all' && r.params.get('q') === 'phish' && r.params.get('page') === '1').flush({ data: [ev('e1', 'Phishing detectado')], meta: { total: 1 } });
    await tick();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('importar un archivo lo sube y muestra cuántos entraron y qué filas fallaron', async () => {
    const { fixture, el } = await render();
    const input = el.querySelector('input[name="revImport"]') as HTMLInputElement;
    const file = new File(['nombre,categoria\nNuevo,Correo\n'], 'eventos.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await tick();
    const req = httpMock.expectOne('/api/report-events/import');
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({ data: { created: 1, skipped: 3, errors: [{ line: 4, reason: 'el nombre no puede quedar vacío' }] } });
    await tick();
    httpMock.expectOne((r) => r.url === '/api/report-events/all').flush({ data: [], meta: { total: 0 } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('1 evento(s) nuevo(s), 3 ya estaban.');
    expect(el.textContent).toContain('Línea 4: el nombre no puede quedar vacío');
  });

  it('desactivar un evento lo guarda con enabled=false', async () => {
    const { el } = await render();
    (el.querySelector('tbody tr input[role="switch"]') as HTMLInputElement).click();
    await tick();
    const req = httpMock.expectOne('/api/report-events/e1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ name: 'Phishing detectado', enabled: false });
    req.flush({ data: ev('e1', 'Phishing detectado', false) });
  });
});
