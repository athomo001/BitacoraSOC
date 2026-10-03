import { Directive, ElementRef, Injectable, OnDestroy, effect, inject, input } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * Cache de imágenes protegidas: una URL /api/... se pide una vez con
 * HttpClient (el interceptor pone el token) y se reutiliza como blob: URL.
 */
@Injectable({ providedIn: 'root' })
export class AuthImageCache {
  private readonly http = inject(HttpClient);
  private readonly urls = new Map<string, Promise<string>>();

  get(url: string): Promise<string> {
    let cached = this.urls.get(url);
    if (!cached) {
      cached = firstValueFrom(this.http.get(url, { responseType: 'blob' })).then((blob) => URL.createObjectURL(blob));
      cached.catch(() => this.urls.delete(url));
      this.urls.set(url, cached);
    }
    return cached;
  }
}

/**
 * `<img [appAuthSrc]="'/api/tickets/…/images/…'">`: un `<img src>` directo
 * no lleva el token (respondía 401, como pasó con "Exportar CSV"). La
 * directiva pide la imagen con HttpClient y pone el blob: URL.
 */
@Directive({ selector: 'img[appAuthSrc]', standalone: true })
export class AuthImgDirective implements OnDestroy {
  readonly appAuthSrc = input.required<string>();
  private readonly el = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly cache = inject(AuthImageCache);
  private alive = true;

  constructor() {
    effect(() => {
      const url = this.appAuthSrc();
      void this.cache
        .get(url)
        .then((blobUrl) => {
          if (this.alive && url === this.appAuthSrc()) this.el.nativeElement.src = blobUrl;
        })
        .catch(() => {
          // Imagen inexistente o sin permiso: queda el texto alternativo.
        });
    });
  }

  ngOnDestroy(): void {
    this.alive = false;
  }
}
