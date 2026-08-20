/**
 * File Purpose: frontend/src/app/app.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { ThemeService } from './services/theme.service';
import { Win95IconSyncService } from './services/win95-icon-sync.service';
import { ConfigService } from './services/config.service';
import { environment } from '../environments/environment';
import { RouterOutlet } from '@angular/router';

@Component({
    selector: 'app-root',
    template: '<router-outlet></router-outlet>',
    styles: [],
    imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private backendBaseUrl = environment.backendBaseUrl;

  constructor(
    private themeService: ThemeService,
    private win95IconSyncService: Win95IconSyncService,
    private configService: ConfigService,
    private titleService: Title,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // El tema se aplica automáticamente en el constructor del servicio.
    // win95IconSyncService solo se inyecta para forzar su instanciación temprana
    // (providedIn: 'root'); su lógica queda inactiva salvo que el tema sea 'win95'.
  }

  ngOnInit(): void {
    // Cargar y actualizar favicon dinámicamente
    if (isPlatformBrowser(this.platformId)) {
      this.titleService.setTitle('');

      this.configService.getLogo().subscribe({
        next: (response) => {
          this.updateDocumentTitle(response.appTitle);
        },
        error: () => {
          this.updateDocumentTitle('');
        }
      });

      this.configService.getFavicon().subscribe({
        next: (response) => {
          if (response.faviconUrl) {
            this.updateFavicon(this.getAssetUrl(response.faviconUrl));
            return;
          }

          // Backward compatibility: si no hay favicon, usar logo (comportamiento previo)
          this.configService.getLogo().subscribe({
            next: (logoResponse) => {
              if (logoResponse.logoUrl) {
                this.updateFavicon(this.getAssetUrl(logoResponse.logoUrl));
              }
            },
            error: () => {
              // Si hay error, mantener el favicon por defecto
            }
          });
        },
        error: () => {
          // Si hay error, mantener el favicon por defecto
        }
      });
    }
  }

  private getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.backendBaseUrl}${url}`;
  }

  private updateFavicon(iconUrl: string): void {
    const link: HTMLLinkElement = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.type = iconUrl.endsWith('.png') ? 'image/png' : 'image/x-icon';
    link.rel = 'icon';
    link.href = iconUrl;
    document.getElementsByTagName('head')[0].appendChild(link);
  }

  private updateDocumentTitle(appTitle?: string): void {
    const resolvedTitle = (appTitle || '').trim();
    this.titleService.setTitle(resolvedTitle);
  }
}
