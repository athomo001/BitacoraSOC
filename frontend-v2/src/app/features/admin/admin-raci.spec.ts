import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminRaciComponent } from './admin-raci';
import { RaciActivity } from '../../core/raci/raci.service';

/** Administración → RACI (paridad con «Matriz RACI por Cliente» del legacy, 2026-10-20). */
const team = (id: string, name: string) => ({ id, name, kind: 'raci', members: [{ name, channels: [] }] });
const ACTIVITY: RaciActivity = {
  id: 'a1', clientId: 'c1', clientName: 'Casinos', topic: 'Monitoreo CDC', activity: 'Escalamiento de alertas', notes: '',
  letters: { responsible: [team('t1', 'Lista CDC')], accountable: [team('t2', 'Ana Pérez')], consulted: [], informed: [] },
};
const CLIENTS = [{ id: 'c1', name: 'Casinos', code: 'cas', type: 'client', active: true }];
const TEAMS = [
  { id: 't1', name: 'Lista CDC', slug: 'lista-cdc', kind: 'raci', audience: 'client', active: true },
  { id: 'g1', name: 'Guardia SOC N2', slug: 'guardia-n2', kind: 'oncall', audience: 'internal', active: true },
];
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Administración → RACI', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminRaciComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminRaciComponent);
    fixture.detectChanges();
    http.expectOne('/api/raci').flush({ data: [ACTIVITY] });
    http.expectOne((r) => r.url === '/api/organizations').flush({ data: CLIENTS });
    http.expectOne('/api/teams').flush({ data: TEAMS });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = (name: string, value: string) => {
      const input = el.querySelector(`[name="${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, el, type };
  }

  it('crea una actividad: pide responsable y un solo aprobador, y el aprobador puede ser alguien del directorio', async () => {
    const { fixture, el, type } = await render();
    (el.querySelector('.adm-head .adm-btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('raciTopic', 'Monitoreo CDC');
    type('raciActivity', 'Monitoreo de alertas');
    type('raciNotes', 'Después de las 17 h, grupo de WhatsApp');
    expect(el.textContent).toContain('Falta quién es responsable (R).');
    const save = () => el.querySelector('.ra__form .adm-row .adm-btn--primary') as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    // R: una guardia que ya existe.
    (el.querySelector('button[data-add="responsible"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('raciWho', 'guardia');
    http.expectOne((r) => r.url === '/api/directory/search').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    const guard = [...el.querySelectorAll('.ra__opt')].find((b) => b.textContent?.includes('Guardia SOC N2')) as HTMLButtonElement;
    guard.click();
    fixture.detectChanges();

    // A: una persona del directorio, que se vuelve su equipo «raci».
    (el.querySelector('button[data-add="accountable"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('raciWho', 'ana');
    http.expectOne((r) => r.url === '/api/directory/search').flush({ data: [{ id: 'k1', name: 'Ana Pérez', organizationName: 'Casinos' }] });
    await settle();
    fixture.detectChanges();
    const ana = [...el.querySelectorAll('.ra__opt')].find((b) => b.textContent?.includes('Ana Pérez')) as HTMLButtonElement;
    ana.click();
    const person = http.expectOne({ method: 'POST', url: '/api/raci/people' });
    expect(person.request.body).toEqual({ contactId: 'k1' });
    person.flush({ data: { id: 't2', name: 'Ana Pérez', kind: 'raci' } });
    await settle();
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Falta quién es responsable');
    expect(save().disabled).toBe(false);
    save().click();
    const req = http.expectOne({ method: 'POST', url: '/api/raci' });
    expect(req.request.body).toEqual({ clientId: 'c1', topic: 'Monitoreo CDC', activity: 'Monitoreo de alertas', notes: 'Después de las 17 h, grupo de WhatsApp',
      responsible: ['g1'], accountable: ['t2'], consulted: [], informed: [] });
    req.flush({ data: ACTIVITY });
    await settle();
    http.expectOne('/api/raci').flush({ data: [ACTIVITY] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Actividad guardada.');
  });

  it('eliminar pide confirmar', async () => {
    const { fixture, el } = await render();
    (el.querySelector('button[aria-label="Eliminar"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('¿Eliminar «Escalamiento de alertas»?');
    (el.querySelector('.ra__confirm .adm-btn--danger') as HTMLButtonElement).click();
    http.expectOne({ method: 'DELETE', url: '/api/raci/a1' }).flush(null);
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Actividad eliminada.');
    expect(el.textContent).not.toContain('Escalamiento de alertas');
  });
});
