import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminAgendaComponent } from './admin-agenda';
import { AgendaSettings } from '../../core/agenda/agenda.service';

/** Administración → Agenda (9.3): horario hábil y feriados. */
const SETTINGS: AgendaSettings = {
  workDays: [1, 2, 3, 4, 5], dayStart: '08:00', dayEnd: '20:00', timezone: 'America/Santiago', holidayCountry: 'CL',
  countries: [{ country: 'CL', name: 'Chile', years: [2026, 2027] }], importableYears: [2026, 2027], year: 2026, holidays: [],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Administración → Agenda', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminAgendaComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('importa los feriados del año y guarda el horario', async () => {
    const fixture = TestBed.createComponent(AdminAgendaComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/agenda/settings').flush({ data: SETTINGS });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Sin feriados cargados');

    button(el, 'Importar feriados de Chile 2026').click();
    const imp = httpMock.expectOne('/api/agenda/holidays/import');
    expect(imp.request.body).toEqual({ year: 2026 });
    imp.flush({ data: { ...SETTINGS, holidays: [{ date: '2026-10-31', name: 'Iglesias Evangélicas', source: 'import' }] } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Iglesias Evangélicas');
    expect(el.textContent).toContain('(cae en fin de semana)');

    // Sábado también hábil.
    const sat = [...el.querySelectorAll('.aa__days button')][5] as HTMLButtonElement;
    sat.click();
    fixture.detectChanges();
    button(el, 'Guardar horario').click();
    const put = httpMock.expectOne('/api/agenda/settings');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ workDays: [1, 2, 3, 4, 5, 6], dayStart: '08:00', dayEnd: '20:00' });
    put.flush({ data: { ...SETTINGS, workDays: [1, 2, 3, 4, 5, 6] } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado.');
  });
});
