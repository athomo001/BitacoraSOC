import { Injector } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ImportKind } from '../../core/imports/imports.service';

/**
 * Abre el diálogo de carga por CSV (10g). CDK Dialog y el diálogo se cargan
 * recién aquí. Devuelve `true` si se cargó algo (la pantalla recarga).
 */
export async function openCsvImport(injector: Injector, kind: ImportKind): Promise<boolean> {
  const [{ Dialog }, { CsvImportDialogComponent }] = await Promise.all([import('@angular/cdk/dialog'), import('./csv-import-dialog')]);
  // disableClose: Esc pasa por close() del diálogo, que dice si se cargó algo.
  const ref = injector.get(Dialog).open<boolean>(CsvImportDialogComponent, { data: { kind }, maxWidth: '100vw', disableClose: true });
  return (await firstValueFrom(ref.closed)) === true;
}
