import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { ImportKind, ImportResult } from '../../core/imports/imports.service';
import { CsvImportDialogComponent } from './csv-import-dialog';

const REVIEW: ImportResult = {
  rows: [
    { line: 2, code: 'jperez', name: 'Juan Pérez', action: 'create', detail: 'usuario · SOC=N1' },
    { line: 3, code: 'x', name: '', action: 'error', error: 'el usuario va de 3 a 40 letras minúsculas, números, punto o guion' },
  ],
  created: 1, updated: 0, unchanged: 0, errors: 1, applied: false,
};

describe('Carga masiva por CSV (10g)', () => {
  let httpMock: HttpTestingController;
  let closed: unknown;

  async function render(kind: ImportKind, modules = { soc: true, noc: false }) {
    closed = undefined;
    TestBed.configureTestingModule({
      imports: [CsvImportDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DIALOG_DATA, useValue: { kind } },
        { provide: DialogRef, useValue: { close: (v: unknown) => (closed = v) } },
        { provide: ModuleAccessService, useValue: { load: async () => undefined, soc: signal(modules.soc), noc: signal(modules.noc) } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CsvImportDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const pick = async (csv: string) => {
      const file = new File([csv], 'archivo.csv', { type: 'text/csv' });
      const done = fixture.componentInstance['pick']({ target: { files: [file], value: '' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve));
      return done;
    };
    return { fixture, el, settle, pick };
  }

  afterEach(() => httpMock.verify());

  it('revisa, carga y muestra una sola vez las contraseñas temporales', async () => {
    const { el, settle, pick } = await render('users');
    expect(el.textContent).toContain('Exportar lo que hay');

    const picked = pick('usuario;nombre\njperez;Juan Pérez\n');
    await new Promise((resolve) => setTimeout(resolve));
    const review = httpMock.expectOne((r) => r.url === '/api/users/import' && r.params.get('dryRun') === 'true');
    expect(review.request.body).toContain('jperez;Juan Pérez');
    review.flush({ data: REVIEW });
    await picked;
    await settle();
    expect(el.querySelector('.ci__status')?.textContent).toContain('1 nuevo · 0 actualiza · 0 sin cambios · 1 no se carga');
    expect(el.querySelector('.ci__err')?.textContent).toContain('3 a 40 letras');

    const go = [...el.querySelectorAll('.ci__foot button')].pop() as HTMLButtonElement;
    go.click();
    const load = httpMock.expectOne((r) => r.url === '/api/users/import' && r.params.get('dryRun') === 'false');
    load.flush({ data: { ...REVIEW, applied: true, rows: [{ ...REVIEW.rows[0], secret: 'Ab3dEf7hJk9mNp' }, REVIEW.rows[1]] } });
    await settle();
    expect(el.querySelector('.ci__secret')?.textContent).toContain('Ab3dEf7hJk9mNp');
    expect(el.querySelector('.ci__secrets')?.textContent).toContain('no se vuelven a mostrar');
    expect(el.querySelector('.ci__status')?.textContent).toContain('Listo');

    (el.querySelector('.ci__icon-btn') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('sin nada que cargar el botón queda apagado y cerrar no pide recargar', async () => {
    const { el, settle, pick } = await render('organizations');
    const picked = pick('codigo\nX\n');
    await new Promise((resolve) => setTimeout(resolve));
    httpMock.expectOne((r) => r.url === '/api/organizations/import').flush({ data: { ...REVIEW, rows: [REVIEW.rows[1]], created: 0 } });
    await picked;
    await settle();
    expect(([...el.querySelectorAll('.ci__foot button')].pop() as HTMLButtonElement).disabled).toBe(true);
    (el.querySelector('.ci__icon-btn') as HTMLButtonElement).click();
    expect(closed).toBe(false);
  });

  it('solo ofrece los destinos y columnas de los módulos encendidos', async () => {
    const windows = await render('windows', { soc: false, noc: true });
    expect(windows.el.textContent).toContain('activo:srv-01, zona:RM');
    expect(windows.el.textContent).not.toContain('servicio:');
    expect(windows.el.textContent).not.toContain('Exportar lo que hay');
    TestBed.resetTestingModule();

    const orgs = await render('organizations', { soc: false, noc: false });
    expect(orgs.el.textContent).not.toContain('servicios:');
  });
});
