import { ChangeDetectionStrategy, Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SHELL_NAV_ITEMS } from './shell-nav';
import { AuthService } from '../core/auth/auth.service';
import { SystemFeaturesService } from '../core/system-features/system-features.service';

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
export class ShellComponent implements OnInit {
  protected readonly navItems = signal(SHELL_NAV_ITEMS.filter((item) => item.path !== 'tickets'));
  protected readonly auth = inject(AuthService);
  private readonly systemFeatures = inject(SystemFeaturesService);

  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    try {
      const features = await this.systemFeatures.list();
      if (features.some((feature) => feature.code === 'native_tickets' && feature.isEnabled)) {
        this.navItems.set([...SHELL_NAV_ITEMS]);
      }
    } catch {
      // Keep the core navigation available if the feature catalog is unavailable.
    }
  }

  // Atajos de teclado globales — spec/06-frontend-arquitectura-y-ui.md sección 3.
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!event.altKey) {
      return;
    }
    const item = this.navItems().find((candidate) => candidate.shortcutDigit === event.key);
    if (item) {
      event.preventDefault();
      this.router.navigate(['/', item.path]);
    }
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
