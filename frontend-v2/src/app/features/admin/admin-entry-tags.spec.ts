import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminEntryTagsComponent } from './admin-entry-tags';

/** Administración → Etiquetas (paridad con el legacy, 2026-10-16). */
const TAGS = [
  { tag: 'siem', uses: 40, lastUsed: '2026-10-15T12:00:00Z' },
  { tag: 'SIEM', uses: 7, lastUsed: '2026-09-01T12:00:00Z' },
  { tag: 'otdr', uses: 3, lastUsed: '2026-10-01T12:00:00Z' },
];
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Administración → Etiquetas', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminEntryTagsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminEntryTagsComponent);
    fixture.detectChanges();
    http.expectOne('/api/admin/entry-tags').flush({ data: TAGS });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renombrar a una que existe avisa que se juntan y va al servidor', async () => {
    const { fixture, el } = await render();
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
    const rows = el.querySelectorAll('tbody tr');
    (rows[1].querySelector('button[aria-label="Renombrar"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = el.querySelector('input[name="tagNewName"]') as HTMLInputElement;
    input.value = 'siem';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Ya existe «siem»');
    (el.querySelector('.tg__actions .adm-btn--primary') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'POST', url: '/api/admin/entry-tags/rename' });
    expect(req.request.body).toEqual({ from: 'SIEM', to: 'siem' });
    req.flush({ data: { entries: 7 } });
    await settle();
    http.expectOne('/api/admin/entry-tags').flush({ data: [TAGS[0], TAGS[2]] });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('7 entradas actualizadas');
  });

  it('borrar pide confirmar y se puede buscar', async () => {
    const { fixture, el } = await render();
    const search = el.querySelector('input[name="tagSearch"]') as HTMLInputElement;
    search.value = 'otd';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    (el.querySelector('tbody tr button[aria-label="Borrar"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('¿Quitarla de 3 entradas?');
    (el.querySelector('.tg__actions .adm-btn--danger') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'POST', url: '/api/admin/entry-tags/delete' });
    expect(req.request.body).toEqual({ tag: 'otdr' });
    req.flush({ data: { entries: 3 } });
  });
});
