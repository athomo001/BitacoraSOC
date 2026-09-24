import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../shared/ui/button/button';
import { PermissionsService } from '../../core/auth/permissions.service';
import { problemDetail } from '../../core/http-error';
import { ChecklistsService, ChecklistTemplate, Handover, ShiftCheck } from '../../core/checklists/checklists.service';
import {
  CONDITION_COLOR_VAR,
  CONDITION_LABELS,
  Matrix,
  PublicShare,
  ShiftsService,
  TeleworkCondition,
  WorkShift,
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
  imports: [FormsModule, DatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shifts.html',
  styleUrl: './shifts.css',
})
export class ShiftsComponent implements OnInit {
  protected readonly conditionLabels = CONDITION_LABELS;
  protected readonly conditionColorVar = CONDITION_COLOR_VAR;
  protected readonly conditions = ALL_CONDITIONS;

  private readonly api = inject(ShiftsService);
  private readonly checklistsApi = inject(ChecklistsService);
  private readonly destroyRef = inject(DestroyRef);
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
  protected readonly checklistTemplates = signal<ChecklistTemplate[]>([]);
  protected readonly selectedTemplate = signal<ChecklistTemplate | null>(null);
  protected readonly workShifts = signal<WorkShift[]>([]);
  protected readonly selectedWorkShiftId = signal('');
  protected readonly checkType = signal<'inicio' | 'cierre'>('inicio');
  protected readonly checklistTouched = signal(false);
  protected readonly lastCheck = signal<ShiftCheck | null>(null);
  protected closureObservations = '';
  protected pendingForNextShift = '';
  protected notifyEmail = false;
  protected syncGlpi = false;
  protected readonly checklistLoading = signal(false);
  protected readonly checklistSaved = signal<string | null>(null);
  protected readonly handover = signal<Handover | null>(null);
  protected readonly handoverLoading = signal(false);
  protected readonly checkValues: Record<string, { status: 'verde' | 'rojo'; observation: string }> = {};

  protected readonly weekLabel = computed(() => {
    const m = this.matrix();
    if (!m || m.columns.length === 0) return '';
    return `${m.columns[0].date} — ${m.columns[m.columns.length - 1].date}`;
  });

  protected todayLabel(matrix: Matrix): string {
    return matrix.columns.find((column) => column.isToday)?.date ?? matrix.columns[0]?.date ?? '';
  }

  async ngOnInit(): Promise<void> {
    await this.perms.load();
    await Promise.all([this.loadMatrix(), this.loadChecklist()]);
    this.destroyRef.onDestroy(() => {
      if (this.checklistTouched() && !this.checklistSaved()) void this.checklistsApi.abandoned();
    });
  }

  private async loadChecklist(): Promise<void> {
    this.checklistLoading.set(true);
    try {
      const [templates, shifts] = await Promise.all([this.checklistsApi.activeTemplates(), this.api.listWorkShifts(true)]);
      this.checklistTemplates.set(templates);
      this.workShifts.set(shifts);
      this.selectedTemplate.set(templates[0] ?? null);
      this.selectedWorkShiftId.set(shifts[0]?.id ?? '');
      this.resetCheckValues(templates[0]);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron cargar los checklists.'));
    } finally {
      this.checklistLoading.set(false);
    }
  }

  protected selectTemplate(id: string): void {
    const template = this.checklistTemplates().find(item => item.id === id) ?? null;
    this.selectedTemplate.set(template);
    this.resetCheckValues(template);
  }

  private resetCheckValues(template: ChecklistTemplate | null): void {
    for (const key of Object.keys(this.checkValues)) delete this.checkValues[key];
    for (const item of template?.items ?? []) {
      if (!item.parentItemId) this.checkValues[item.id] = { status: 'verde', observation: '' };
    }
  }

  protected isLeaf(itemId: string): boolean {
    return !this.selectedTemplate()?.items.some(item => item.parentItemId === itemId);
  }

  protected async submitChecklist(): Promise<void> {
    const template = this.selectedTemplate();
    if (!template || !this.selectedWorkShiftId()) return;
    this.checklistLoading.set(true);
    this.error.set(null);
    try {
      const services = template.items.filter(item => this.isLeaf(item.id)).map(item => ({ checklistItemId: item.id, serviceTitle: item.title, status: this.checkValues[item.id].status, observation: this.checkValues[item.id].observation }));
      this.lastCheck.set(await this.checklistsApi.create({ checklistTemplateId: template.id, workShiftId: this.selectedWorkShiftId(), checkType: this.checkType(), services }));
      this.checklistSaved.set(`Checklist de ${this.checkType()} guardado.`);
      this.checklistTouched.set(false);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo guardar el checklist.'));
    } finally {
      this.checklistLoading.set(false);
    }
  }

  protected markChecklistTouched(): void { this.checklistTouched.set(true); }

  protected async closeShift(): Promise<void> {
    const check = this.lastCheck();
    if (!check || check.checkType !== 'cierre') return;
    this.checklistLoading.set(true);
    try {
      await this.checklistsApi.close({ closureCheckId: check.id, observations: this.closureObservations, pendingForNextShift: this.pendingForNextShift, notifyEmail: this.notifyEmail, syncGlpi: this.syncGlpi });
      this.checklistSaved.set('Cierre de turno guardado.');
    } catch (error) { this.error.set(problemDetail(error, 'No se pudo cerrar el turno.')); } finally { this.checklistLoading.set(false); }
  }

  protected async loadHandover(): Promise<void> {
    this.handoverLoading.set(true);
    try { this.handover.set(await this.checklistsApi.handover()); } catch (error) { this.error.set(problemDetail(error, 'No se pudo cargar el relevo.')); } finally { this.handoverLoading.set(false); }
  }

  protected async acknowledgeHandover(): Promise<void> {
    const closure = this.handover()?.previousClosure;
    if (!closure) return;
    try { await this.checklistsApi.acknowledge(closure.id); await this.loadHandover(); } catch (error) { this.error.set(problemDetail(error, 'No se pudo confirmar el relevo.')); }
  }

  private async loadMatrix(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const from = isoDate(this.weekStart());
      const to = isoDate(new Date(this.weekStart().getTime() + 12 * 86_400_000));
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
