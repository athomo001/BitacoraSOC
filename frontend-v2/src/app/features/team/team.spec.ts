import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TeamComponent } from './team';
import { TeamArea, TeamView } from '../../core/team/team.service';

const week = (c: string) => ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((date) => ({ date, condition: c }));
const VIEW: TeamView = {
  area: { code: 'infra', name: 'Infraestructura' },
  stats: { people: 2, tickets: 6, breached: 2, away: 1 },
  groups: [{ id: 'g1', name: 'Infra N1', level: 'N1' }, { id: 'g2', name: 'Infra N2', level: 'N2' }],
  people: [
    { id: 'p1', username: 'dlagos', fullName: 'Diego Lagos', email: 'd@x.cl', active: true, editable: true, removable: true, groups: [{ id: 'g1', name: 'Infra N1' }], today: 'telework', week: week('telework') as never, tickets: 6, breached: 2 },
    { id: 'p2', username: 'preyes', fullName: 'Pablo Reyes', email: 'p@x.cl', active: true, editable: false, removable: false, groups: [{ id: 'g2', name: 'Infra N2' }], today: 'vacation', week: week('vacation') as never, tickets: 0, breached: 0 },
  ],
};

describe('TeamComponent (Mi equipo, jefatura de área, spec/16 9d)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TeamComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(areas: TeamArea[] = [{ code: 'infra', name: 'Infraestructura', lead: true }, { code: 'ti', name: 'TI', lead: true }]) {
    const fixture = TestBed.createComponent(TeamComponent);
    fixture.detectChanges();
    http.expectOne('/api/team/areas').flush({ data: areas });
    http.expectOne('/api/team/departments').flush({ data: [] });
    await settle();
    if (areas.length) {
      http.expectOne((r) => r.url === '/api/team' && r.params.get('area') === 'infra').flush({ data: VIEW });
      await settle();
      http.expectOne((r) => r.url === '/api/team/people/p1/tickets').flush({
        data: [{ id: 't1', number: 'TKT-2026-00071', title: 'Firmware switches', status: 'assigned', breached: true }],
      });
      await settle();
    }
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!;

  it('muestra las cifras, la gente con cómo está hoy y los tickets de la primera persona', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Ausentes hoy');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('tbody tr')?.textContent).toContain('Teletrabajo');
    expect(el.textContent).toContain('TKT-2026-00071');
    expect(el.textContent).toContain('Vencido');
    expect(el.querySelectorAll('.tm__day').length).toBe(5);
  });

  it('el auditor ve solo la Calidad de las áreas que usan la Bitácora (10f)', async () => {
    const fixture = TestBed.createComponent(TeamComponent);
    fixture.detectChanges();
    http.expectOne('/api/team/areas').flush({ data: [{ code: 'soc', name: 'SOC', lead: false, quality: true }] });
    http.expectOne('/api/team/departments').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    http.expectNone('/api/team');
    const req = http.expectOne((r) => r.url === '/api/team/quality');
    expect(req.request.params.get('area')).toBe('soc');
    req.flush({ data: { areaCode: 'soc', areaName: 'SOC', days: 30, from: '2026-09-23', to: '2026-10-22', minEntries: 10, people: [] } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = [...el.querySelectorAll('[role=tab]')].map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['fact_checkCalidad']);
    expect(el.textContent).toContain('Calidad de registro en SOC');
  });

  it('la jefatura del departamento lo ve completo, con las áreas de cada persona y solo para mirar', async () => {
    const fixture = TestBed.createComponent(TeamComponent);
    fixture.detectChanges();
    http.expectOne('/api/team/areas').flush({ data: [{ code: 'soc', name: 'SOC', lead: true, quality: true }] });
    http.expectOne('/api/team/departments').flush({ data: [{ id: 'd1', name: 'CDC', lead: true, quality: true, areas: [{ code: 'soc', name: 'SOC' }] }] });
    await settle();
    const req = http.expectOne((r) => r.url === '/api/team');
    expect(req.request.params.get('department')).toBe('d1');
    expect(req.request.params.has('area')).toBe(false);
    req.flush({ data: { ...VIEW, area: { code: '', name: 'CDC' }, groups: [], people: [{ ...VIEW.people[0], areas: ['SOC', 'NOC'], editable: false, removable: false }] } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('.seg')].some((b) => b.textContent?.includes('Departamento CDC'))).toBe(true);
    expect(el.textContent).toContain('Personas del departamento CDC');
    expect(el.querySelector('tbody tr')?.textContent).toContain('NOC');
    expect(el.textContent).toContain('Para agregar o cambiar a alguien, elige un área.');
    expect(button(el, 'Agregar persona')).toBeUndefined();
    expect(button(el, 'Escalamiento')).toBeUndefined();
    http.expectNone((r) => r.url.includes('/tickets'));
  });

  it('en el departamento, Guardias se configuran eligiendo una de sus áreas', async () => {
    const fixture = TestBed.createComponent(TeamComponent);
    fixture.detectChanges();
    http.expectOne('/api/team/areas').flush({ data: [] });
    http.expectOne('/api/team/departments').flush({
      data: [{ id: 'd1', name: 'CDC', lead: true, quality: false, areas: [{ code: 'soc', name: 'SOC', lead: true }, { code: 'noc', name: 'NOC', lead: true }] }],
    });
    await settle();
    http.expectOne((r) => r.url === '/api/team').flush({
      data: { ...VIEW, area: { code: '', name: 'CDC' }, groups: [], people: [
        { ...VIEW.people[0], areas: ['SOC'], editable: false, removable: false },
        { ...VIEW.people[1], areas: ['NOC'], editable: false, removable: false },
      ] },
    });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Guardias').click();
    fixture.detectChanges();
    await settle();
    expect(el.textContent).toContain('Área de la guardia');
    let guards = http.match((r) => r.url === '/api/guards');
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.every((r) => r.request.params.get('area') === 'soc')).toBe(true);

    button(el, 'NOC').click();
    fixture.detectChanges();
    await settle();
    guards = http.match((r) => r.url === '/api/guards');
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.every((r) => r.request.params.get('area') === 'noc')).toBe(true);
    // A la guardia de NOC solo se suma gente de NOC.
    const team = fixture.debugElement.query((d) => d.name === 'app-team-guards');
    expect((team.componentInstance as { people: () => { id: string }[] }).people().map((p) => p.id)).toEqual(['p2']);
  });

  it('sin áreas a cargo lo dice', async () => {
    const { el } = await render([]);
    expect(el.textContent).toContain('No eres jefatura');
  });

  it('cambiar el grupo va al servidor y recarga', async () => {
    const { el } = await render();
    button(el, 'Infra N2').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/team/people/p1/group' });
    expect(req.request.body).toEqual({ area: 'infra', groupId: 'g2' });
    req.flush(null);
    await settle();
    http.expectOne((r) => r.url === '/api/team').flush({ data: VIEW });
  });

  it('a quien no puede tocar no le ofrece cambiar grupo ni sacarlo del equipo', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('tbody tr')[1] as HTMLElement).click();
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('la gestiona el administrador');
    expect(button(el, 'Sacar del equipo')).toBeUndefined();
    expect(el.textContent).not.toContain('Dar de baja');
  });

  it('sacar del equipo pide confirmar y no da de baja la cuenta', async () => {
    const { fixture, el } = await render();
    button(el, 'Sacar del equipo').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('¿Sacar a Diego Lagos de Infraestructura? Su cuenta sigue activa');
    button(el.querySelector('.tm__confirm') as HTMLElement, 'Sacar del equipo').click();
    const req = http.expectOne({ method: 'DELETE', url: '/api/team/people/p1?area=infra' });
    req.flush(null);
  });

  it('agregar a alguien que ya existe: elige la cuenta y el grupo', async () => {
    const { fixture, el } = await render();
    button(el, 'Agregar persona').click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/team/candidates' && r.params.get('area') === 'infra')
      .flush({ data: [{ id: 'u7', username: 'rguajardo', name: 'Rafael Guajardo', areas: ['NOC'] }] });
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
    const select = el.querySelector<HTMLSelectElement>('select[name="candidate"]')!;
    expect(select.textContent).toContain('Rafael Guajardo (rguajardo), ya está en NOC');
    select.value = 'u7';
    select.dispatchEvent(new Event('change'));
    await settle();
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/team/people/u7/join' });
    expect(req.request.body).toEqual({ area: 'infra', groupId: 'g1' });
  });

  it('agregar persona nueva muestra la contraseña temporal una vez', async () => {
    const { fixture, el } = await render();
    button(el, 'Agregar persona').click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/team/candidates').flush({ data: [] });
    await settle();
    button(el, 'Persona nueva').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const fill = (name: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    fill('fullName', 'Rocío Fuentes');
    fill('username', 'rfuentes');
    fill('email', 'rfuentes@x.cl');
    await settle();
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/team/people' });
    expect(req.request.body).toEqual({ area: 'infra', fullName: 'Rocío Fuentes', username: 'rfuentes', email: 'rfuentes@x.cl', groupId: 'g1' });
    req.flush({ data: { id: 'p9', username: 'rfuentes', tempPassword: 'Abc23456789xyz' } });
    await settle();
    http.expectOne((r) => r.url === '/api/team').flush({ data: VIEW });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Abc23456789xyz');
    expect(el.textContent).toContain('no se vuelve a mostrar');
  });

  it('la pestaña Guardias trae solo las guardias del área', async () => {
    const { fixture, el } = await render();
    button(el, 'Guardias').click();
    fixture.detectChanges();
    await settle();
    const guards = http.match((r) => r.url === '/api/guards');
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.every((r) => r.request.params.get('area') === 'infra')).toBe(true);
    expect(el.querySelector('app-team-guards')).toBeTruthy();
  });

  it('la pestaña Escalamiento trae solo las políticas del área', async () => {
    const { fixture, el } = await render();
    button(el, 'Escalamiento').click();
    fixture.detectChanges();
    await settle();
    // Antes de las políticas, la pantalla lee la instalación y los permisos.
    for (const r of http.match((r) => r.url === '/api/setup/status')) r.flush({ data: { setupCompleted: true, socEnabled: true, nocEnabled: false } });
    for (const r of http.match((r) => r.url === '/api/users/me')) r.flush({ data: { id: 'me', username: 'jefe', role: 'user' } });
    for (const r of http.match((r) => r.url === '/api/users/me/capabilities')) r.flush({ data: { moduleScope: 'none', capabilities: ['area:lead'], areas: ['infra'] } });
    await settle();
    const policies = http.match((r) => r.url === '/api/escalation/policies');
    expect(policies.length).toBe(1);
    expect(policies[0].request.params.get('area')).toBe('infra');
  });
});
