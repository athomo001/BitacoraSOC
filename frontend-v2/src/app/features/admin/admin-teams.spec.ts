import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import { AdminTeamsComponent } from './admin-teams';
import { TeamSummary } from '../../core/organizations/organizations.service';

const team = (id: string, name: string, org: string | null, kind: string, extra: Partial<TeamSummary> = {}): TeamSummary => ({
  id, name, slug: id, kind, audience: 'client', active: true, memberCount: 2,
  ...(org ? { organizationId: `o-${org}`, organizationName: org } : {}),
  organizationActive: true, usage: { steps: '', raci: 0, guards: 0, tickets: 0 }, ...extra,
});

const TEAMS = [
  team('t1', 'DPP · avisos preventivos', 'DPP', 'escalation'),
  team('t2', 'QRADAR · DPP', 'DPP', 'escalation', { usage: { steps: 'QRadar · DPP #1', raci: 0, guards: 0, tickets: 2 } }),
  team('t3', 'Guardia N2', null, 'oncall', { usage: { steps: '', raci: 0, guards: 40, tickets: 0 } }),
  team('t4', 'CiberVigilancia · Gnl', 'Gnlquinteros', 'escalation', { organizationActive: false, active: false, deactivatedByOrg: true }),
];

describe('AdminTeamsComponent (lista agrupada y acciones en lote)', () => {
  let http: HttpTestingController;
  let dialogResult: string | undefined;
  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    dialogResult = undefined;
    TestBed.configureTestingModule({
      imports: [AdminTeamsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Dialog, useValue: { open: () => ({ closed: of(dialogResult) }) } }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminTeamsComponent);
    fixture.detectChanges();
    http.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, socEnabled: true, nocEnabled: false } });
    await tick();
    http.match('/api/escalation/pools').forEach((r) => r.flush({ data: [] }));
    http.expectOne('/api/teams').flush({ data: TEAMS });
    http.expectOne((r) => r.url === '/api/organizations').flush({ data: [] });
    await tick();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('agrupa por organización, dice qué usa cada equipo y oculta las desactivadas', async () => {
    const { fixture, el } = await render();
    const heads = [...el.querySelectorAll('.tm__group-head strong')].map((h) => h.textContent);
    expect(heads).toEqual(['DPP', 'Sin organización']);
    expect(el.textContent).toContain('Lo usa: QRadar · DPP #1 · 2 tickets');
    expect(el.textContent).toContain('Sin uso');
    expect(el.textContent).not.toContain('Gnl');
    (el.querySelector('.tm__check input') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('organización desactivada');
  });

  it('seleccionar un grupo y desactivar en lote', async () => {
    const { fixture, el } = await render();
    (el.querySelector('.tm__group-head input') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.tm__bulk')?.textContent).toContain('2 seleccionados');
    ([...el.querySelectorAll('.tm__bulk button')].find((b) => b.textContent?.includes('Desactivar')) as HTMLButtonElement).click();
    await tick();
    const req = http.expectOne('/api/teams/bulk');
    expect(req.request.body).toEqual({ ids: ['t1', 't2'], action: 'deactivate' });
    req.flush({ data: { updated: 2 } });
    await tick();
    http.expectOne('/api/teams').flush({ data: TEAMS });
  });

  it('borrar pasa por el aviso y, si se confirma, borra en lote', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('.tm__row > input')[1] as HTMLInputElement).click();
    fixture.detectChanges();
    dialogResult = 'delete';
    ([...el.querySelectorAll('.tm__bulk button')].find((b) => b.textContent?.includes('Borrar')) as HTMLButtonElement).click();
    await tick();
    const req = http.expectOne('/api/teams/bulk');
    expect(req.request.body).toEqual({ ids: ['t2'], action: 'delete' });
    req.flush({ data: { deleted: 1 } });
    await tick();
    http.expectOne('/api/teams').flush({ data: TEAMS.filter((t) => t.id !== 't2') });
  });

  it('cancelar el aviso no borra nada', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('.tm__row > input')[0] as HTMLInputElement).click();
    fixture.detectChanges();
    ([...el.querySelectorAll('.tm__bulk button')].find((b) => b.textContent?.includes('Borrar')) as HTMLButtonElement).click();
    await tick();
    http.expectNone('/api/teams/bulk');
  });
});
