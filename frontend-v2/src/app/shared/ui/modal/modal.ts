import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';

/**
 * Chrome visual del modal (header + slot de contenido + botón de cierre)
 * sobre Angular CDK Dialog — CDK, no Material Dialog directo, porque acá
 * solo hace falta overlay/focus-trap/ESC real (lo que Material Dialog
 * también usa por debajo), sin arrastrar los estilos M3 propios de
 * MatDialog que habría que volver a pisar con nuestros tokens.
 * Uso: `inject(Dialog).open(ModalComponent, { data: {...} })` desde un
 * feature — nunca `<app-modal>` anidado a mano en un template (un diálogo
 * es, por definición, contenido fuera del flujo normal del árbol).
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-modal">
      <header class="app-modal__header">
        <ng-content select="[app-modal-title]" />
        <button
          type="button"
          class="app-modal__close"
          aria-label="Cerrar"
          (click)="dialogRef?.close()"
        >
          <mat-icon>close</mat-icon>
        </button>
      </header>
      <div class="app-modal__body">
        <ng-content />
      </div>
      <footer class="app-modal__footer">
        <ng-content select="[app-modal-actions]" />
      </footer>
    </div>
  `,
  styleUrl: './modal.css',
})
export class ModalComponent {
  // Opcional: null en tests donde no se abre vía Dialog real.
  protected readonly dialogRef = inject(DialogRef<unknown, ModalComponent>, { optional: true });
}
