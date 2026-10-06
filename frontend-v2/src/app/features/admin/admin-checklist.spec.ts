import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminChecklistComponent } from './admin-checklist';

const SHIFTS = [
  { id: 'dia', name: 'Turno Día', startTime: '08:00:00', endTime: '20:00:00', timezone: 'x', shiftType: 'regular', emailRecipients: [], active: true, checklistTemplateStartId: 'otra', checklistTemplateEndId: 'noc' },
];
const NOC = {
  id: 'noc', name: 'NOC Diaria', isActive: true, alertNokEnabled: false, alertNokCargos: [], checksCount: 12,
  assignments: [{ workShiftId: 'dia', moment: 'cierre' }],
  items: [
    { id: 'i1', title: 'Internet', itemOrder: 0 },
    { id: 'i2', parentItemId: 'i1', title: 'Troncal', itemOrder: 1 },
  ],
};
const OTRA = { id: 'otra', name: 'SOC Semana', isActive: true, alertNokEnabled: false, alertNokCargos: [], checksCount: 0, assignments: [{ workShiftId: 'dia', moment: 'inicio' }], items: [{ id: 'o1', title: 'EDR', itemOrder: 0 }] };

describe('AdminChecklistComponent', () => {
  let httpMock: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminChecklistComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminChecklistComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/checklist-templates').flush({ data: [NOC, OTRA] });
    httpMock.expectOne((r) => r.url === '/api/work-shifts').flush({ data: SHIFTS });
    httpMock.expectOne('/api/config/checklist').flush({ data: { cooldownMinutes: 60 } });
    httpMock.expectOne('/api/users/cargos').flush({ data: [{ cargo: 'N1', people: 3 }, { cargo: 'N2', people: 2 }] });
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text) || b.getAttribute('aria-label') === text) as HTMLButtonElement;
    return { fixture, el, button };
  }

  it('lista plantillas con sus ítems y turnos, y una con historial no se puede borrar', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('NOC Diaria');
    expect(el.textContent).toContain('1 ítems · Turno Día'); // el grupo "Internet" no cuenta: se calcula
    expect(el.textContent).toContain('12 checks · no se borra');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Borrar')).toBe(false);
    const inputs = [...el.querySelectorAll<HTMLInputElement>('.ac-row__title')];
    expect(inputs.map((i) => i.value)).toEqual(['Internet', 'Troncal']);
    expect(el.textContent).toContain('se calcula de 1');
  });

  it('agrega un sub-ítem, asigna el inicio del turno y guarda el árbol completo', async () => {
    const { fixture, el, button } = await render();
    expect(button('Guardar plantilla').disabled).toBe(true);

    ([...el.querySelectorAll<HTMLButtonElement>('button[aria-label="Agregar sub-ítem"]')][0]).click();
    fixture.detectChanges();
    await settle();
    const inputs = [...el.querySelectorAll<HTMLInputElement>('.ac-row__title')];
    expect(inputs.length).toBe(3);
    expect(el.textContent).toContain('Hay un ítem sin nombre.');
    inputs[2].value = 'Backup';
    inputs[2].dispatchEvent(new Event('input'));
    // El inicio del Turno Día lo usa hoy "SOC Semana": marcarlo acá la reemplaza.
    button('Turno Día · Inicio').click();
    fixture.detectChanges();
    await settle();

    button('Guardar plantilla').click();
    await settle();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/checklist-templates/noc' });
    expect(req.request.body.items).toEqual([
      { key: 'i1', parentKey: '', title: 'Internet' },
      { key: 'i2', parentKey: 'i1', title: 'Troncal' },
      { key: expect.stringMatching(/^new-/), parentKey: 'i1', title: 'Backup' },
    ]);
    expect(req.request.body.assignments).toEqual([{ workShiftId: 'dia', moment: 'cierre' }, { workShiftId: 'dia', moment: 'inicio' }]);
    req.flush({ data: NOC });
    await settle();
    httpMock.expectOne('/api/checklist-templates').flush({ data: [NOC, OTRA] });
    httpMock.expectOne((r) => r.url === '/api/work-shifts').flush({ data: SHIFTS });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado');
  });

  it('la alerta NOK avisa por cargo (N2 por defecto, como el legacy) y muestra a cuántas personas llega', async () => {
    const { fixture, el } = await render();
    const alert = [...el.querySelectorAll<HTMLInputElement>('input[role="switch"]')][1];
    alert.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Personas con esos cargos: 2');
    const n1 = [...el.querySelectorAll<HTMLButtonElement>('.ac__cargo')].find((b) => b.textContent?.includes('N1')) as HTMLButtonElement;
    expect(n1.getAttribute('aria-pressed')).toBe('false');
    n1.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Personas con esos cargos: 5');
  });

  it('guarda la espera mínima entre checks', async () => {
    const { fixture, el, button } = await render();
    const input = el.querySelector('#ac-cooldown') as HTMLInputElement;
    input.value = '90';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle();
    button('Guardar').click();
    await settle();
    const req = httpMock.expectOne({ method: 'PUT', url: '/api/config/checklist' });
    expect(req.request.body).toEqual({ cooldownMinutes: 90 });
  });
});
