import { TestBed } from '@angular/core/testing';
import { DialogRef } from '@angular/cdk/dialog';
import { MarkdownHelpDialogComponent, appendSnippet } from './markdown-help-dialog';

describe('Guía de formato (Markdown)', () => {
  it('cada fila muestra lo que escribes y cómo se ve; tocarla la lleva a "Pruébalo" y "Agregar" la devuelve', async () => {
    let closed: unknown;
    TestBed.configureTestingModule({
      imports: [MarkdownHelpDialogComponent],
      providers: [{ provide: DialogRef, useValue: { close: (v: unknown) => (closed = v) } }],
    });
    const fixture = TestBed.createComponent(MarkdownHelpDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const todo = [...el.querySelectorAll<HTMLButtonElement>('.mh__row')].find((b) => b.textContent?.includes('- [ ] Revisar logs'))!;
    expect(todo.querySelector('input[type="checkbox"]')).not.toBeNull(); // se ve como tarea real
    todo.click();
    fixture.detectChanges();
    await fixture.whenStable(); // ngModel escribe el valor en el siguiente ciclo
    fixture.detectChanges();
    expect((el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('- [ ] Revisar logs\n- [x] Escalar a N2');
    (el.querySelector('.mh__insert') as HTMLButtonElement).click();
    expect(closed).toBe('- [ ] Revisar logs\n- [x] Escalar a N2');
  });

  it('suma el fragmento en su propia línea al final de lo escrito', () => {
    expect(appendSnippet('', '**x**')).toBe('**x**');
    expect(appendSnippet('Ofensa DPP\n\n', '**x**')).toBe('Ofensa DPP\n**x**');
  });
});
