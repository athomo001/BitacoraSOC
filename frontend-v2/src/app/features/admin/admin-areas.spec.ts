import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminAreasComponent } from './admin-areas';

const AREAS = [
  { id: 'a1', code: 'soc', name: 'SOC', active: true, system: true, profile: 'operativo', groupCount: 3, departmentId: 'd1', sharesTeam: true },
  { id: 'a2', code: 'noc', name: 'NOC', active: false, system: true, profile: 'operativo', groupCount: 1, departmentId: 'd1', sharesTeam: true },
  { id: 'a3', code: 'infra', name: 'Infraestructura', active: true, system: false, profile: 'resolutor', groupCount: 1 },
];
const DEPTS = [{ id: 'd1', name: 'CDC', areas: ['soc', 'noc'], shared: ['soc', 'noc'], leads: [{ id: 'u9', name: 'David Espinoza' }], csms: [{ id: 'c2', name: 'Ana Silva', areas: [] }] }];
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
    http.expectOne('/api/departments').flush({ data: DEPTS });
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
    // CDC con sus dos áreas y, aparte, Infraestructura sin departamento.
    expect(el.querySelectorAll('.ar__item').length).toBe(4);
    expect(el.querySelectorAll('.ar__item--child').length).toBe(3);
    expect(el.querySelector('.ar__group')?.textContent).toContain('Sin departamento');
    expect(el.querySelector<HTMLSelectElement>('select[name="areaDept"]')?.value).toBe('d1');
    expect(el.querySelector('.ar__head')?.textContent).toContain('Comparte equipo con NOC');
  });

  it('un área con datos se une a otra y, ya vacía, se borra; SOC no tiene esa opción', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('app-area-remove')).toBeNull();
    ([...el.querySelectorAll<HTMLButtonElement>('.ar__item')].find((b) => b.textContent?.includes('Infraestructura')))!.click();
    fixture.detectChanges();
    await settle();
    http.match('/api/areas/infra/people').forEach((r) => r.flush({ data: [] }));
    http.expectOne('/api/areas/infra/usage').flush({ data: { people: 2, tickets: 3, assets: 0, teams: 1, policies: 0, tasks: 0, goals: 0, windows: 0, other: 0, empty: false } });
    await settle();
    fixture.detectChanges();
    const box = el.querySelector('app-area-remove') as HTMLElement;
    expect(box.textContent).toContain('2 personas');
    expect(box.textContent).toContain('3 tickets');
    expect(box.textContent).not.toContain('Borrar área');
    const select = box.querySelector<HTMLSelectElement>('select[name="mergeInto"]')!;
    select.value = 'soc';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ([...box.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Unir a SOC')))!.click();
    fixture.detectChanges();
    expect(box.textContent).toContain('No se puede deshacer');
    ([...box.querySelectorAll<HTMLButtonElement>('.rm__confirm button')].find((b) => b.textContent?.includes('Unir a SOC')))!.click();
    const merge = http.expectOne({ method: 'POST', url: '/api/areas/infra/merge' });
    expect(merge.request.body).toEqual({ into: 'soc' });
    merge.flush({ data: { moved: 2, usage: { people: 0, tickets: 0, assets: 0, teams: 0, policies: 0, tasks: 0, goals: 0, windows: 0, other: 0, empty: true } } });
    await settle();
    fixture.detectChanges();
    expect(box.textContent).toContain('2 personas y todos los datos pasaron a SOC');
    ([...box.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Borrar área')))!.click();
    fixture.detectChanges();
    ([...box.querySelectorAll<HTMLButtonElement>('.rm__confirm button')].find((b) => b.textContent?.includes('Borrar área')))!.click();
    http.expectOne({ method: 'DELETE', url: '/api/areas/infra' }).flush(null);
  });

  it('mover un área con el selector de la ficha: a otro departamento o a ninguno', async () => {
    const { el } = await render();
    const select = el.querySelector<HTMLSelectElement>('select[name="areaDept"]')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    const req = http.expectOne({ method: 'PATCH', url: '/api/departments/d1' });
    expect(req.request.body).toEqual({ areas: ['noc'] });
  });

  it('arrastrar un área suelta sobre un departamento la mueve ahí', async () => {
    const { fixture, el } = await render();
    const infra = [...el.querySelectorAll<HTMLButtonElement>('.ar__item--child')].find((b) => b.textContent?.includes('Infraestructura'))!;
    const cdc = [...el.querySelectorAll<HTMLButtonElement>('.ar__item')].find((b) => b.textContent?.includes('CDC'))!;
    expect(infra.getAttribute('draggable')).toBe('true');
    infra.dispatchEvent(new Event('dragstart'));
    const over = new Event('dragover', { cancelable: true });
    cdc.dispatchEvent(over);
    fixture.detectChanges();
    expect(over.defaultPrevented).toBe(true);
    expect(cdc.classList).toContain('ar__item--drop');
    cdc.dispatchEvent(new Event('drop', { cancelable: true }));
    const req = http.expectOne({ method: 'PATCH', url: '/api/departments/d1' });
    expect(req.request.body).toEqual({ areas: ['soc', 'noc', 'infra'] });
  });

  async function openDept() {
    const r = await render();
    ([...r.el.querySelectorAll<HTMLButtonElement>('.ar__item')].find((b) => b.textContent?.includes('CDC')))!.click();
    r.fixture.detectChanges();
    await settle();
    http.expectOne('/api/users').flush({ data: [{ id: 'u1', username: 'arojas', fullName: 'Ana Rojas', active: true }, { id: 'u9', username: 'despinoza', fullName: 'David Espinoza', active: true }] });
    for (const code of ['soc', 'noc']) http.match(`/api/areas/${code}/people`).forEach((q) => q.flush({ data: code === 'soc' ? SOC_PEOPLE : [SOC_PEOPLE[0]] }));
    await settle();
    r.fixture.detectChanges();
    return r;
  }

  const tabBtn = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('app-department-panel [role="tab"]')].find((b) => b.textContent?.includes(text))!;

  it('el departamento: sus áreas, agregar una suelta y sacar otra', async () => {
    const { el } = await openDept();
    const panel = el.querySelector('app-department-panel') as HTMLElement;
    expect(panel.textContent).toContain('Departamento CDC');
    expect(panel.textContent).toContain('Comparte equipo con NOC');
    ([...panel.querySelectorAll<HTMLButtonElement>('.dp__add button')].find((b) => b.textContent?.includes('Infraestructura')))!.click();
    let req = http.expectOne({ method: 'PATCH', url: '/api/departments/d1' });
    expect(req.request.body).toEqual({ areas: ['soc', 'noc', 'infra'] });
    req.flush({ data: DEPTS[0] });
    await settle();
    panel.querySelector<HTMLButtonElement>('button[aria-label="Sacar NOC del departamento"]')!.click();
    req = http.expectOne({ method: 'PATCH', url: '/api/departments/d1' });
    expect(req.request.body).toEqual({ areas: ['soc'] });
  });

  it('jefatura: agregar a alguien a la jefatura del departamento', async () => {
    const { fixture, el } = await openDept();
    tabBtn(el, 'Jefatura').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Jefe de SOC y NOC');
    const select = el.querySelector<HTMLSelectElement>('select[name="newLead"]')!;
    select.value = 'u1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ([...el.querySelectorAll<HTMLButtonElement>('.dp__add button')].find((b) => b.textContent?.includes('Agregar jefe')))!.click();
    const req = http.expectOne({ method: 'PUT', url: '/api/departments/d1/leads' });
    expect(req.request.body).toEqual({ userIds: ['u9', 'u1'] });
  });

  it('CSM del departamento: asignar a una CSM y elegir a qué áreas va', async () => {
    const { fixture, el } = await openDept();
    http.match('/api/departments/csm-people').forEach((r) => r.flush({ data: [{ id: 'c1', name: 'María Pérez' }, { id: 'c2', name: 'Ana Silva' }] }));
    await settle();
    tabBtn(el, 'CSM').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ana Silva');
    const select = el.querySelector<HTMLSelectElement>('select[name="newCsm"]')!;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Elige a una CSM', 'María Pérez']);
    select.value = 'c1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ([...el.querySelectorAll<HTMLButtonElement>('.dp__add button')].find((b) => b.textContent?.includes('Asignar CSM')))!.click();
    let req = http.expectOne({ method: 'PUT', url: '/api/departments/d1/csms' });
    expect(req.request.body).toEqual({ csms: [{ id: 'c2', areas: [] }, { id: 'c1', areas: [] }] });
    req.flush({ data: DEPTS[0] });
    await settle();
    fixture.detectChanges();
    const row = [...el.querySelectorAll<HTMLElement>('app-department-panel .dp__row')].find((r) => r.textContent?.includes('Ana Silva'))!;
    ([...row.querySelectorAll<HTMLButtonElement>('.seg')].find((b) => b.textContent?.trim() === 'SOC'))!.click();
    req = http.expectOne({ method: 'PUT', url: '/api/departments/d1/csms' });
    expect(req.request.body).toEqual({ csms: [{ id: 'c2', areas: ['soc'] }] });
  });

  it('comparten equipo: desmarcar NOC y guardar', async () => {
    const { fixture, el } = await openDept();
    tabBtn(el, 'Comparten equipo').click();
    fixture.detectChanges();
    ([...el.querySelectorAll<HTMLButtonElement>('.dp__chips button')].find((b) => b.textContent?.includes('NOC')))!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ninguna área comparte equipo');
    ([...el.querySelectorAll<HTMLButtonElement>('.dp__actions button')].find((b) => b.textContent?.includes('Guardar')))!.click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/departments/d1' });
    expect(req.request.body).toEqual({ shared: ['soc'] });
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
