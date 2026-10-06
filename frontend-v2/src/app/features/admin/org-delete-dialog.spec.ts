import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { OrgDeleteData, OrgDeleteDialogComponent } from './org-delete-dialog';

const ORG = { id: 'acm', name: 'Acme', code: 'ACM', type: 'internal', active: true };
const MUNDO = { id: 'mun', name: 'Mundo', code: 'MUN', type: 'client', active: true };
const DEPENDENTS = {
  services: [
    { id: 's1', name: 'Monitoreo SIEM', code: 'NET-SIEM', detail: '124 entradas · 3 tickets', deletable: false },
    { id: 's2', name: 'Firewall perimetral', code: 'NET-FW', detail: 'Sin historial', deletable: true },
  ],
  teams: [{ id: 't1', name: 'SOC Acme', detail: '4 integrantes', deletable: true }],
  assets: [],
  tickets: [{ id: 'k1', number: '5799', title: 'Offense CRE', status: 'closed', createdAt: '2026-10-03T12:00:00Z' }],
  contacts: 2,
};

describe('Popup Eliminar organización (canvas v22)', () => {
  let httpMock: HttpTestingController;
  let closed: unknown;

  function render(data: Partial<OrgDeleteData> = {}) {
    closed = undefined;
    TestBed.configureTestingModule({
      imports: [OrgDeleteDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DIALOG_DATA, useValue: { org: ORG, dependents: DEPENDENTS, targets: [MUNDO], ...data } },
        { provide: DialogRef, useValue: { close: (v: unknown) => (closed = v) } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OrgDeleteDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rowOf = (name: string) => [...el.querySelectorAll('.od__row')].find((r) => r.textContent?.includes(name)) as HTMLElement;
    const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    const click = (b: HTMLElement) => {
      b.click();
      fixture.detectChanges();
    };
    const pickTarget = () => {
      const select = el.querySelector('select[name="target"]') as HTMLSelectElement;
      select.value = 'mun';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    return { fixture, el, rowOf, button, click, pickTarget };
  }

  it('lo pendiente bloquea; los tickets son opcionales y los contactos se quedan', () => {
    const { el } = render();
    expect(el.querySelector('.od__status')?.textContent).toContain('Faltan 3 por resolver');
    expect(el.textContent).toContain('Se queda en el histórico');
    expect(el.textContent).toContain('2 contacto(s) se quedan en el Directorio con su empresa «Acme»');
    const confirm = [...el.querySelectorAll('.od__foot button')].pop() as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('con historial no se elimina; mover, eliminar y renombrar arman el plan que se envía', () => {
    const { el, rowOf, button, click, pickTarget } = render();
    const siemDelete = rowOf('Monitoreo SIEM').querySelector('.adm-icon-btn--danger') as HTMLButtonElement;
    expect(siemDelete.disabled).toBe(true);

    pickTarget();
    click(button(rowOf('Monitoreo SIEM'), 'Mover a Mundo'));
    click(rowOf('Firewall perimetral').querySelector('.adm-icon-btn--danger') as HTMLElement);
    click(rowOf('SOC Acme').querySelector('[title="Editar nombre"]') as HTMLElement);
    const input = el.querySelector('input[name="editName"]') as HTMLInputElement;
    input.value = 'SOC Acme (antiguo)';
    input.dispatchEvent(new Event('input'));
    click(button(el, 'Guardar'));
    click(button(rowOf('SOC Acme (antiguo)'), 'Mover a Mundo'));

    expect(el.querySelector('.od__status')?.textContent).toContain('Listo');
    click([...el.querySelectorAll('.od__foot button')].pop() as HTMLElement);
    const req = httpMock.expectOne((r) => r.method === 'DELETE' && r.url === '/api/organizations/acm');
    expect(req.request.body).toEqual({
      actions: [
        { kind: 'team', id: 't1', op: 'rename', name: 'SOC Acme (antiguo)' },
        { kind: 'service', id: 's1', op: 'move', to: 'mun', name: 'Monitoreo SIEM' },
        { kind: 'service', id: 's2', op: 'delete' },
        { kind: 'team', id: 't1', op: 'move', to: 'mun', name: 'SOC Acme (antiguo)' },
      ],
    });
  });

  it('"Todo de una" manda la organización de destino y cierra al terminar', async () => {
    const { el, button, click, pickTarget } = render();
    pickTarget();
    click(button(el, 'Mover y eliminar'));
    const req = httpMock.expectOne((r) => r.method === 'DELETE');
    expect(req.request.body).toEqual({ actions: [], moveTo: 'mun' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await new Promise((resolve) => setTimeout(resolve));
    expect(closed).toBe(true);
  });
});
