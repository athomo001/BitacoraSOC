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
});
