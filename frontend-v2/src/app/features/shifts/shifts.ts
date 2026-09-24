import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../shared/ui/button/button';
import { PlaceholderComponent } from '../../shared/ui/placeholder/placeholder';
import { PermissionsService } from '../../core/auth/permissions.service';
import { problemDetail } from '../../core/http-error';
import {
  CONDITION_COLOR_VAR,
  CONDITION_LABELS,
  Matrix,
  PublicShare,
  ShiftsService,
  TeleworkCondition,
} from '../../core/shifts/shifts.service';

type ShiftsTab = 'dotacion' | 'checklist';

const ALL_CONDITIONS: TeleworkCondition[] = ['office', 'telework', 'guardia', 'training', 'medical_appointment', 'vacation', 'medical_leave'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Lunes 00:00 de la semana que contiene d (misma regla que mondayOf en el backend). */
function mondayOf(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}

/**
 * Turnos y Dotación (/shifts, Fase 8 y 11). Dos pestañas fijas por el
 * mockup (spec/06-frontend-arquitectura-y-ui.md sección 3): **Dotación**
 * (esta fase: grilla Lun-Vie de teletrabajo/ausencias, editable inline solo
 * para admin, más el enlace público de TV) y **Mi Turno** (checklist de
 * inicio/cierre, Fase 11).
 *
 * La configuración de fondo (ciclos de rotación, turnos, notificaciones
 * periódicas) vive en Administración → Turnos, no acá — mismo criterio que
 * Escalación (la operación del día a día vs. las políticas se configuran en
 * Administración → Escalamiento).
 */
@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [FormsModule, ButtonComponent, PlaceholderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shifts.html',
  styleUrl: './shifts.css',
})
export class ShiftsComponent implements OnInit {
  protected readonly conditionLabels = CONDITION_LABELS;
  protected readonly conditionColorVar = CONDITION_COLOR_VAR;
  protected readonly conditions = ALL_CONDITIONS;

  private readonly api = inject(ShiftsService);
  protected readonly perms = inject(PermissionsService);

  protected readonly tab = signal<ShiftsTab>('dotacion');
  protected readonly weekStart = signal(mondayOf(new Date()));
  protected readonly matrix = signal<Matrix | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly share = signal<PublicShare | null>(null);
  protected readonly shareBusy = signal(false);

  protected readonly editing = signal<{ userId: string; date: string } | null>(null);
  protected readonly editCondition = signal<TeleworkCondition>('office');
  protected readonly savingEdit = signal(false);

  protected readonly weekLabel = computed(() => {
    const m = this.matrix();
    if (!m || m.columns.length === 0) return '';
    return `${m.columns[0].date} — ${m.columns[m.columns.length - 1].date}`;
  });

  async ngOnInit(): Promise<void> {
    await this.perms.load();
    await this.loadMatrix();
  }

  private async loadMatrix(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const from = isoDate(this.weekStart());
      const to = isoDate(new Date(this.weekStart().getTime() + 4 * 86_400_000));
      this.matrix.set(await this.api.matrix(from, to));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo cargar la matriz de dotación.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async shiftWeek(deltaWeeks: number): Promise<void> {
    const next = new Date(this.weekStart());
    next.setDate(next.getDate() + deltaWeeks * 7);
    this.weekStart.set(next);
    this.editing.set(null);
    await this.loadMatrix();
  }

  protected async goToCurrentWeek(): Promise<void> {
    this.weekStart.set(mondayOf(new Date()));
    this.editing.set(null);
    await this.loadMatrix();
  }

  protected startEdit(userId: string, date: string, condition: TeleworkCondition): void {
    if (!this.perms.isAdmin()) return;
    this.editing.set({ userId, date });
    this.editCondition.set(condition);
  }

  protected isEditing(userId: string, date: string): boolean {
    const e = this.editing();
    return e !== null && e.userId === userId && e.date === date;
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected async saveEdit(): Promise<void> {
    const target = this.editing();
    if (!target || this.savingEdit()) return;
    this.savingEdit.set(true);
    this.error.set(null);
    try {
      await this.api.setAssignment({ userId: target.userId, assignedDate: target.date, condition: this.editCondition() });
      this.editing.set(null);
      await this.loadMatrix();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo guardar la asignación.'));
    } finally {
      this.savingEdit.set(false);
    }
  }

  protected async shareLinkAction(action: 'generate' | 'regenerate' | 'deactivate'): Promise<void> {
    if (this.shareBusy()) return;
    this.shareBusy.set(true);
    this.error.set(null);
    try {
      this.share.set(await this.api.publicShareAction(action));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo actualizar el enlace público de TV.'));
    } finally {
      this.shareBusy.set(false);
    }
  }
}
