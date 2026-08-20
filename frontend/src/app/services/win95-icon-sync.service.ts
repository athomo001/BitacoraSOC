/**
 * File Purpose: frontend/src/app/services/win95-icon-sync.service.ts
 * Responsibilities: Mientras el tema 'win95' está activo, mantiene un atributo
 * data-icon en cada <mat-icon> reflejando su nombre de ligadura actual, para que
 * win95-icons.scss pueda pintar el ícono pixel-art correspondiente vía CSS.
 * Nunca toca el contenido/hijos del elemento, así que la reactividad normal de
 * Angular (interpolaciones que cambian el nombre del ícono en tiempo real) no
 * se ve afectada. En cualquier otro tema queda completamente inactivo.
 */
import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ThemeService } from './theme.service';
import { WIN95_ICON_MAP } from './win95-icon-map';

@Injectable({
  providedIn: 'root'
})
export class Win95IconSyncService implements OnDestroy {
  private themeSub: Subscription;
  private observer: MutationObserver | null = null;

  constructor(private themeService: ThemeService) {
    this.themeSub = this.themeService.currentTheme$.subscribe((theme) => {
      if (theme === 'win95') {
        this.start();
      } else {
        this.stop();
      }
    });
  }

  ngOnDestroy(): void {
    this.themeSub.unsubscribe();
    this.stop();
  }

  private start(): void {
    if (this.observer) return;

    document.querySelectorAll('mat-icon').forEach((el) => this.syncIcon(el));

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const host = mutation.target.parentElement;
          if (host && host.tagName === 'MAT-ICON') {
            this.syncIcon(host);
          }
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.tagName === 'MAT-ICON') {
              this.syncIcon(node);
            }
            node.querySelectorAll?.('mat-icon').forEach((el) => this.syncIcon(el));
          });
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private syncIcon(el: Element): void {
    const name = (el.textContent || '').trim();
    if (!name || !WIN95_ICON_MAP[name]) return;
    if (el.getAttribute('data-icon') !== name) {
      el.setAttribute('data-icon', name);
    }
  }
}
