import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TeamQualityComponent } from './team-quality';
import { QualityPerson, QualityRule, QualityView } from '../../core/team/team.service';

/** Mi equipo → Calidad (10f, diseño aprobado 2026-10-22). */
const rule = (key: QualityRule['key'], o: Partial<QualityRule> = {}): QualityRule => ({ key, pct: 0, count: 0, of: 64, points: 0, flagged: false, ...o });

const person = (o: Partial<QualityPerson>): QualityPerson => ({
  id: 'p', name: '', level: 'N1', absence: null, entries: 0, shifts: 0, evaluated: false, score: 0, status: 'sin_evaluar', rules: [], ...o,
});

const VIEW: QualityView = {
  areaCode: 'soc', areaName: 'SOC', days: 30, from: '2026-09-23', to: '2026-10-22', minEntries: 10,
  people: [
    person({ id: 'ana', name: 'Ana Rojas', level: 'N2', entries: 142, shifts: 22, evaluated: true, score: 94, status: 'excelente',
      rules: [rule('copy', { pct: 2, points: -3 }), rule('vocabulary', { pct: 92, points: 9.2 })] }),
    person({ id: 'rodrigo', name: 'Rodrigo Reyes', entries: 64, shifts: 21, evaluated: true, score: 38, status: 'relleno', rules: [
      rule('copy', { pct: 14, count: 9, points: -21, examples: [{ text: 'Sin novedad en consola SIEM.', times: 7 }] }),
      rule('burst', { pct: 8, count: 5, points: -8 }),
      rule('short', { pct: 36, count: 23, points: -14.4, flagged: true, examples: [{ text: 'ok' }] }),
      rule('routine', { pct: 38.1, count: 8, of: 21, points: -25, flagged: true, examples: [{ at: '2026-10-02T23:00:00Z', shift: 'Noche' }] }),
      rule('vocabulary', { pct: 60, count: 38, points: 6 }),
    ] }),
    person({ id: 'pablo', name: 'Pablo Espinoza', level: 'N2', entries: 3, shifts: 2, absence: { kind: 'vacation', days: 12 } }),
    person({ id: 'camila', name: 'Camila Torres', entries: 6, shifts: 3 }),
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
const row = (el: HTMLElement, name: string) => [...el.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes(name)) as HTMLElement;

describe('Mi equipo → Calidad (10f)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TeamQualityComponent], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TeamQualityComponent);
    fixture.componentRef.setInput('area', 'soc');
    fixture.componentRef.setInput('areaName', 'SOC');
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/team/quality');
    expect(req.request.params.get('area')).toBe('soc');
    expect(req.request.params.get('days')).toBe('30');
    req.flush({ data: VIEW });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra las cifras, la lectura del equipo y una fila por persona', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Calidad de registro en SOC');
    expect(el.textContent).toContain('2 de 4');
    expect(el.textContent).toContain('Rodrigo Reyes queda bajo 75.');
    expect(el.textContent).toContain('En Rodrigo Reyes pesan «Turnos sin entradas propias» y «Copiar y pegar».');
    expect(el.textContent).toContain('Pablo Espinoza y Camila Torres no se evalúan este período.');
    expect(el.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(4);
    expect(row(el, 'Ana Rojas').textContent).toContain('Nada en particular');
    expect(row(el, 'Rodrigo Reyes').textContent).toContain('Sospecha de relleno');
    expect(row(el, 'Rodrigo Reyes').textContent).toContain('Turnos sin entradas propias, copiar y pegar');
    expect(row(el, 'Pablo Espinoza').textContent).toContain('Vacaciones, 12 días');
    expect(row(el, 'Camila Torres').textContent).toContain('Menos de 10 entradas');
  });

  it('abre primero a quien tiene el puntaje más bajo, con el desglose y ejemplos', async () => {
    const { el } = await render();
    const aside = el.querySelector('aside') as HTMLElement;
    expect(aside.textContent).toContain('Rodrigo Reyes');
    expect(aside.textContent).toContain('Cómo llega a 38');
    expect(aside.textContent).toContain('36 % de sus entradas, sobre el límite');
    expect(aside.textContent).toContain('−14,4');
    expect(aside.textContent).toContain('+6');
    expect(aside.textContent).toContain('«Sin novedad en consola SIEM.», 7 veces');
    expect(aside.textContent).toContain('En 8 de 21 turnos no hubo entradas propias');
    // Ráfagas baja 8: sale en el desglose, pero sin ejemplos (pesan las de 10 o más).
    const examples = [...aside.querySelectorAll('.qa__ev strong')].map((s) => s.textContent);
    expect(examples).toEqual(['Turnos sin entradas propias', 'Copiar y pegar', 'Entradas cortas']);
    const link = aside.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/entries?author=rodrigo&from=2026-09-23&to=2026-10-22');
  });

  it('a quien no se evalúa le explica por qué', async () => {
    const { fixture, el } = await render();
    row(el, 'Pablo Espinoza').click();
    fixture.detectChanges();
    expect(el.querySelector('aside')?.textContent).toContain('Vacaciones: 12 días en el período. Tiene 3 entradas en el período y se evalúa desde 10.');
  });

  it('elige un mes: parte en el anterior y se mueve con las flechas', async () => {
    const { fixture, el } = await render();
    const now = new Date();
    const ym = (back: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    (el.querySelector('.qa__month-label') as HTMLButtonElement).click();
    fixture.detectChanges();
    let req = http.expectOne((r) => r.url === '/api/team/quality');
    expect(req.request.params.get('month')).toBe(ym(1));
    expect(req.request.params.has('days')).toBe(false);
    req.flush({ data: { ...VIEW, days: 0, month: ym(1) } });
    await settle();
    (el.querySelector('[aria-label="Mes anterior"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    req = http.expectOne((r) => r.url === '/api/team/quality');
    expect(req.request.params.get('month')).toBe(ym(2));
    req.flush({ data: VIEW });
    await settle();
    button(el, '30 días').click();
    fixture.detectChanges();
    req = http.expectOne((r) => r.url === '/api/team/quality');
    expect(req.request.params.get('days')).toBe('30');
    req.flush({ data: VIEW });
  });

  it('cambia el período y muestra cómo se calcula', async () => {
    const { fixture, el } = await render();
    button(el, 'Cómo se calcula').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('1,5 por cada 1 %, hasta 40');
    expect(el.textContent).toContain('Se evalúa a quien tiene 10 entradas o más');
    button(el, '7 días').click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/team/quality');
    expect(req.request.params.get('days')).toBe('7');
    req.flush({ data: { ...VIEW, days: 7 } });
  });
});
