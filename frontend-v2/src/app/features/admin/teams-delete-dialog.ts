import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TeamSummary } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/admin';

export type TeamsDeleteChoice = 'delete' | 'deactivate';

export interface TeamsDeleteData { teams: TeamSummary[]; }

interface Impact { icon: string; text: string; }

/**
 * "Borrar equipos" (canvas "Equipos y llamados de escalamiento", 2026-10-07):
 * antes de borrar dice qué se lleva cada equipo. Borrar es en cascada menos
 * los contactos del Directorio; los tickets quedan sin equipo. "Solo
 * desactivar" es la salida sin pérdida.
 */
@Component({
  selector: 'app-teams-delete-dialog',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td" role="document">
      <header class="td__head">
        <mat-icon class="td__danger">delete_forever</mat-icon>
        <h2 class="td__title">{{ i18n.tf('teamsDelete.title', data.teams.length) }}</h2>
        <button type="button" class="td__icon-btn" [attr.aria-label]="i18n.t('teamsDelete.close')" (click)="ref.close()"><mat-icon>close</mat-icon></button>
      </header>
      <div class="td__body">
        @if (impacts.length) {
          <p>{{ i18n.t('teamsDelete.lead') }}</p>
          @for (i of impacts; track $index) {
            <div class="td__item td__item--warn"><mat-icon>{{ i.icon }}</mat-icon><span>{{ i.text }}</span></div>
          }
        } @else {
          <div class="td__item td__item--ok"><mat-icon>check_circle</mat-icon><span>{{ i18n.t('teamsDelete.unused') }}</span></div>
        }
        <div class="td__item td__item--ok"><mat-icon>contacts</mat-icon><span>{{ i18n.t('teamsDelete.directoryKept') }}</span></div>
        <p class="td__hint">{{ i18n.t('teamsDelete.deactivateHint') }}</p>
      </div>
      <footer class="td__foot">
        <button type="button" class="adm-btn" (click)="ref.close('deactivate')">{{ i18n.t('teamsDelete.deactivate') }}</button>
        <button type="button" class="adm-btn" (click)="ref.close()">{{ i18n.t('adminChecklist.cancel') }}</button>
        <button type="button" class="adm-btn adm-btn--danger" (click)="ref.close('delete')"><mat-icon>delete_forever</mat-icon>{{ i18n.t('teamsDelete.confirm') }}</button>
      </footer>
    </div>
  `,
  styles: `
    .td { display: flex; flex-direction: column; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); }
    mat-icon { flex-shrink: 0; width: 16px; height: 16px; font-size: 16px; }
    .td__head, .td__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
    .td__head { border-bottom: 1px solid var(--border-subtle); }
    .td__foot { justify-content: flex-end; border-top: 1px solid var(--border-subtle); }
    .td__title { margin: 0; font-size: 14px; font-weight: 600; }
    .td__danger { color: var(--status-critical); }
    .td__icon-btn { display: flex; margin-left: auto; padding: 4px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .td__body { display: flex; flex-direction: column; gap: 8px; overflow: auto; padding: 14px 16px; font-size: 12.5px; }
    .td__body p { margin: 0; }
    .td__item { display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; border-radius: var(--radius-sm); }
    .td__item--warn { background: var(--status-warning-bg); }
    .td__item--warn mat-icon { color: var(--status-warning); }
    .td__item--ok { background: var(--status-ok-bg); }
    .td__item--ok mat-icon { color: var(--status-ok); }
    .td__hint { color: var(--text-muted); font-size: 11.5px; }
  `,
})
export class TeamsDeleteDialogComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<TeamsDeleteData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<TeamsDeleteChoice>>(DialogRef);

  protected readonly impacts: Impact[] = this.data.teams.flatMap((t) => {
    const u = t.usage;
    if (!u) return [];
    const out: Impact[] = [];
    if (u.steps) out.push({ icon: 'call_split', text: this.i18n.t('teamsDelete.steps').replace('{t}', t.name).replace('{v}', u.steps) });
    if (u.raci) out.push({ icon: 'account_tree', text: this.i18n.t('teamsDelete.raci').replace('{t}', t.name).replace('{v}', String(u.raci)) });
    if (u.guards) out.push({ icon: 'event', text: this.i18n.t('teamsDelete.guards').replace('{t}', t.name).replace('{v}', String(u.guards)) });
    if (u.tickets) out.push({ icon: 'confirmation_number', text: this.i18n.t('teamsDelete.tickets').replace('{t}', t.name).replace('{v}', String(u.tickets)) });
    return out;
  });
}
