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

  it('marca «Sin área» a quien no está en ningún grupo con área', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const row = () => (fixture.nativeElement as HTMLElement).querySelector('.aa-row') as HTMLElement;
    expect(row().querySelector('.pill.tone-warn')?.textContent).toContain('Sin área');
    const component = fixture.componentInstance as unknown as { userGroups: { set(v: Record<string, string[]>): void } };
    component.userGroups.set({ u1: ['g-soc'] });
    fixture.detectChanges();
    expect(row().textContent).not.toContain('Sin área');
  });

  it('antes de desactivar avisa lo que tiene a su nombre, y «Desactivar igual» lo bloquea', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [GROUPS[1]] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('app-user-retire button')].find((b) => b.textContent?.trim().endsWith(text))!;
    button('Desactivar').click();
    httpMock.expectOne('/api/users/u1/links').flush({ data: [{ kind: 'guard', label: 'Guardia N2', detail: '2' }, { kind: 'client', label: 'Casinos' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    const box = el.querySelector('app-user-retire [role="alert"]') as HTMLElement;
    expect(box.textContent).toContain('Guardia Guardia N2 · 2 turnos por venir');
    expect(box.textContent).toContain('CSM de Casinos');
    button('Desactivar igual').click();
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/users/u1' });
    expect(req.request.body).toEqual({ active: false });
    req.flush({ data: { ...USERS[0], active: false } });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne('/api/users/u1/links').flush({ data: [{ kind: 'client', label: 'Casinos' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('app-user-retire')?.textContent).toContain('Sigue a su nombre');
  });

  it('«Eliminar» a alguien con historial lo deja bloqueado y lo dice', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('app-user-retire button')].filter((b) => b.textContent?.trim().endsWith(text));
    button('Eliminar')[0].click();
    fixture.detectChanges();
    expect(el.querySelector('app-user-retire [role="alert"]')?.textContent).toContain('queda bloqueado');
    button('Eliminar').at(-1)!.click();
    httpMock.expectOne({ method: 'DELETE', url: '/api/users/u1' }).flush({ data: { deleted: false } });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.match('/api/users/u1/links').forEach((r) => r.flush({ data: [] }));
    fixture.detectChanges();
    expect(el.querySelector('.msg--ok')?.textContent).toContain('ana tenía historial: quedó bloqueado.');
    expect((fixture.componentInstance as unknown as { users(): { active: boolean }[] }).users()[0].active).toBe(false);
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
    expect(el.querySelector('.aa-row td:nth-child(2) .pill')?.textContent?.trim()).toBe('Analista');
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
    expect(boxes.length).toBe(10); // 2 grupos × 5 capacidades (directorio ×2, cambiar cliente de un ticket, avisos con acuse, jefatura de área)
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
