import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { EscalationStepsComponent } from './escalation-steps';
import { Policy } from '../../core/escalation/escalation.service';

const policy = (): Policy => ({
  id: 'p1', serviceId: 's1', active: true,
  steps: [
    { id: 'st1', stepOrder: 1, title: '1er llamado', teamId: 'g1', teamName: '', ownPeople: true, mode: 'unique', waitBeforeEscalateMinutes: 10,
      members: [{ id: 'm1', kind: 'contact', refId: 'c1', name: 'Juan Pérez', channels: ['call', 'whatsapp'] }] },
    { id: 'st2', stepOrder: 2, title: 'Pool de Mundo', teamId: 'g2', teamName: '', ownPeople: true, mode: 'pool', waitBeforeEscalateMinutes: 15,
      members: [{ id: 'm2', kind: 'pool', refId: 'pool1', name: 'POOL de Mundo', channels: [] }] },
    { id: 'st3', stepOrder: 3, title: 'Guardia N2', teamId: 't9', teamName: 'Guardia N2', ownPeople: false, mode: 'sequential', waitBeforeEscalateMinutes: 0, members: [] },
  ],
});

describe('EscalationStepsComponent (llamados dentro de la política)', () => {
  let http: HttpTestingController;
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [EscalationStepsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(EscalationStepsComponent);
    fixture.componentRef.setInput('policy', policy());
    fixture.componentRef.setInput('teams', [{ id: 't9', name: 'Guardia N2', slug: 'n2', kind: 'oncall', audience: 'internal', active: true }]);
    fixture.componentRef.setInput('pools', [{ id: 'pool1', name: 'POOL de Mundo', active: true, members: 3, usedIn: 1 }]);
    const emitted: Policy[] = [];
    fixture.componentInstance.changed.subscribe((p) => emitted.push(p));
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
  }

  it('muestra cada llamado con sus personas, canales y el equipo real', async () => {
    const { fixture, el } = render();
    await fixture.whenStable();
    fixture.detectChanges();
    const cards = el.querySelectorAll('.st__card');
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('Juan Pérez');
    expect(cards[0].textContent).toContain('WhatsApp');
    expect(cards[1].textContent).toContain('pool');
    expect((cards[2].querySelector('select') as HTMLSelectElement).value).toBe('t9');
  });

  it('agregar una persona del Directorio guarda el llamado con ella al final', async () => {
    const { fixture, el, emitted } = render();
    ([...el.querySelectorAll('.st__card')[0].querySelectorAll('button')].find((b) => b.textContent?.includes('Persona del Directorio')) as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = el.querySelector('.st__menu input') as HTMLInputElement;
    input.value = 'ana';
    input.dispatchEvent(new Event('input'));
    await tick(300);
    http.expectOne((r) => r.url === '/api/directory/search').flush({ data: [{ id: 'c2', name: 'Ana Soto', organizationName: 'DPP' }] });
    await tick();
    fixture.detectChanges();
    (el.querySelector('.st__opt') as HTMLButtonElement).click();
    const req = http.expectOne('/api/escalation/policies/p1/steps/st1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ title: '1er llamado', mode: 'unique', waitBeforeEscalateMinutes: 10, contactIds: ['c1', 'c2'], userIds: [], poolIds: [] });
    req.flush({ data: policy() });
    await tick();
    expect(emitted.length).toBe(1);
  });

  it('quitar una persona y subir un llamado', async () => {
    const { el } = render();
    (el.querySelector('.st__x') as HTMLButtonElement).click();
    const put = http.expectOne('/api/escalation/policies/p1/steps/st1');
    expect(put.request.body.contactIds).toEqual([]);
    put.flush({ data: policy() });
    await tick();
    (el.querySelectorAll('.st__card')[2].querySelector('[aria-label="Subir llamado"]') as HTMLButtonElement).click();
    const reorder = http.expectOne('/api/escalation/policies/p1/steps/reorder');
    expect(reorder.request.body).toEqual({ stepIds: ['st1', 'st3', 'st2'] });
    reorder.flush({ data: policy() });
  });

  it('pasar de personas a un equipo manda teamId y no personas', async () => {
    const { el } = render();
    ([...el.querySelectorAll('.st__card')[0].querySelectorAll('.seg')].find((b) => b.textContent?.includes('Un equipo')) as HTMLButtonElement).click();
    const req = http.expectOne('/api/escalation/policies/p1/steps/st1');
    expect(req.request.body).toEqual({ title: '1er llamado', mode: 'unique', waitBeforeEscalateMinutes: 10, teamId: 't9' });
    req.flush({ data: policy() });
  });

  it('agregar llamado crea uno vacío al final y abre el buscador', async () => {
    const { fixture, el } = render();
    ([...el.querySelectorAll('.st__foot button')].find((b) => b.textContent?.includes('Agregar llamado')) as HTMLButtonElement).click();
    const req = http.expectOne('/api/escalation/policies/p1/steps');
    expect(req.request.body).toEqual({ title: '4º llamado', mode: 'unique', waitBeforeEscalateMinutes: 10, contactIds: [] });
    const updated = policy();
    updated.steps.push({ id: 'st4', stepOrder: 4, title: '4º llamado', teamId: 'g4', teamName: '', ownPeople: true, mode: 'unique', waitBeforeEscalateMinutes: 10, members: [] });
    req.flush({ data: updated });
    await tick();
    fixture.componentRef.setInput('policy', updated);
    fixture.detectChanges();
    expect(el.querySelector('.st__menu')).not.toBeNull();
    expect(el.querySelectorAll('.st__card')[3].textContent).toContain('Sin personas');
  });
});
