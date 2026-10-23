import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { GoalDialogComponent, GoalDialogData } from './goal-dialog';
import { MgmtMeta } from '../../core/management/management.service';

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Nueva meta para una persona', () => {
  let http: HttpTestingController;
  let closed: unknown;

  function render(meta: Partial<MgmtMeta>) {
    const data: GoalDialogData = {
      meta: { slaTarget: 95, me: 'u-adm', admin: false, gestion: false, leadAreas: [], csms: [], people: [], areas: [], ...meta },
      clients: [], areas: [], preset: { scope: 'person' },
    };
    TestBed.configureTestingModule({
      imports: [GoalDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: DIALOG_DATA, useValue: data }, { provide: DialogRef, useValue: { close: (v: unknown) => (closed = v) } }],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(GoalDialogComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: HTMLElement, name: string, value: string) {
    const input = el.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
  }

  it('el admin ve también a quien no tiene área y puede registrar a alguien sin cuenta', async () => {
    const { fixture, el } = render({ admin: true, people: [{ id: 'u-pedro', name: 'Pedro Soto', areaId: null, areaName: '' }] });
    const options = [...el.querySelectorAll<HTMLOptionElement>('select[name="gPerson"] option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Pedro Soto (sin área)', 'Alguien sin cuenta…']);

    type(el, 'gPerson', '__external');
    fixture.detectChanges();
    type(el, 'gExtName', ' Ana Rojas ');
    type(el, 'gExtEmail', 'ana.rojas');
    type(el, 'gName', 'Certificación ITIL');
    type(el, 'gDate', '2026-12-15');
    fixture.detectChanges();
    const create = () => [...el.querySelectorAll<HTMLButtonElement>('app-button button')].find((b) => b.textContent?.includes('Crear meta'))!;
    expect(create().disabled).toBe(true);
    type(el, 'gExtEmail', 'ana.rojas@cliente.cl');
    fixture.detectChanges();
    expect(create().disabled).toBe(false);
    create().click();
    const req = http.expectOne('/api/goals');
    expect(req.request.body).toMatchObject({ scope: 'person', personName: 'Ana Rojas', personEmail: 'ana.rojas@cliente.cl', kind: 'certification' });
    expect(req.request.body.personId).toBeUndefined();
    req.flush({ data: { id: 'g1' } });
    await settle();
    expect(closed).toEqual({ id: 'g1' });
  });

  it('sin ser jefatura ni admin no hay a quién ponerle una meta', () => {
    const { el } = render({});
    expect(el.querySelector('select[name="gPerson"]')).toBeNull();
    expect(el.textContent).toContain('Las metas de una persona las pone la jefatura de su área o el admin.');
  });
});
