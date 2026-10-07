import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminAccessComponent } from './admin-access';

const USERS = [{ id: 'u1', username: 'ana', email: 'ana@x.cl', role: 'user', active: true }];
const GROUPS = [
  { id: 'g-noc', code: 'noc-n1', name: 'NOC N1', moduleScope: 'noc', capabilities: [], active: true },
  { id: 'g-soc', code: 'soc-n1', name: 'SOC N1', moduleScope: 'soc', capabilities: [], active: true },
];

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

  it('si guardar falla, vuelve a mostrar los grupos que tenía', async () => {
    const fixture = await render();
    httpMock.expectOne('/api/users/u1/permission-groups').flush({ data: [GROUPS[0]] });
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      assignGroups(user: unknown, ids: string[]): Promise<void>;
      userGroups(): Record<string, string[]>;
    };
    const pending = component.assignGroups(USERS[0], ['g-soc']);
    httpMock.expectOne({ method: 'PUT', url: '/api/users/u1/permission-groups' }).flush(null, { status: 500, statusText: 'err' });
    await pending;
    expect(component.userGroups()['u1']).toEqual(['g-noc']);
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
    expect(boxes.length).toBe(6); // 2 grupos × 3 capacidades (directorio ×2, cambiar cliente de un ticket)
    boxes[0].click();
    const req = httpMock.expectOne({ method: 'PATCH', url: '/api/permission-groups/g-noc' });
    expect(req.request.body).toEqual({ capabilities: ['directory:write'] });
  });
});
