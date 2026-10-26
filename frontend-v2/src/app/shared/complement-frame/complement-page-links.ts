import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ComplementsService, PageModule } from '../../core/complements/complements.service';

/**
 * Accesos a las páginas de complementos en un módulo sin pestañas
 * (Ticketera, Escalamiento; 10i). Cada uno abre /m/<módulo>/<slug>/<id>.
 * Sin páginas aprobadas no aparece nada.
 */
@Component({
  selector: 'app-complement-page-links',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of pages(); track p.slug + p.key) {
      <a class="adm-btn" [routerLink]="['/m', module(), p.slug, p.key.slice(5)]"><mat-icon>{{ p.icon }}</mat-icon>{{ p.title }}</a>
    }
  `,
  styles: `
    :host { display: contents; }
  `,
})
export class ComplementPageLinksComponent {
  private readonly complements = inject(ComplementsService);
  readonly module = input.required<PageModule>();
  protected readonly pages = computed(() => this.complements.slots().pages.filter((p) => p.module === this.module()));
}
