import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ClientNote, ManagementService } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/management';

/**
 * Notas internas del CSM en la ficha del cliente (spec/16 §4.7.1, diseño
 * aprobado 2026-10-21): solo las ve el equipo de CSM. Edita y borra el autor;
 * fijar, cualquiera de CSM. «Crear acción» abre «Nueva acción» con el texto.
 */
@Component({
  selector: 'app-mgmt-notes',
  standalone: true,
  imports: [DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mn">
      <div class="mn__composer">
        <textarea name="noteNew" maxlength="5000" [placeholder]="i18n.t('mg.nt.ph')" [attr.aria-label]="i18n.t('mg.nt.new')" [value]="draft()" (input)="draft.set(val($event))"></textarea>
        <div class="mn__row">
          <span class="mn__vis"><mat-icon>lock</mat-icon>{{ i18n.t('mg.nt.visibility') }}</span>
          @if (saved()) { <span class="text-ok adm-small" role="status">{{ i18n.t('mg.nt.saved') }}</span> }
          <button type="button" class="adm-btn adm-btn--primary mn__push" [disabled]="busy() || !draft().trim()" (click)="create()"><mat-icon>note_add</mat-icon>{{ i18n.t('mg.nt.save') }}</button>
        </div>
      </div>
      @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
      @for (n of notes(); track n.id) {
        <article class="mn__note" [class.mn__note--pinned]="n.pinned">
          <div class="mn__meta">
            <b>{{ n.authorName }}</b><span class="mono">{{ n.createdAt | date: 'dd/MM HH:mm' }}</span>
            @if (n.editedAt) { <span>{{ i18n.tf('mg.nt.edited', (n.editedAt | date: 'dd/MM HH:mm') ?? '') }}</span> }
            @if (n.pinned) { <span class="text-warn mn__flag"><mat-icon>push_pin</mat-icon>{{ i18n.t('mg.nt.pinned') }}</span> }
          </div>
          <div class="mn__acts">
            <button type="button" class="adm-btn mn__ghost" (click)="pin(n)"><mat-icon>push_pin</mat-icon>{{ i18n.t(n.pinned ? 'mg.nt.unpin' : 'mg.nt.pin') }}</button>
            <button type="button" class="adm-btn mn__ghost" (click)="action.emit(n.content)"><mat-icon>add_task</mat-icon>{{ i18n.t('mg.nt.action') }}</button>
            @if (n.mine) {
              <button type="button" class="adm-btn mn__ghost" (click)="edit(n)"><mat-icon>edit</mat-icon>{{ i18n.t('mg.nt.edit') }}</button>
              <button type="button" class="adm-btn mn__ghost" (click)="confirm.set(n.id)"><mat-icon>delete</mat-icon>{{ i18n.t('mg.nt.delete') }}</button>
            }
          </div>
          @if (editing() === n.id) {
            <div class="mn__edit">
              <textarea name="noteEdit" maxlength="5000" [attr.aria-label]="i18n.t('mg.nt.edit')" [value]="editText()" (input)="editText.set(val($event))"></textarea>
              <div class="mn__row">
                <button type="button" class="adm-btn mn__push" (click)="editing.set(null)">{{ i18n.t('mg.cancel') }}</button>
                <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !editText().trim()" (click)="saveEdit(n)">{{ i18n.t('mg.save') }}</button>
              </div>
            </div>
          } @else {
            <p class="mn__text">{{ n.content }}</p>
          }
          @if (confirm() === n.id) {
            <div class="mn__confirm" role="alert"><mat-icon>warning</mat-icon><span>{{ i18n.t('mg.nt.confirm') }}</span>
              <button type="button" class="adm-btn mn__push" (click)="confirm.set(null)">{{ i18n.t('mg.cancel') }}</button>
              <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove(n)">{{ i18n.t('mg.nt.delete') }}</button></div>
          }
        </article>
      } @empty {
        <p class="adm-empty">{{ i18n.t('mg.nt.empty') }}</p>
      }
    </div>
  `,
  styles: `
    .mn { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; }
    textarea { width: 100%; min-height: 70px; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); font: inherit; font-size: 13px; resize: vertical; }
    .mn__composer, .mn__edit { display: flex; flex-direction: column; gap: 8px; }
    .mn__edit { grid-column: 1 / -1; }
    .mn__row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .mn__push { margin-left: auto; }
    .mn__vis { display: inline-flex; gap: 5px; align-items: center; color: var(--text-muted); font-size: 11.5px; }
    .mn__note { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 0 0; border-top: 1px solid var(--border-subtle); }
    .mn__note--pinned { padding-left: 10px; border-left: 3px solid var(--status-warning); }
    .mn__meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--text-muted); font-size: 12px; }
    .mn__meta b { color: var(--text-primary); font-weight: 600; }
    .mn__flag { display: inline-flex; gap: 3px; align-items: center; font-weight: 600; }
    .mn__acts { display: flex; flex-wrap: wrap; gap: 2px; }
    .mn__ghost { padding: 3px 7px; border-color: transparent; background: transparent; }
    .mn__text { grid-column: 1 / -1; max-width: 70ch; margin: 0; font-size: 13px; white-space: pre-line; }
    .mn__confirm { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px; border-radius: var(--radius-md); background: var(--status-critical-bg); font-size: 12.5px; }
    mat-icon { width: 15px; height: 15px; font-size: 15px; }
  `,
})
export class MgmtNotesComponent {
  readonly clientId = input.required<string>();
  /** Cambió la cantidad de notas (la pestaña la muestra). */
  readonly count = output<number>();
  /** «Crear acción» con el texto de la nota. */
  readonly action = output<string>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);

  protected readonly notes = signal<ClientNote[]>([]);
  protected readonly draft = signal('');
  protected readonly editing = signal<string | null>(null);
  protected readonly editText = signal('');
  protected readonly confirm = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.clientId();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const list = await this.api.clientNotes(id);
      if (id !== this.clientId()) return;
      this.notes.set(list);
      this.count.emit(list.length);
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLTextAreaElement).value;
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
      await this.load(this.clientId());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    const content = this.draft().trim();
    if (!content) return;
    await this.run(async () => {
      await this.api.createClientNote(this.clientId(), content);
      this.draft.set('');
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 1600);
    });
  }

  protected edit(n: ClientNote): void {
    this.editText.set(n.content);
    this.editing.set(n.id);
  }

  protected async saveEdit(n: ClientNote): Promise<void> {
    await this.run(async () => {
      await this.api.updateClientNote(n.id, this.editText().trim());
      this.editing.set(null);
    });
  }

  protected async pin(n: ClientNote): Promise<void> {
    await this.run(() => this.api.pinClientNote(n.id, !n.pinned));
  }

  protected async remove(n: ClientNote): Promise<void> {
    await this.run(async () => {
      await this.api.deleteClientNote(n.id);
      this.confirm.set(null);
    });
  }
}
