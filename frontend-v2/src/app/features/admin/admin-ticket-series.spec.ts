import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminTicketSeriesComponent } from './admin-ticket-series';
import { formatTicketNumber } from '../../core/tickets/ticket-series.service';

const STATE = {
  series: [{ id: 's1', name: 'General', prefix: 'TKT', yearFormat: 'yyyy', digits: 5, nextNumber: 3, isDefault: true, preview: 'TKT-2026-00003' }],
  areas: [
    { id: 'a1', code: 'soc', name: 'SOC', active: true },
    { id: 'a2', code: 'infra', name: 'Infra', active: true },
  ],
};

describe('AdminTicketSeriesComponent (numeración de tickets)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminTicketSeriesComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminTicketSeriesComponent);
    fixture.detectChanges();
    http.expectOne('/api/config/ticket-series').flush({ data: STATE });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('el formato del cliente es el mismo del servidor', () => {
    const now = new Date(2026, 9, 16);
    expect(formatTicketNumber('TKT', 'yyyy', 5, 42, now)).toBe('TKT-2026-00042');
    expect(formatTicketNumber('INF', 'none', 6, 42, now)).toBe('INF-000042');
    expect(formatTicketNumber('SOC', 'yy', 4, 42, now)).toBe('SOC-26-0042');
  });

  it('muestra la general con sus áreas y crea una nueva con vista previa', async () => {
    const { fixture, el } = await render();
    expect(el.textContent).toContain('TKT-2026-00003');
    expect(el.textContent).toContain('SOC, Infra');
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Nueva numeración')) as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const type = (name: string, value: string) => {
      const input = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('tsName', 'Infraestructura');
    type('tsPrefix', 'inf-1');
    fixture.detectChanges();
    ([...el.querySelectorAll('.ts__seg button')].find((b) => b.textContent?.includes('Sin año')) as HTMLButtonElement).click();
    type('tsDigits', '6');
    fixture.detectChanges();
    expect(el.querySelector('.ts__preview')?.textContent).toContain('INF1-000001');
    ([...el.querySelectorAll('.ts__actions button')].find((b) => b.textContent?.includes('Guardar')) as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'POST', url: '/api/config/ticket-series' });
    expect(req.request.body).toEqual({ name: 'Infraestructura', prefix: 'INF1', yearFormat: 'none', digits: 6, nextNumber: 1, isDefault: false });
    req.flush({ data: STATE });
  });

  it('cambiar la numeración de un área la guarda al momento', async () => {
    const { el } = await render();
    const select = el.querySelector('select[name="tsAreainfra"]') as HTMLSelectElement;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    const req = http.expectOne({ method: 'PUT', url: '/api/config/ticket-series/areas' });
    expect(req.request.body).toEqual({ assignments: [{ areaId: 'a2', seriesId: null }] });
    req.flush({ data: STATE });
  });
});
