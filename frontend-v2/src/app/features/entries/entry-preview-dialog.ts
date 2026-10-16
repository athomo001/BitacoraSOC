import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { EntriesService, EntryDetail } from '../../core/entries/entries.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { AuthImgDirective } from '../../shared/ui/auth-img';

import '../../core/i18n/packs/entries';

export interface EntryPreviewData {
  entryId: string;
}

/**
 * Una entrada de la Bitácora en un popup, para verla sin salir de donde se
 * está (pedido del dueño 2026-10-16: desde un ticket). Solo lectura; «Abrir
 * en la Bitácora» lleva a la entrada si hace falta trabajarla.
 */
@Component({
  selector: 'app-entry-preview-dialog',
  standalone: true,
  imports: [DatePipe, RouterLink, MatIconModule, MarkdownComponent, AuthImgDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ep" role="document">
      <header class="ep__head">
        <mat-icon>menu_book</mat-icon>
        <h2 class="ep__title">{{ i18n.t('entries.preview.title') }}</h2>
        <button type="button" class="adm-icon-btn ep__close" [attr.aria-label]="i18n.t('common.close')" (click)="ref.close()"><mat-icon>close</mat-icon></button>
      </header>
      <div class="ep__body">
        @if (entry(); as e) {
          <p class="ep__meta">
            <span class="pill tone-neutral">{{ i18n.t(scopeKey(e.scope)) }}</span>
            <span class="pill tone-neutral">{{ i18n.t(typeKey(e.entryType)) }}</span>
            <span>{{ e.authorUsername }} · <span class="mono">{{ e.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span></span>
          </p>
          <app-markdown [content]="e.content" />
          @if (e.imageUrl) { <img class="ep__img" [appAuthSrc]="e.imageUrl" [alt]="i18n.t('entries.evidence')" /> }
          @if (e.tags.length) {
            <p class="ep__tags">@for (tag of e.tags; track tag) { <span class="pill tone-neutral">{{ tag }}</span> }</p>
          }
          <span class="adm-label">{{ i18n.t('entries.followUps') }}</span>
          <ul class="ep__comments">
            @for (c of e.comments; track c.id) {
              <li><strong>{{ c.authorUsername }}</strong> <span class="mono ep__muted">{{ c.createdAt | date: 'dd/MM HH:mm' }}</span><br />{{ c.comment }}</li>
            } @empty {
              <li class="ep__muted">{{ i18n.t('entries.noFollowUps') }}</li>
            }
          </ul>
        } @else if (error(); as message) {
          <p class="ep__error" role="alert">{{ message }}</p>
        } @else {
          <p class="ep__muted">{{ i18n.t('entries.preview.loading') }}</p>
        }
      </div>
      <footer class="ep__foot">
        <a class="adm-btn" routerLink="/entries" [queryParams]="{ entry: data.entryId }" (click)="ref.close()"><mat-icon>open_in_new</mat-icon>{{ i18n.t('entries.preview.open') }}</a>
        <button type="button" class="adm-btn adm-btn--primary" (click)="ref.close()">{{ i18n.t('common.close') }}</button>
      </footer>
    </div>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ep { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45); }
    .ep__head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .ep__title { margin: 0; font-size: 14px; font-weight: 600; }
    .ep__close { margin-left: auto; }
    .ep__body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; overflow: auto; font-size: 13px; line-height: 1.55; }
    .ep__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; color: var(--text-secondary); font-size: 12px; }
    .ep__img { max-width: 100%; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
    .ep__tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; }
    .ep__comments { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 6px; }
    .ep__muted { color: var(--text-muted); font-size: 12px; }
    .ep__error { margin: 0; color: var(--status-critical); }
    .ep__foot { display: flex; justify-content: flex-end; gap: 6px; padding: 10px 16px; border-top: 1px solid var(--border-subtle); }
  `,
})
export class EntryPreviewDialogComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<EntryPreviewData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  private readonly api = inject(EntriesService);

  protected readonly entry = signal<EntryDetail | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.entry.set(await this.api.get(this.data.entryId));
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('entries.preview.error')));
    }
  }

  protected typeKey(t: string): MessageKey {
    return `entries.type.${t}` as MessageKey;
  }

  protected scopeKey(s: string): MessageKey {
    return `entries.scope.${s}` as MessageKey;
  }
}
