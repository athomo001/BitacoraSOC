import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { ComplementsService } from '../../core/complements/complements.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { ComplementFrameComponent } from '../../shared/complement-frame/complement-frame';

import '../../core/i18n/packs/complement-features';

/** A dónde vuelve cada módulo. */
const BACK: Record<string, string> = { tickets: '/tickets', escalation: '/escalation', shifts: '/shifts', reports: '/reports', admin: '/admin' };

/**
 * Página de un complemento dentro de un módulo sin pestañas (10i):
 * /m/<módulo>/<slug>/<id>. Arriba, la vuelta al módulo y «Descargar PDF»;
 * el resto, el complemento. Si la página ya no está aprobada (o el
 * complemento se apagó) no hay nada que mostrar y se vuelve al módulo.
 */
@Component({
  selector: 'app-complement-page',
  standalone: true,
  imports: [RouterLink, MatIconModule, ComplementFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cp">
      <header class="cp__head">
        <a class="adm-btn" [routerLink]="back()"><mat-icon>arrow_back</mat-icon>{{ i18n.t(moduleKey()) }}</a>
        @if (page(); as p) {
          <h1 class="cp__title"><mat-icon>{{ p.icon }}</mat-icon>{{ p.title }}</h1>
          <button type="button" class="adm-btn" (click)="frame()?.print()"><mat-icon>download</mat-icon>{{ i18n.t('cf.downloadPdf') }}</button>
        }
      </header>
      @if (page(); as p) {
        <app-complement-frame class="cp__frame" [slug]="p.slug" [slot]="p.key" [label]="p.title" />
      }
    </div>
  `,
  styles: `
    :host { display: block; height: calc(100% + 32px); margin: -16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .cp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .cp__head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface); }
    .cp__title { display: flex; flex: 1; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 600; }
    .cp__frame { flex: 1; }
  `,
})
export class ComplementPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly complements = inject(ComplementsService);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap, { requireSync: true });
  protected readonly frame = viewChild(ComplementFrameComponent);

  private readonly module = computed(() => this.params().get('module') ?? '');
  protected readonly back = computed(() => BACK[this.module()] ?? '/');
  protected readonly moduleKey = computed(() => `cf.module.${this.module()}` as MessageKey);
  protected readonly page = computed(() => {
    const slug = this.params().get('slug');
    const key = 'page:' + this.params().get('id');
    return this.complements.slots().pages.find((p) => p.slug === slug && p.key === key && p.module === this.module()) ?? null;
  });
}
