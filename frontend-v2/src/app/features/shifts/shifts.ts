import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../shared/ui/button/button';
import { PermissionsService } from '../../core/auth/permissions.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { MyShiftComponent } from './my-shift';
import { ShiftHistoryComponent } from './shift-history';
import { AdminGuardsComponent } from '../admin/admin-guards';
import {
  CONDITION_COLOR_VAR,
  Matrix,
  PublicShare,
  ShiftsService,
  TeleworkCondition,
} from '../../core/shifts/shifts.service';

import '../../core/i18n/packs/shifts';
type ShiftsTab = 'mine' | 'history' | 'dotacion' | 'guards';

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
 * Turnos y Checklist (/shifts, Fase 8 y 11) según el artboard aprobado
 * "Turnos y Checklist: Mi turno". Pestañas: **Mi turno** (relevo + checklist
 * + cierre, la que se abre por defecto: es lo que el analista viene a hacer),
 * **Historial** (legacy checklist-history) y **Dotación** (grilla Lun-Vie de
 * teletrabajo/ausencias, editable inline solo para admin, más el enlace
 * público de TV).
 *
 * La configuración de fondo (ciclos de rotación, turnos, notificaciones
 * periódicas) vive en Administración → Turnos, no acá — mismo criterio que
 * Escalación (la operación del día a día vs. las políticas se configuran en
 * Administración → Escalamiento).
 */
@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [FormsModule, ButtonComponent, MyShiftComponent, ShiftHistoryComponent, AdminGuardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shifts.html',
  styleUrl: './shifts.css',
})
export class ShiftsComponent implements OnInit {
  protected readonly conditionColorVar = CONDITION_COLOR_VAR;
  protected readonly conditions = ALL_CONDITIONS;

  private readonly api = inject(ShiftsService);
  protected readonly i18n = inject(I18nService);
  protected readonly perms = inject(PermissionsService);

  protected readonly tab = signal<ShiftsTab>('mine');
  /**
   * La gente de un área propia (TI, Infra) que no es Operativa ve sus
   * guardias (solo mirar) y la Dotación de su área (9e); Mi turno e
   * Historial son del checklist de SOC/NOC.
   */
  protected readonly areaView = computed(() => !this.perms.operational() && this.perms.ownAreas().length > 0);
  protected readonly area = signal<string | null>(null);
  protected readonly weekStart = signal(mondayOf(new Date()));
  protected readonly matrix = signal<Matrix | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly share = signal<PublicShare | null>(null);
  protected readonly shareBusy = signal(false);

  protected readonly editing = signal<{ userId: string; date: string } | null>(null);
  protected readonly editCondition = signal<TeleworkCondition>('office');
  /** Último día (inclusive) al que se aplica la condición: licencias de varios días. */
  protected readonly editUntil = signal('');
  protected readonly savingEdit = signal(false);

  protected readonly weekLabel = computed(() => {
    const m = this.matrix();
    if (!m || m.columns.length === 0) return '';
    return `${m.columns[0].date} — ${m.columns[m.columns.length - 1].date}`;
  });

  protected conditionKey(condition: TeleworkCondition): MessageKey {
    return `staff.cond.${condition}` as MessageKey;
  }

  protected todayLabel(matrix: Matrix): string {
    return matrix.columns.find((column) => column.isToday)?.date ?? matrix.columns[0]?.date ?? '';
  }

  async ngOnInit(): Promise<void> {
    await this.perms.load();
    if (this.areaView()) {
      this.area.set(this.perms.ownAreas()[0]);
      this.tab.set('guards');
    }
    await this.loadMatrix();
  }

  protected async pickArea(code: string): Promise<void> {
    this.area.set(code);
    await this.loadMatrix();
  }

  private async loadMatrix(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const from = isoDate(this.weekStart());
      const to = isoDate(new Date(this.weekStart().getTime() + 6 * 86_400_000));
      this.matrix.set(await this.api.matrix(from, to, this.areaView() ? this.area() : null));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('staff.loadError')));
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
    this.editUntil.set(date);
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
      const until = this.editUntil();
      await this.api.setAssignment({
        userId: target.userId, assignedDate: target.date, condition: this.editCondition(),
        ...(until > target.date ? { untilDate: until } : {}),
      });
      this.editing.set(null);
      await this.loadMatrix();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('staff.saveError')));
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
      this.error.set(problemDetail(error, this.i18n.t('staff.tvError')));
    } finally {
      this.shareBusy.set(false);
    }
  }
}
