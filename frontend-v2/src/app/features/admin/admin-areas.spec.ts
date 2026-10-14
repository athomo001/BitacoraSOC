import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminAreasComponent } from './admin-areas';

const AREAS = [
  { id: 'a1', code: 'soc', name: 'SOC', active: true, system: true, groupCount: 3 },
  { id: 'a2', code: 'noc', name: 'NOC', active: true, system: true, groupCount: 1 },
];
const LEVELS = [
  { id: 'l1', code: 'n1', name: 'N1', rank: 1, groupCount: 2 },
  { id: 'l2', code: 'n2', name: 'N2', rank: 2, groupCount: 1 },
];

describe('AdminAreasComponent (Áreas y niveles, spec/16 9b)', () => {
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
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!;

  it('SOC y NOC aparecen como de sistema, con cuántos grupos las usan', async () => {
    const { el } = await render();
    expect(el.querySelectorAll('.pill.tone-system').length).toBe(2);
    expect(el.querySelector('tbody tr')?.textContent).toContain('3');
  });

  it('nueva área: el nombre va al servidor y la lista se recarga', async () => {
    const { fixture, el } = await render();
    button(el, 'Nueva área').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[name="newArea"]')!;
    input.value = 'Infraestructura';
    input.dispatchEvent(new Event('input'));
    await settle();
    fixture.detectChanges();
    expect(button(el, 'Crear').disabled).toBe(false);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/areas' });
    expect(req.request.body).toEqual({ name: 'Infraestructura' });
    req.flush({ data: { id: 'a3', code: 'infraestructura', name: 'Infraestructura', active: true, system: false, groupCount: 0 } });
    await settle();
    http.expectOne('/api/areas').flush({ data: AREAS });
    http.expectOne('/api/levels').flush({ data: LEVELS });
  });

  it('apagar NOC va por la API de áreas', async () => {
    const { el } = await render();
    el.querySelectorAll<HTMLInputElement>('input[role="switch"]')[1].dispatchEvent(new Event('change'));
    const req = http.expectOne({ method: 'PATCH', url: '/api/areas/noc' });
    expect(req.request.body).toEqual({ active: false });
    req.flush({ data: { ...AREAS[1], active: false } });
  });

  it('bajar N1 manda el orden nuevo', async () => {
    const { el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Bajar N1"]')!.click();
    const req = http.expectOne({ method: 'PUT', url: '/api/levels/order' });
    expect(req.request.body).toEqual({ ids: ['l2', 'l1'] });
    req.flush(null);
  });
});
