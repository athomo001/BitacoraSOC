import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';

/** Lo que la persona tiene a su nombre (GET /api/users/{id}/links). */
export interface UserLink {
  kind: 'guard' | 'escalation' | 'pool' | 'shift' | 'client' | 'ticket' | 'task' | 'goal' | 'asset';
  label: string;
  detail?: string;
}

/**
 * Desactivar y Eliminar en el panel de un usuario (decisión del dueño,
 * 2026-10-21). Al desactivar, antes avisa lo que tiene a su nombre: sale de
 * guardias, escalamiento y pools, y lo demás queda a su nombre hasta
 * reasignarlo. Eliminar borra de verdad solo a quien no tiene historial; si
 * tiene, queda bloqueado.
 */
@Component({
  selector: 'app-user-retire',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ur__row">
      @if (active()) {
        <button type="button" class="adm-btn ur__danger" [disabled]="isMe() || busy()" (click)="askBlock()">{{ i18n.t('access.deactivate') }}</button>
      }
      <button type="button" class="adm-btn ur__danger" [disabled]="isMe() || busy()" (click)="ask.set('delete')"><mat-icon>delete</mat-icon>{{ i18n.t('access.retire.delete') }}</button>
    </span>
    @if (ask() === 'block') {
      <div class="ur__box" role="alert">
        <b>{{ i18n.tf('access.retire.blockTitle', name()) }}</b>
        <span>{{ i18n.t('access.retire.has') }}</span>
        <ul class="ur__list">@for (l of links(); track $index) { <li>{{ linkText(l) }}</li> }</ul>
        <span class="ur__muted">{{ i18n.t('access.retire.blockHint') }}</span>
        <span class="ur__row ur__end">
          <button type="button" class="adm-btn" (click)="ask.set(null)">{{ i18n.t('access.cancel') }}</button>
          <button type="button" class="adm-btn adm-btn--danger" (click)="ask.set(null); block.emit()">{{ i18n.t('access.retire.blockAnyway') }}</button>
        </span>
      </div>
    }
    @if (ask() === 'delete') {
      <div class="ur__box" role="alert">
        <b>{{ i18n.tf('access.retire.deleteTitle', name()) }}</b>
        <span class="ur__muted">{{ i18n.t('access.retire.deleteHint') }}</span>
        <span class="ur__row ur__end">
          <button type="button" class="adm-btn" (click)="ask.set(null)">{{ i18n.t('access.cancel') }}</button>
          <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove()">{{ i18n.t('access.retire.delete') }}</button>
        </span>
      </div>
    }
    @if (!active() && links().length) {
      <div class="ur__still">
        <span class="ur__muted">{{ i18n.t('access.retire.still') }}</span>
        <ul class="ur__list">@for (l of links(); track $index) { <li>{{ linkText(l) }}</li> }</ul>
      </div>
    }
    @if (error(); as e) { <p class="msg msg--error" role="alert">{{ e }}</p> }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .ur__row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .ur__end { justify-content: flex-end; }
    .ur__danger { color: var(--status-critical); }
    .ur__danger mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .ur__box { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--status-critical); border-radius: var(--radius-md); background: var(--status-critical-bg); font-size: 12.5px; }
    .ur__still { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
    .ur__list { margin: 0; padding-left: 18px; }
    .ur__muted { color: var(--text-muted); font-size: 12px; }
  `,
})
export class UserRetireComponent {
  readonly userId = input.required<string>();
  readonly name = input.required<string>();
  readonly active = input.required<boolean>();
  readonly isMe = input(false);
  /** Bloquear (lo hace la pantalla, como cualquier cambio del usuario). */
  readonly block = output<void>();
  /** Eliminado: true = borrado de verdad; false = tenía historial y quedó bloqueado. */
  readonly removed = output<boolean>();

  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);

  protected readonly links = signal<UserLink[]>([]);
  protected readonly ask = signal<'block' | 'delete' | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Bloqueado: se ve lo que sigue a su nombre para reasignarlo.
    effect(() => {
      const id = this.userId();
      const active = this.active();
      untracked(() => {
        this.ask.set(null);
        this.links.set([]);
        if (!active) void this.loadLinks(id);
      });
    });
  }

  private async loadLinks(id: string): Promise<UserLink[]> {
    try {
      const list = (await firstValueFrom(this.http.get<ApiEnvelope<UserLink[]>>(`/api/users/${id}/links`))).data;
      if (id === this.userId()) this.links.set(list);
      return list;
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('access.loadError')));
      return [];
    }
  }

  protected async askBlock(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    const list = await this.loadLinks(this.userId());
    this.busy.set(false);
    if (list.length) this.ask.set('block');
    else this.block.emit();
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = (await firstValueFrom(this.http.delete<ApiEnvelope<{ deleted: boolean }>>(`/api/users/${this.userId()}`))).data;
      this.ask.set(null);
      this.removed.emit(res.deleted);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('access.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected linkText(l: UserLink): string {
    const text = this.i18n.tf(`access.link.${l.kind}` as MessageKey, l.label);
    return l.kind === 'guard' && Number(l.detail) > 0 ? `${text} · ${this.i18n.tf('access.link.slots', l.detail ?? '')}` : text;
  }
}
