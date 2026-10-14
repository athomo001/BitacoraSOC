import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminAccessComponent } from './admin-access';

const USERS = [{ id: 'u1', username: 'ana', email: 'ana@x.cl', role: 'user', active: true }];
const GROUPS = [
  { id: 'g-noc', code: 'noc-n1', name: 'NOC N1', areas: ['noc'], profile: 'operativo', capabilities: [], active: true },
  { id: 'g-soc', code: 'soc-n1', name: 'SOC N1', areas: ['soc'], profile: 'operativo', capabilities: [], active: true },
];

const AREAS = [
  { id: 'a1', code: 'soc', name: 'SOC', active: true, system: true, profile: 'operativo', groupCount: 1 },
  { id: 'a2', code: 'noc', name: 'NOC', active: true, system: true, profile: 'operativo', groupCount: 1 },
  { id: 'a3', code: 'infra', name: 'Infraestructura', active: true, system: false, profile: 'resolutor', groupCount: 0 },
];
const LEVELS = [{ id: 'l1', code: 'n1', name: 'N1', rank: 1, groupCount: 0 }, { id: 'l2', code: 'n2', name: 'N2', rank: 2, groupCount: 0 }];

describe('AdminAccessComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminAccessComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminAccessComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/users').flush({ data: USERS });
    httpMock.expectOne('/api/permission-groups').flush({ data: GROUPS });
    httpMock.expectOne('/api/areas').flush({ data: AREAS });
    httpMock.expectOne('/api/levels').flush({ data: LEVELS });
    await fixture.whenStable();
    return fixture;
  }

  // Regresión: el selector partía vacío y el primer cambio reemplazaba los grupos reales.
  it('carga los grupos actuales de cada usuario antes de habilitar la edición', async () => {
    const fixture = await render();
    const component = fixture.componentInstance as unknown as { groupsLoaded(): boolean; userGroups(): Record<string, string[]> };
    expect(component.groupsLoaded()).toBe(false);
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [GROUPS[0]] });
    await fixture.whenStable();
    expect(component.groupsLoaded()).toBe(true);
    expect(component.userGroups()['u1']).toEqual(['g-noc']);
  });

  it('la persona se ubica por área y nivel, y Guardar manda todo junto', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [GROUPS[1]] });
    fixture.detectChanges();
    await fixture.whenStable();
    httpMock.expectOne('/api/users/u1/placement').flush({ data: { areas: [{ code: 'soc', levelId: 'l1', lead: false }], extras: [] } });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const seg = (label: string) => el.querySelector<HTMLButtonElement>(`.aa-levels button[aria-label="${label}"]`)!;
    const save = () => [...el.querySelectorAll<HTMLButtonElement>('.aa-place__actions .aa-btn--primary')][0];
    expect(seg('SOC N1').getAttribute('aria-pressed')).toBe('true');
    expect(save().disabled).toBe(true);

    seg('SOC N2').click();
    seg('Infraestructura N1').click();
    fixture.detectChanges();
    el.querySelectorAll('.aa-place')[2].querySelector<HTMLInputElement>('.aa-place__lead input')!.click(); // Jefe de Infraestructura
    fixture.detectChanges();
    expect(el.querySelector('.aa-shape__preview')?.textContent).toContain('Mi equipo');
    expect(save().disabled).toBe(false);

    save().click();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/users/u1/placement' });
    expect(req.request.body).toEqual({
      areas: [{ code: 'soc', levelId: 'l2', lead: false }, { code: 'infra', levelId: 'l1', lead: true }],
      extras: [],
    });
    req.flush({ data: req.request.body });
    await new Promise((r) => setTimeout(r));
    httpMock.expectOne('/api/permission-groups').flush({ data: GROUPS });
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
  });

  it('«—» saca a la persona del área y apaga su Jefe', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    fixture.detectChanges();
    await fixture.whenStable();
    httpMock.expectOne('/api/users/u1/placement').flush({ data: { areas: [{ code: 'infra', levelId: 'l1', lead: true }], extras: ['directory:write'] } });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.aa-levels button[aria-label="Infraestructura: fuera del área"]')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.aa-place')[2].querySelector('.aa-place__lead')).toBeNull();
    expect(el.querySelector('.aa-shape__preview')?.textContent).not.toContain('Mi equipo');
  });

  it('cambiar el rol desde el panel hace PATCH y, si falla, vuelve al rol anterior', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const auditor = [...el.querySelectorAll<HTMLButtonElement>('.aa-panel .seg')].find((b) => b.textContent?.trim() === 'Auditor')!;
    auditor.click();
    await new Promise((r) => setTimeout(r));
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/users/u1' });
    expect(req.request.body).toEqual({ role: 'auditor' });
    req.flush(null, { status: 409, statusText: 'err' });
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(el.querySelector('.aa-row .pill')?.textContent?.trim()).toBe('Analista');
  });

  it('el cumpleaños se edita desde el panel del usuario (como el legacy) y viaja como AAAA-MM-DD', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('#aa-birthday') as HTMLInputElement;
    input.value = '1990-10-06';
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r));
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/users/u1' });
    expect(req.request.body).toEqual({ birthday: '1990-10-06' });
    req.flush({ data: { ...USERS[0], birthday: '1990-10-06' } });
  });

  it('las capacidades de un grupo son casillas de la lista cerrada', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    ([...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes('Grupos'))!).click();
    fixture.detectChanges();
    const boxes = [...el.querySelectorAll<HTMLButtonElement>('.aa-table button[role="checkbox"]')];
    expect(boxes.length).toBe(8); // 2 grupos × 4 capacidades (directorio ×2, cambiar cliente de un ticket, jefatura de área)
    boxes[0].click();
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/permission-groups/g-noc' });
    expect(req.request.body).toEqual({ capabilities: ['directory:write'] });
  });

  it('editar un grupo: áreas, nivel y perfil van juntos y la vista previa sigue al perfil', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    ([...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes('Grupos'))!).click();
    fixture.detectChanges();
    (el.querySelector('.aa-link') as HTMLButtonElement).click(); // NOC N1
    fixture.detectChanges();
    const seg = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('.aa-shape .seg')].find((b) => b.textContent?.trim() === text)!;
    seg('Infraestructura').click();
    seg('NOC').click();
    seg('N2').click();
    ([...el.querySelectorAll<HTMLButtonElement>('.aa-prof')].find((b) => b.textContent?.includes('Resolutor'))!).click();
    fixture.detectChanges();
    const menu = [...el.querySelectorAll('.aa-shape__preview .pill')].map((p) => p.textContent ?? '').join(' ');
    expect(menu).toContain('Cola de tickets');
    expect(menu).not.toContain('Bitácora');
    ([...el.querySelectorAll<HTMLButtonElement>('.aa-btn--primary')].find((b) => b.textContent?.includes('Guardar'))!).click();
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/permission-groups/g-noc' });
    expect(req.request.body).toEqual({ areas: ['infra'], profile: 'resolutor', setLevel: true, levelId: 'l2' });
    req.flush({ data: { ...GROUPS[0], areas: ['infra'], profile: 'resolutor', levelId: 'l2' } });
  });
});
