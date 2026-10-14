import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminAreasComponent } from './admin-areas';

const AREAS = [
  { id: 'a1', code: 'soc', name: 'SOC', active: true, system: true, profile: 'operativo', groupCount: 3 },
  { id: 'a2', code: 'noc', name: 'NOC', active: false, system: true, profile: 'operativo', groupCount: 1 },
  { id: 'a3', code: 'infra', name: 'Infraestructura', active: true, system: false, profile: 'resolutor', groupCount: 1 },
];
const LEVELS = [
  { id: 'l1', code: 'n1', name: 'N1', rank: 1, groupCount: 2 },
  { id: 'l2', code: 'n2', name: 'N2', rank: 2, groupCount: 1 },
];
const SOC_PEOPLE = [
  { id: 'u1', username: 'arojas', fullName: 'Ana Rojas', email: 'a@x.cl', active: true, levelId: 'l2', lead: true, extras: ['directory:write'] },
  { id: 'u2', username: 'jperez', fullName: 'Juan Pérez', email: 'j@x.cl', active: true, levelId: 'l1', lead: false, extras: [] },
];

describe('AdminAreasComponent (Áreas y niveles: ficha del área)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminAreasComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminAreasComponent);
    fixture.detectChanges();
    http.expectOne('/api/areas').flush({ data: AREAS });
    http.expectOne('/api/levels').flush({ data: LEVELS });
    await settle();
    fixture.detectChanges();
    http.expectOne('/api/areas/soc/people').flush({ data: SOC_PEOPLE });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('abre la primera área activa con su gente, su nivel y sus jefes', async () => {
    const { el } = await render();
    expect(el.querySelector('.ar__head')?.textContent).toContain('SOC');
    expect(el.querySelector('.ar__leads')?.textContent).toContain('Ana Rojas');
    const rows = el.querySelectorAll('app-area-people tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.ap__levels button[aria-pressed="true"]')?.textContent?.trim()).toBe('N2');
    expect(el.querySelectorAll('.ar__item').length).toBe(3);
  });

  it('cambiar el nivel guarda la ubicación de la persona solo en esa área', async () => {
    const { el } = await render();
    const row = el.querySelectorAll('app-area-people tbody tr')[1];
    ([...row.querySelectorAll<HTMLButtonElement>('.ap__levels button')].find((b) => b.textContent?.trim() === 'N2'))!.click();
    http.expectOne('/api/users/u2/placement').flush({ data: { areas: [{ code: 'soc', levelId: 'l1', lead: false }, { code: 'infra', levelId: 'l1', lead: false }], extras: [] } });
    await settle();
    const put = http.expectOne({ method: 'PUT', url: '/api/users/u2/placement' });
    expect(put.request.body).toEqual({ areas: [{ code: 'infra', levelId: 'l1', lead: false }, { code: 'soc', levelId: 'l2', lead: false }], extras: [] });
    put.flush({ data: put.request.body });
    await settle();
    http.expectOne('/api/areas/soc/people').flush({ data: SOC_PEOPLE });
  });

  it('apagar el área no toca los módulos (el área es gente)', async () => {
    const { el } = await render();
    el.querySelector<HTMLInputElement>('.ar__active input[role="switch"]')!.dispatchEvent(new Event('change'));
    const req = http.expectOne({ method: 'PATCH', url: '/api/areas/soc' });
    expect(req.request.body).toEqual({ active: false });
    req.flush({ data: { ...AREAS[0], active: false } });
    http.expectNone('/api/config/modules');
  });

  it('elegir otra área carga su gente', async () => {
    const { fixture, el } = await render();
    ([...el.querySelectorAll<HTMLButtonElement>('.ar__item')].find((b) => b.textContent?.includes('Infraestructura')))!.click();
    fixture.detectChanges();
    await settle();
    http.expectOne('/api/areas/infra/people').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Nadie en esta área todavía');
  });

  it('Niveles: bajar N1 manda el orden nuevo', async () => {
    const { fixture, el } = await render();
    ([...el.querySelectorAll<HTMLButtonElement>('.ar__side-foot button')].find((b) => b.textContent?.includes('Niveles')))!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button[aria-label="Bajar N1"]')!.click();
    const req = http.expectOne({ method: 'PUT', url: '/api/levels/order' });
    expect(req.request.body).toEqual({ ids: ['l2', 'l1'] });
    req.flush(null);
  });
});
