import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, Injector, OnInit, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SHELL_NAV_ITEMS } from './shell-nav';
import { AuthService } from '../core/auth/auth.service';
import { SystemFeature, SystemFeaturesService } from '../core/system-features/system-features.service';
import { PreferencesService, Theme } from '../core/preferences/preferences.service';
import { I18nService } from '../core/i18n/i18n.service';
import { MessageKey } from '../core/i18n/messages';
import { SseService } from '../core/sse/sse.service';
import { UserAvatarComponent } from './user-avatar';
import { ComplementsService } from '../core/complements/complements.service';
import { SetupService } from '../core/setup/setup.service';

/** Ícono y etiqueta del botón de tema: muestran el tema SIGUIENTE (igual que el diseño). */
const NEXT_THEME: Record<Theme, { icon: string; labelKey: MessageKey }> = {
  dark: { icon: 'light_mode', labelKey: 'shell.theme.toLight' },
  light: { icon: 'favorite', labelKey: 'shell.theme.toPink' },
  pink: { icon: 'dark_mode', labelKey: 'shell.theme.toDark' },
};

/**
 * Shell principal según el diseño aprobado "BitacoraSOC UI Base": barra
 * lateral de 1 nivel (spec/06-frontend-arquitectura-y-ui.md sección 3,
 * nunca "menú del submenú del menú") con marca arriba, secciones con su
 * atajo Alt+N visible, y al pie el usuario + idioma ES/EN + tema + fuente
 * para dislexia. Sin barra superior: el área de trabajo es toda de la
 * sección activa. Las pestañas contextuales viven dentro de cada feature.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, UserAvatarComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly i18n = inject(I18nService);
  private readonly features = inject(SystemFeaturesService);
  private readonly setup = inject(SetupService);
  private readonly sse = inject(SseService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly complements = inject(ComplementsService);

  constructor() {
    // Encender o apagar "Complementos" (aquí o desde otro admin) recarga la
    // lista de los que ve este usuario; apagado, el ítem desaparece.
    effect(() => {
      if (this.features.isEnabled('complements')) void this.complements.refresh();
      else this.complements.clear();
    });
    // Si apagan (aquí o en otra pestaña) el módulo de la pantalla abierta, se
    // sale de ella: un módulo apagado no se ve (regla del dueño). Solo cuenta
    // el paso de encendido a apagado, no la carga inicial.
    const wasOn = new Map<string, boolean>();
    effect(() => {
      for (const item of SHELL_NAV_ITEMS) {
        if (!item.requiresFeature) continue;
        const on = this.features.isEnabled(item.requiresFeature);
        const leaving = wasOn.get(item.path) === true && !on;
        wasOn.set(item.path, on);
        if (leaving && this.router.url.split('?')[0].startsWith('/' + item.path)) void this.router.navigateByUrl('/entries');
      }
    });
  }

  /** Se recalcula solo cuando cambia una funcionalidad: activar la ticketera la muestra al instante. */
  protected readonly navItems = computed(() =>
    SHELL_NAV_ITEMS.filter(
      (item) =>
        (!item.requiresFeature || this.features.isEnabled(item.requiresFeature)) &&
        (!item.requiresComplements || this.complements.available().length > 0),
    ),
  );
  protected readonly nextTheme = computed(() => NEXT_THEME[this.prefs.theme()]);
  protected readonly displayName = computed(() => {
    const user = this.auth.user();
    return user?.fullName || user?.username || '';
  });

  async ngOnInit(): Promise<void> {
    // Cambios hechos por otro admin u otra pestaña llegan en vivo.
    const stop = this.sse.connect((eventType, data) => {
      if (eventType === 'system_feature.updated' && isFeature(data)) this.features.apply(data);
      // SOC/NOC encendidos o apagados por otro admin: menús y pantallas cambian sin F5.
      if (eventType === 'config.modules.updated' && isModules(data)) this.setup.applyModules(data);
    });
    this.destroyRef.onDestroy(stop);
    await Promise.all([this.loadUser(), this.loadFeatures()]);
  }

  /** Tras un F5 solo sobrevive el token: el usuario (nombre, avatar) se vuelve a pedir. */
  private async loadUser(): Promise<void> {
    if (this.auth.user()) return;
    try {
      await this.auth.loadMe();
    } catch {
      // Un token vencido lo resuelve el interceptor; acá solo falta el nombre en la barra.
    }
  }

  private async loadFeatures(): Promise<void> {
    try {
      await this.features.list();
    } catch {
      // Sin catálogo de funcionalidades el núcleo sigue navegable; solo faltan los módulos opcionales.
    }
  }

  /**
   * Carga diferida: el modal arrastra CDK Dialog y los botones de Material
   * (~150 kB); si se importara arriba, iría en el bundle inicial de toda la
   * app solo por algo que se abre de vez en cuando.
   */
  protected async openProfile(): Promise<void> {
    const [{ Dialog }, { ProfileDialogComponent }] = await Promise.all([
      import('@angular/cdk/dialog'),
      import('./profile-dialog'),
    ]);
    this.injector.get(Dialog).open(ProfileDialogComponent, { ariaLabel: this.i18n.t('profile.title') });
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

function isModules(data: unknown): data is { socEnabled: boolean; nocEnabled: boolean } {
  const d = data as { socEnabled?: unknown; nocEnabled?: unknown } | null;
  return typeof d?.socEnabled === 'boolean' && typeof d?.nocEnabled === 'boolean';
}

function isFeature(data: unknown): data is Pick<SystemFeature, 'code' | 'isEnabled'> {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as SystemFeature).code === 'string' &&
    typeof (data as SystemFeature).isEnabled === 'boolean'
  );
}
