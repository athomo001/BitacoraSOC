import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SHELL_NAV_ITEMS } from './shell-nav';

/**
 * Shell principal: 1 nivel de navegación vertical fijo (spec/06-frontend-
 * arquitectura-y-ui.md sección 3) — nunca "menú del submenú del menú".
 * Las pestañas contextuales horizontales de cada sección viven dentro de
 * cada feature, no acá.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  protected readonly navItems = SHELL_NAV_ITEMS;

  private readonly router = inject(Router);

  // Atajos de teclado globales — spec/06-frontend-arquitectura-y-ui.md sección 3.
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!event.altKey) {
      return;
    }
    const item = this.navItems.find((candidate) => candidate.shortcutDigit === event.key);
    if (item) {
      event.preventDefault();
      this.router.navigate(['/', item.path]);
    }
  }
}
