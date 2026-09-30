import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminBackupsComponent } from './admin-backups';

const CONFIG = {
  enabled: true, intervalDays: 1, runAt: '03:00', timezone: 'America/Santiago', retentionDays: 30, destinationType: 'local',
  destinationPath: null, passphraseSet: true, nextRunAt: '2026-09-28T06:00:00Z', lastRunAt: '2026-09-27T06:00:00Z', lastStatus: 'success', lastMessage: 'Copia de 184212 registros (4.2 MB)',
};
const UPLOADED_NO_PASS = { id: 'u1', kind: 'full', triggerSource: 'upload', status: 'success', startedAt: '2026-09-28T10:00:00Z', finishedAt: null, recordsCount: 23633, fileSizeBytes: 1742838, checksumSha256: 'aa00000000000001', errorMessage: null, needsPassphrase: false };

const RUNS = [
  { id: 'a1', kind: 'full', triggerSource: 'auto', status: 'success', startedAt: '2026-09-27T06:00:00Z', finishedAt: null, recordsCount: 184212, fileSizeBytes: 4404019, checksumSha256: '8f3a00000000c21e', errorMessage: null, needsPassphrase: true },
  { id: 'd1', kind: 'delta', triggerSource: 'manual', status: 'success', startedAt: '2026-09-26T11:00:00Z', finishedAt: null, recordsCount: 1214, fileSizeBytes: 98304, checksumSha256: 'c44e00000000a017', errorMessage: null },
];

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('AdminBackupsComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminBackupsComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(purgeAllowed = false, runs: unknown[] = RUNS) {
    const fixture = TestBed.createComponent(AdminBackupsComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/backups/history').flush({ data: { items: runs } });
    httpMock.expectOne('/api/backups/config').flush({ data: CONFIG });
    httpMock.expectOne('/api/system-features').flush({ data: [{ code: 'allow_purge', isEnabled: purgeAllowed }] });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('muestra el historial con tipo, tamaño y registros legibles', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('.bk__group');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Automático');
    expect(rows[0].textContent).toContain('4,2 MB');
    expect(rows[0].textContent).toContain('184.212');
    expect(rows[1].textContent).toContain('Delta');
    expect(el.querySelector('.bk__status')?.textContent).toContain('Última copia OK');
  });

  it('un delta no se restaura desde el historial (se usa Importar delta)', async () => {
    const { el } = await render();
    const restoreButtons = el.querySelectorAll<HTMLButtonElement>('.bk__icon--accent');
    expect(restoreButtons[0].disabled).toBe(false);
    expect(restoreButtons[1].disabled).toBe(true);
  });

  it('"Reemplazar todo" exige escribir RESTAURAR antes de enviar', async () => {
    const { fixture, el } = await render();
    [...el.querySelectorAll<HTMLButtonElement>('.bk__mode .seg')].find((b) => b.textContent?.includes('Reemplazar'))?.click();
    (el.querySelector('.bk__icon--accent') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle(); // ngModel carga su valor inicial en una microtarea
    fixture.detectChanges();
    type(el, 'input[name="rowPassphrase"]', 'frase-larga-123');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const submit = () => el.querySelector('.bk__panel button[type="submit"]') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    type(el, 'input[name="rowConfirmation"]', 'RESTAURAR');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(submit().disabled).toBe(false);
    submit().click();
    const req = httpMock.expectOne({ method: 'POST', url: '/api/backups/a1/restore' });
    expect(req.request.body).toEqual({ passphrase: 'frase-larga-123', mode: 'replace', confirmation: 'RESTAURAR' });
  });

  it('una copia sin frase se restaura sin pedirla', async () => {
    const { fixture, el } = await render(false, [UPLOADED_NO_PASS]);
    (el.querySelector('.bk__icon--accent') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('input[name="rowPassphrase"]')).toBeNull();
    const submit = el.querySelector('.bk__panel button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();
    const req = httpMock.expectOne({ method: 'POST', url: '/api/backups/u1/restore' });
    expect(req.request.body.passphrase).toBe('');
  });

  it('sin "Permitir purga" la zona de peligro solo ofrece ir a Funcionalidades', async () => {
    const { el } = await render(false);
    const danger = el.querySelector('.bk__card--danger') as HTMLElement;
    expect(danger.textContent).toContain('Ir a Funcionalidades');
    expect(danger.querySelector('input[name="purgePhrase"]')).toBeNull();
  });

  it('con "Permitir purga" el botón se habilita solo con la frase exacta', async () => {
    const { fixture, el } = await render(true);
    const button = () => [...el.querySelectorAll<HTMLButtonElement>('.bk__card--danger button')].at(-1) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    type(el, 'input[name="purgePhrase"]', 'purgar todo');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    type(el, 'input[name="purgePhrase"]', 'PURGAR TODO');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
  });
});
