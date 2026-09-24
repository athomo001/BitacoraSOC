import { ChangeDetectionStrategy, Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SHELL_NAV_ITEMS } from './shell-nav';
import { AuthService } from '../core/auth/auth.service';
import { SystemFeaturesService } from '../core/system-features/system-features.service';
import { LOGIN_THEMES, LoginTheme } from '../features/login/login.component';

const LOGIN_THEME_STORAGE_KEY = 'preferredLoginTheme';

/**
 * Shell principal: 1 nivel de navegación vertical fijo (spec/06-frontend-
 * arquitectura-y-ui.md sección 3) — nunca "menú del submenú del menú".
 * Las pestañas contextuales horizontales de cada sección viven dentro de
 * cada feature, no acá.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, FormsModule],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnInit {
  protected readonly navItems = signal(SHELL_NAV_ITEMS.filter((item) => item.path !== 'tickets'));
  protected readonly auth = inject(AuthService);
  private readonly systemFeatures = inject(SystemFeaturesService);
  protected readonly language = signal<'es' | 'en'>((localStorage.getItem('bitacora.language') as 'es' | 'en') || 'es');
  protected readonly theme = signal<'dark' | 'light' | 'pink'>((localStorage.getItem('bitacora.theme') as 'dark' | 'light' | 'pink') || 'dark');
  protected readonly loginTheme = signal<LoginTheme>(this.readLoginTheme());
  protected readonly profileOpen = signal(false);
  protected currentPassword = '';
  protected newPassword = '';
  protected fullName = '';
  protected phone = '';
  protected birthday = '';
  protected avatarUrl = '';
  protected profileMessage = signal<string | null>(null);

  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    document.documentElement.dataset['theme'] = this.theme();
    const user = this.auth.user();
    if (user) {
      this.fullName = user.fullName ?? '';
      this.phone = user.phone ?? '';
      this.birthday = user.birthday ?? '';
      this.avatarUrl = user.avatarUrl ?? '';
    }
    try {
      const features = await this.systemFeatures.list();
      if (features.some((feature) => feature.code === 'native_tickets' && feature.isEnabled)) {
        this.navItems.set([...SHELL_NAV_ITEMS]);
      }
    } catch {
      // Keep the core navigation available if the feature catalog is unavailable.
    }
  }

  protected setLanguage(event: Event): void { const value = (event.target as HTMLSelectElement).value === 'en' ? 'en' : 'es'; this.language.set(value); localStorage.setItem('bitacora.language', value); }
  protected setTheme(theme: 'dark' | 'light' | 'pink'): void { this.theme.set(theme); localStorage.setItem('bitacora.theme', theme); document.documentElement.dataset['theme'] = theme; }
  protected setLoginTheme(theme: LoginTheme): void { this.loginTheme.set(theme); localStorage.setItem(LOGIN_THEME_STORAGE_KEY, theme); }
  protected async savePassword(): Promise<void> { this.profileMessage.set(null); try { await this.auth.changePassword(this.currentPassword, this.newPassword); this.currentPassword = ''; this.newPassword = ''; this.profileMessage.set('Contraseña actualizada.'); } catch { this.profileMessage.set('No se pudo actualizar la contraseña.'); } }
  protected async saveProfile(): Promise<void> { this.profileMessage.set(null); try { await this.auth.updateProfile({ fullName: this.fullName, phone: this.phone, birthday: this.birthday, avatarUrl: this.avatarUrl }); this.profileMessage.set('Perfil actualizado.'); } catch { this.profileMessage.set('No se pudo actualizar el perfil.'); } }
  protected onAvatarSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') this.avatarUrl = reader.result;
    });
    reader.readAsDataURL(file);
  }
  protected avatarInitials(): string { return (this.fullName || this.auth.user()?.username || 'U').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
  protected navLabel(item: { path: string; label: string }): string { if (this.language() === 'es') return item.label; return ({ entries: 'Logbook', tickets: 'ITIL Tickets', shifts: 'Shifts & Checklist', escalation: 'Escalation / Dispatch', directory: 'Directory', admin: 'Administration' } as Record<string, string>)[item.path] ?? item.label; }

  private readLoginTheme(): LoginTheme {
    const stored = localStorage.getItem(LOGIN_THEME_STORAGE_KEY) as LoginTheme | null;
    return stored && LOGIN_THEMES.includes(stored) ? stored : 'crt';
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
