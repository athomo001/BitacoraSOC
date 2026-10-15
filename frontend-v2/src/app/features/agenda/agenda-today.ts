import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AgendaOccurrence, AgendaService } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/agenda';

/**
 * Agenda en el popup de Inicio de turno (spec/16 §4.5, diseño aprobado
 * 2026-10-15): «Hoy vencen 3 tareas y tienes 1 atrasada», con la lista. No
 * es una ventana nueva; sin nada para hoy, no aparece.
 */
@Component({
  selector: 'app-agenda-today',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <section class="at" [attr.aria-label]="headline()">
        <b class="at__title">{{ headline() }}</b>
        @for (o of items(); track o.id) {
          <span class="at__item"><span class="pill {{ o.late ? 'tone-bad' : 'tone-warn' }}">{{ i18n.t(o.late ? 'ag.status.late' : 'ag.grp.today') }}</span>{{ o.task.name }}</span>
        }
        <span><button type="button" class="adm-btn" (click)="open()"><mat-icon>event_note</mat-icon>{{ i18n.t('ag.shift.open') }}</button></span>
      </section>
    }
  `,
  styles: `
    mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .at { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border-subtle); border-left: 4px solid var(--status-warning); border-radius: var(--radius-md); }
    .at__title { font-size: 13px; }
    .at__item { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  `,
})
export class AgendaTodayComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AgendaService);
  private readonly router = inject(Router);
  private readonly dialogRef = inject(DialogRef, { optional: true });

  protected readonly items = signal<AgendaOccurrence[]>([]);
  protected readonly headline = computed(() => {
    const today = this.items().filter((o) => !o.late).length;
    const late = this.items().filter((o) => o.late).length;
    const parts: string[] = [];
    if (today) parts.push(today === 1 ? this.i18n.t('ag.shift.dueToday1') : this.i18n.tf('ag.shift.dueToday', today));
    if (late) parts.push(late === 1 ? this.i18n.t('ag.shift.late1') : this.i18n.tf('ag.shift.late', late));
    return parts.join(this.i18n.t('ag.shift.and'));
  });

  async ngOnInit(): Promise<void> {
    try {
      const mine = await this.api.mine();
      this.items.set(mine.filter((o) => o.status === 'pending' && (o.late || o.bizDays <= 0)));
    } catch {
      this.items.set([]); // es un extra del popup: si falla, no estorba
    }
  }

  protected open(): void {
    this.dialogRef?.close();
    void this.router.navigateByUrl('/agenda');
  }
}
