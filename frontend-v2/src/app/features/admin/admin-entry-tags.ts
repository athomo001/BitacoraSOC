import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { EntriesService, TagStat } from '../../core/entries/entries.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';

/**
 * Administración → Etiquetas (paridad con el legacy, decisiones del dueño
 * 2026-10-16): las etiquetas de la Bitácora con cuántas entradas las usan y
 * cuándo se usaron por última vez. El admin las renombra (si el nombre nuevo
 * ya existe, se juntan) o las borra de todas las entradas. Queda en Auditoría.
 */
@Component({
  selector: 'app-admin-entry-tags',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.tags') }}</h2>
        <p class="adm-muted">{{ i18n.t('tags.subtitle') }}</p>
      </div>
    </header>
    <section class="adm-card">
      <div class="adm-card__head">
        <label class="tg__search"><mat-icon>search</mat-icon>
          <input type="search" name="tagSearch" [placeholder]="i18n.t('tags.search')" [attr.aria-label]="i18n.t('tags.search')" [value]="q()" (input)="q.set(val($event))" /></label>
        <span class="adm-push adm-muted mono">{{ i18n.tf('tags.count', visible().length) }}</span>
      </div>
      @if (error(); as e) { <p class="adm-error tg__pad" role="alert">{{ e }}</p> }
      @if (notice(); as n) { <p class="tg__pad"><span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ n }}</span></p> }
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('tags.col.tag') }}</th><th class="adm-num">{{ i18n.t('tags.col.uses') }}</th><th>{{ i18n.t('tags.col.last') }}</th><th></th></tr></thead>
          <tbody>
            @for (t of visible(); track t.tag) {
              <tr>
                <td>
                  @if (editing() === t.tag) {
                    <span class="tg__edit">
                      <input class="adm-input" name="tagNewName" maxlength="50" [value]="newName()" (input)="newName.set(val($event))" (keydown.enter)="rename(t)" (keydown.escape)="editing.set(null)" />
                      @if (mergesWith(t); as other) { <span class="adm-small text-warn">{{ i18n.tf('tags.merge', other) }}</span> }
                    </span>
                  } @else {
                    <span class="pill tone-neutral">{{ t.tag }}</span>
                  }
                </td>
                <td class="adm-num mono">{{ t.uses }}</td>
                <td class="mono adm-small">{{ day(t.lastUsed) }}</td>
                <td class="adm-num tg__actions">
                  @if (editing() === t.tag) {
                    <button type="button" class="adm-btn" (click)="editing.set(null)">{{ i18n.t('tags.cancel') }}</button>
                    <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !newName().trim() || newName().trim() === t.tag" (click)="rename(t)">{{ i18n.t('tags.rename') }}</button>
                  } @else if (deleting() === t.tag) {
                    <span class="adm-small">{{ i18n.tf('tags.deleteConfirm', t.uses) }}</span>
                    <button type="button" class="adm-btn" (click)="deleting.set(null)">{{ i18n.t('tags.cancel') }}</button>
                    <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove(t)">{{ i18n.t('tags.delete') }}</button>
                  } @else {
                    <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('tags.rename')" [title]="i18n.t('tags.rename')" (click)="startRename(t)"><mat-icon>edit</mat-icon></button>
                    <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('tags.delete')" [title]="i18n.t('tags.delete')" (click)="deleting.set(t.tag)"><mat-icon>delete</mat-icon></button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (loaded() && !visible().length) { <p class="adm-empty">{{ i18n.t(q() ? 'tags.noMatch' : 'tags.empty') }}</p> }
      </div>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tg__pad { margin: 10px 14px 0; }
    .tg__search { display: flex; align-items: center; gap: 6px; min-width: 240px; padding: 0 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-muted); }
    .tg__search input { flex: 1; min-width: 0; min-height: 30px; border: none; outline: none; background: transparent; color: var(--text-primary); font: inherit; }
    .tg__edit { display: flex; flex-direction: column; gap: 4px; }
    .tg__actions { white-space: nowrap; }
    .tg__actions .adm-btn { margin-left: 4px; }
    .text-warn { color: var(--status-warning); }
  `,
})
export class AdminEntryTagsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(EntriesService);

  protected readonly tags = signal<TagStat[]>([]);
  protected readonly loaded = signal(false);
  protected readonly q = signal('');
  protected readonly editing = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);
  protected readonly newName = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly visible = computed(() => {
    const q = this.q().trim().toLowerCase();
    return q ? this.tags().filter((t) => t.tag.toLowerCase().includes(q)) : this.tags();
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.tags.set(await this.api.tagStats());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('tags.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected day(iso: string): string {
    return new Intl.DateTimeFormat(this.prefs.language() === 'en' ? 'en-US' : 'es-CL', { dateStyle: 'short' }).format(new Date(iso));
  }

  /** El nombre nuevo ya existe: se van a juntar. */
  protected mergesWith(t: TagStat): string | null {
    const name = this.newName().trim();
    return name && name !== t.tag && this.tags().some((x) => x.tag === name) ? name : null;
  }

  protected startRename(t: TagStat): void {
    this.deleting.set(null);
    this.editing.set(t.tag);
    this.newName.set(t.tag);
  }

  protected async rename(t: TagStat): Promise<void> {
    const to = this.newName().trim();
    if (!to || to === t.tag) return;
    await this.run(async () => {
      const n = await this.api.renameTag(t.tag, to);
      this.editing.set(null);
      return this.i18n.tf('tags.renamed', n);
    });
  }

  protected async remove(t: TagStat): Promise<void> {
    await this.run(async () => {
      const n = await this.api.deleteTag(t.tag);
      this.deleting.set(null);
      return this.i18n.tf('tags.deleted', n);
    });
  }

  private async run(fn: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      this.notice.set(await fn());
      await this.load();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('tags.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
