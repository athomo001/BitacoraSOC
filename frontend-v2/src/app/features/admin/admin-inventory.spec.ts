import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminInventoryComponent } from './admin-inventory';

const META = {
  kinds: [{ code: 'network', name: 'Red', icon: 'router', baseType: 'device', sortOrder: 30, active: true, fields: [{ key: 'ports', label: 'Puertos', kind: 'text' }] }],
  responsibleTypes: [{ code: 'config', name: 'Configuración y sistema', active: true }],
  areas: [], myAreas: [], viewAll: true, admin: true, pendingRequests: 0, canCreate: true,
};

describe('Administración → Inventario (9.2)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminInventoryComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('agrega un campo de lista a un tipo y lo guarda', async () => {
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/inventory/meta').flush({ data: META });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'addCampo')!.click();
    fixture.detectChanges();
    const label = el.querySelector<HTMLInputElement>('input[name="fl-1"]')!;
    label.value = 'PoE';
    label.dispatchEvent(new Event('input'));
    const kind = el.querySelector<HTMLSelectElement>('select[name="fk-1"]')!;
    kind.value = 'list';
    kind.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const options = el.querySelector<HTMLInputElement>('input[name="fo-1"]')!;
    options.value = 'No, PoE, PoE+';
    options.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar tipo'))!.click();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/inventory/kinds/network' });
    expect(req.request.body.fields).toEqual([
      { key: 'ports', label: 'Puertos', kind: 'text' },
      { key: '', label: 'PoE', kind: 'list', options: ['No', 'PoE', 'PoE+'] },
    ]);
  });
});
