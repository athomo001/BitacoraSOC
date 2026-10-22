import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminPublicLinksComponent } from './admin-public-links';

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Administración → Enlaces públicos (10h)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminPublicLinksComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function render() {
    const fixture = TestBed.createComponent(AdminPublicLinksComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/public-links/meta').flush({ data: { kinds: ['telework', 'guards', 'tickets', 'client'] } });
    httpMock.expectOne('/api/areas').flush({ data: [{ id: 'a1', code: 'soc', name: 'SOC', active: true }, { id: 'a2', code: 'ti', name: 'TI', active: false }] });
    httpMock.expectOne((r) => r.url === '/api/organizations').flush({ data: [{ id: 'o1', name: 'Mundo', code: 'MUN', type: 'client', active: true }] });
    await settle();
    httpMock.expectOne('/api/public-links').flush({
      data: [{ id: 'l1', kind: 'guards', name: 'TV sala SOC', active: true, areaIds: ['a1'], createdAt: '2026-10-22T12:00:00Z', createdBy: 'admin', lastAccessedAt: '2026-10-22T14:31:00Z' }],
    });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    return { fixture, el, button };
  }

  it('lista los enlaces con lo que muestran; sin NOC no ofrece el Mapa', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Guardias: SOC');
    expect(el.textContent).not.toContain('Mapa NOC');
    expect(el.textContent).not.toContain('TI'); // un área apagada no se ofrece
  });

  it('crea el enlace con sus áreas y muestra la URL una sola vez', async () => {
    const { fixture, el, button } = await render();
    const name = el.querySelector('input[name="name"]') as HTMLInputElement;
    name.value = 'TV tickets';
    name.dispatchEvent(new Event('input'));
    button('Ticketera').click();
    fixture.detectChanges();
    expect(button('Crear enlace').disabled).toBe(true); // falta el área
    (el.querySelector('.pl__check input') as HTMLInputElement).click();
    fixture.detectChanges();
    button('Crear enlace').click();
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === '/api/public-links');
    expect(req.request.body).toEqual({ kind: 'tickets', name: 'TV tickets', areaIds: ['a1'], organizationId: undefined });
    req.flush({ data: { id: 'l2', kind: 'tickets', name: 'TV tickets', active: true, areaIds: ['a1'], createdAt: '', createdBy: 'admin', url: 'https://x/p/v/abc' } });
    await settle();
    httpMock.expectOne('/api/public-links').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.pl__fresh')?.textContent).toContain('no se vuelve a mostrar');
    expect(el.querySelector('.pl__url')?.textContent).toContain('https://x/p/v/abc');
  });
});
