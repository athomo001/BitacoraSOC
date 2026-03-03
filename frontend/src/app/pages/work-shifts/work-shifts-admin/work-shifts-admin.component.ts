import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { WorkShiftService } from '../../../services/work-shift.service';
import { AuthService } from '../../../services/auth.service';
import { ConfigService } from '../../../services/config.service';
import { ChecklistService } from '../../../services/checklist.service';
import { UserService } from '../../../services/user.service';
import { WorkShift, WorkShiftFormData, SHIFT_TYPE_OPTIONS, DEFAULT_COLORS } from '../../../models/work-shift.model';

@Component({
  selector: 'app-work-shifts-admin',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
      FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatChipsModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatDividerModule
  ],
  templateUrl: './work-shifts-admin.component.html',
  styleUrls: ['./work-shifts-admin.component.scss']
})
export class WorkShiftsAdminComponent implements OnInit {
  shifts: WorkShift[] = [];
  users: any[] = [];
  operationalRows: Array<{
    shiftId: string;
    userId: string;
    analystName: string;
    shiftName: string;
    schedule: string;
    weekdaysLabel: string;
    status: 'EN_TURNO' | 'FUERA_DE_TURNO';
  }> = [];
  checklistTemplates: any[] = [];
  
  loading = false;
  showForm = false;
  editingShift: WorkShift | null = null;
  
  shiftForm!: FormGroup;
  operationalAssignmentForm!: FormGroup;
  globalEmailForm!: FormGroup;  // Formulario GLOBAL para Reenvío
  shiftTypeOptions = SHIFT_TYPE_OPTIONS;
  colorOptions = DEFAULT_COLORS;
  
  // Manejo de chips de emails (GLOBAL)
  emailInput = '';
  showGlobalEmailConfig = false;
  
  displayedColumns: string[] = ['order', 'name', 'code', 'type', 'timeRange', 'checklists', 'assignedUser', 'active', 'actions'];

  constructor(
    private workShiftService: WorkShiftService,
    private configService: ConfigService,
    private checklistService: ChecklistService,
    private userService: UserService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    this.initForm();
    this.initOperationalAssignmentForm();
    this.initGlobalEmailForm();  // Inicializar una sola vez aquí
  }

  ngOnInit(): void {
    this.loadShifts();
    this.loadUsers();
    this.loadChecklistTemplates();
    this.loadGlobalEmailConfig();
  }

  initForm(): void {
    this.shiftForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      code: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(/^[A-Z0-9_]+$/)]],
      description: ['', Validators.maxLength(500)],
      type: ['regular', Validators.required],
      startTime: ['09:00', [Validators.required, Validators.pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)]],
      endTime: ['18:00', [Validators.required, Validators.pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)]],
      timezone: ['America/Santiago', Validators.required],
      assignedUserId: [null],
      checklistTemplateId: [null],
      checklistTemplateStartId: [null],
      checklistTemplateEndId: [null],
      order: [0, Validators.min(0)],
      active: [true],
      color: [DEFAULT_COLORS[0]]
    });
  }

  initGlobalEmailForm(): void {
    // Formulario GLOBAL para Reenvío de Información - NUNCA se reinicia
    this.globalEmailForm = this.fb.group({
      enabled: [false],
      includeChecklist: [true],
      includeEntries: [true],
      recipients: [[]],
      subjectTemplate: ['Reporte SOC [fecha] [turno]'],
      reportTableColor: ['#4CAF50']
    });
  }

  initOperationalAssignmentForm(): void {
    this.operationalAssignmentForm = this.fb.group({
      shiftId: [null, Validators.required],
      userId: [null, Validators.required]
    });
  }

  loadGlobalEmailConfig(): void {
    // Cargar configuración global de email desde BD
    this.configService.getConfig().subscribe({
      next: (config: any) => {
        if (config && config.emailReportConfig) {
          this.globalEmailForm.patchValue({
            enabled: config.emailReportConfig.enabled || false,
            includeChecklist: config.emailReportConfig.includeChecklist ?? true,
            includeEntries: config.emailReportConfig.includeEntries ?? true,
            recipients: config.emailReportConfig.recipients || [],
            subjectTemplate: config.emailReportConfig.subjectTemplate || 'Reporte SOC [fecha] [turno]',
            reportTableColor: config.emailReportConfig.reportTableColor || '#4CAF50'
          });
        }
      },
      error: (error: any) => {
        console.error('Error loading global email config:', error);
        // No mostrar error al usuario, solo usar valores por defecto
      }
    });
  }

  loadShifts(): void {
    this.loading = true;
    this.workShiftService.getShifts().subscribe({
      next: (shifts) => {
        this.shifts = shifts;
        this.rebuildOperationalRows();
        this.loading = false;
      },
      error: (error: any) => {
        console.error('Error loading shifts:', error);
        this.snackBar.open('Error al cargar turnos', 'Cerrar', { duration: 3000 });
        this.loading = false;
      }
    });
  }

  loadUsers(): void {
    this.userService.getUsersList().subscribe({
      next: (users) => {
        this.users = (users || []).filter((user: any) => user?.isActive !== false && user?.role !== 'guest');
        this.rebuildOperationalRows();
      },
      error: (error: any) => {
        console.error('Error loading users:', error);
        this.users = [];
        this.rebuildOperationalRows();
        this.snackBar.open('No se pudieron cargar usuarios para asignación operativa', 'Cerrar', { duration: 3000 });
      }
    });
  }

  private rebuildOperationalRows(): void {
    this.operationalRows = this.shifts.flatMap((shift: WorkShift) => {
      const assignedIds = this.getAssignedUserIds(shift);
      return assignedIds.map((userId) => ({
        shiftId: shift._id,
        userId,
        analystName: this.getAssignedAnalystName(shift, userId),
        shiftName: shift.name,
        schedule: this.formatTimeRange(shift),
        weekdaysLabel: this.getWeekdaysLabel(shift),
        status: this.isShiftActiveNow(shift) ? 'EN_TURNO' : 'FUERA_DE_TURNO'
      }));
    });
  }

  private getAssignedUserIds(shift: WorkShift): string[] {
    const fromArray = Array.isArray((shift as any).assignedUserIds)
      ? (shift as any).assignedUserIds
          .map((value: any) => this.getObjectId(value))
          .filter((value: string | null): value is string => Boolean(value))
      : [];

    if (fromArray.length > 0) {
      return Array.from(new Set(fromArray));
    }

    const single = this.getObjectId((shift as any).assignedUserId);
    return single ? [single] : [];
  }

  private getAssignedAnalystName(shift: WorkShift, userId: string): string {
    const fromShiftArray = Array.isArray((shift as any).assignedUserIds)
      ? (shift as any).assignedUserIds.find((value: any) => this.getObjectId(value) === userId)
      : null;

    if (fromShiftArray && typeof fromShiftArray === 'object' && (fromShiftArray.fullName || fromShiftArray.email)) {
      return fromShiftArray.fullName || fromShiftArray.email;
    }

    const fromLoadedUsers = this.users.find((u: any) => String(u._id) === userId);
    if (fromLoadedUsers?.fullName) {
      return fromLoadedUsers.fullName;
    }

    return 'Usuario asignado';
  }

  private getWeekdaysLabel(shift: WorkShift): string {
    return shift.type === 'regular' ? 'Lun-Vie' : 'Lun-Dom';
  }

  private hhmmToMinutes(value: string): number {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return ((Number.isFinite(hours) ? hours : 0) * 60) + (Number.isFinite(minutes) ? minutes : 0);
  }

  private isShiftActiveNow(shift: WorkShift): boolean {
    if (!shift?.active) {
      return false;
    }

    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    if (shift.type === 'regular' && isWeekend) {
      return false;
    }

    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const startMinutes = this.hhmmToMinutes(shift.startTime);
    const endMinutes = this.hhmmToMinutes(shift.endTime);

    if (startMinutes === endMinutes) {
      return true;
    }

    if (endMinutes > startMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }

    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  getOperationalStatusClass(status: 'EN_TURNO' | 'FUERA_DE_TURNO'): string {
    return status === 'EN_TURNO' ? 'badge-operational-on' : 'badge-operational-off';
  }

  getOperationalStatusLabel(status: 'EN_TURNO' | 'FUERA_DE_TURNO'): string {
    return status === 'EN_TURNO' ? 'EN TURNO' : 'FUERA DE TURNO';
  }

  refreshOperationalStatus(): void {
    this.rebuildOperationalRows();
  }

  saveOperationalAssignment(): void {
    if (this.operationalAssignmentForm.invalid) {
      this.operationalAssignmentForm.markAllAsTouched();
      return;
    }

    const shiftId = this.operationalAssignmentForm.value.shiftId;
    const userId = this.operationalAssignmentForm.value.userId;

    const targetShift = this.shifts.find((shift) => shift._id === shiftId);
    if (!targetShift) {
      this.snackBar.open('No se encontró el turno seleccionado', 'Cerrar', { duration: 3000 });
      return;
    }

    const currentAssigned = this.getAssignedUserIds(targetShift);
    if (currentAssigned.includes(String(userId))) {
      this.snackBar.open('Ese analista ya está vinculado a este turno', 'Cerrar', { duration: 2500 });
      return;
    }

    const updatedAssigned = [...currentAssigned, String(userId)];

    this.workShiftService.updateShift(shiftId, {
      assignedUserIds: updatedAssigned,
      assignedUserId: updatedAssigned[0] || null
    }).subscribe({
      next: () => {
        this.snackBar.open('Asignación operativa guardada', 'Cerrar', { duration: 2500 });
        this.operationalAssignmentForm.reset({ shiftId: null, userId: null });
        this.loadShifts();
      },
      error: (error: any) => {
        console.error('Error saving operational assignment:', error);
        this.snackBar.open(error?.error?.error || 'Error al guardar asignación operativa', 'Cerrar', { duration: 3000 });
      }
    });
  }

  unlinkOperationalAssignment(row: { shiftId: string; userId: string; analystName: string }): void {
    const targetShift = this.shifts.find((shift) => shift._id === row.shiftId);
    if (!targetShift) {
      this.snackBar.open('No se encontró el turno seleccionado', 'Cerrar', { duration: 3000 });
      return;
    }

    const currentAssigned = this.getAssignedUserIds(targetShift);
    const updatedAssigned = currentAssigned.filter((id) => id !== row.userId);

    this.workShiftService.updateShift(row.shiftId, {
      assignedUserIds: updatedAssigned,
      assignedUserId: updatedAssigned[0] || null
    }).subscribe({
      next: () => {
        this.snackBar.open(`Analista desvinculado: ${row.analystName}`, 'Cerrar', { duration: 2500 });
        this.loadShifts();
      },
      error: (error: any) => {
        console.error('Error unlinking operational assignment:', error);
        this.snackBar.open(error?.error?.error || 'Error al desvincular analista', 'Cerrar', { duration: 3000 });
      }
    });
  }

  loadChecklistTemplates(): void {
    this.checklistService.getTemplates().subscribe({
      next: (templates: any[]) => {
        this.checklistTemplates = templates || [];
      },
      error: (error: any) => {
        console.error('Error loading checklist templates:', error);
        this.checklistTemplates = [];
        this.snackBar.open('No se pudieron cargar plantillas de checklist', 'Cerrar', { duration: 3000 });
      }
    });
  }

  private getObjectId(value: any): string | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && value._id) {
      return String(value._id);
    }
    return null;
  }

  private getTemplateName(value: any, fallbackName?: string): string | null {
    if (fallbackName) {
      return fallbackName;
    }

    if (value && typeof value === 'object' && value.name) {
      return String(value.name);
    }

    const id = this.getObjectId(value);
    if (!id) {
      return null;
    }

    const found = this.checklistTemplates.find((tpl: any) => String(tpl._id) === id);
    return found?.name || null;
  }

  getChecklistSummary(shift: WorkShift): string {
    const startName = this.getTemplateName((shift as any).checklistTemplateStartId, (shift as any).checklistTemplateStartName);
    const endName = this.getTemplateName((shift as any).checklistTemplateEndId, (shift as any).checklistTemplateEndName);

    return `Inicio: ${startName || 'Ninguno'} | Cierre: ${endName || 'Ninguno'}`;
  }

  addShift(): void {
    this.editingShift = null;
    this.initForm();
    this.showForm = true;
  }

  editShift(shift: WorkShift): void {
    this.editingShift = shift;
    this.shiftForm.patchValue({
      name: shift.name,
      code: shift.code,
      description: shift.description || '',
      type: shift.type,
      startTime: shift.startTime,
      endTime: shift.endTime,
      timezone: shift.timezone,
      assignedUserId: this.getObjectId((shift as any).assignedUserId),
      checklistTemplateId: this.getObjectId((shift as any).checklistTemplateId),
      checklistTemplateStartId: this.getObjectId((shift as any).checklistTemplateStartId),
      checklistTemplateEndId: this.getObjectId((shift as any).checklistTemplateEndId),
      order: shift.order,
      active: shift.active,
      color: shift.color || DEFAULT_COLORS[0]
    });
    this.showForm = true;
  }

  deleteShift(shift: WorkShift): void {
    if (!confirm(`¿Eliminar turno "${shift.name}"?`)) {
      return;
    }

    this.workShiftService.deleteShift(shift._id).subscribe({
      next: () => {
        this.snackBar.open('Turno eliminado', 'Cerrar', { duration: 3000 });
        this.loadShifts();
      },
      error: (error: any) => {
        console.error('Error deleting shift:', error);
        this.snackBar.open('Error al eliminar turno', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveShift(): void {
    if (this.shiftForm.invalid) {
      this.shiftForm.markAllAsTouched();
      return;
    }

    const formData: WorkShiftFormData = this.shiftForm.value;
    
    // Convertir código a mayúsculas
    formData.code = formData.code.toUpperCase();

    // Email config is now global. Inherit from global settings.
    formData.emailReportConfig = this.globalEmailForm.value;

    const operation = this.editingShift
      ? this.workShiftService.updateShift(this.editingShift._id, formData)
      : this.workShiftService.createShift(formData);

    operation.subscribe({
      next: () => {
        this.snackBar.open(
          this.editingShift ? 'Turno actualizado' : 'Turno creado',
          'Cerrar',
          { duration: 3000 }
        );
        this.cancelForm();
        this.loadShifts();
      },
      error: (error: any) => {
        console.error('Error saving shift:', error);
        this.snackBar.open(
          error.error?.error || 'Error al guardar turno',
          'Cerrar',
          { duration: 3000 }
        );
      }
    });
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingShift = null;
    this.initForm();  // Solo reiniciar el formulario de turnos, NO el global
  }

  getTypeLabel(type: string): string {
    return type === 'regular' ? 'Regular' : 'Emergencia';
  }

  getTypeBadgeClass(type: string): string {
    return type === 'regular' ? 'badge-regular' : 'badge-emergency';
  }

  formatTimeRange(shift: WorkShift): string {
    return this.workShiftService.formatTimeRange(shift.startTime, shift.endTime);
  }

  getUserName(shift: WorkShift): string {
    const assignedIds = this.getAssignedUserIds(shift);
    if (assignedIds.length === 0) {
      return 'Sin asignar';
    }

    if (assignedIds.length === 1) {
      return this.getAssignedAnalystName(shift, assignedIds[0]);
    }

    return `${assignedIds.length} asignados`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Manejo de Reenvío de Información GLOBAL
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  get recipients() {
    return this.globalEmailForm.get('recipients') as any;
  }

  toggleGlobalEmailConfig(): void {
    this.showGlobalEmailConfig = !this.showGlobalEmailConfig;
  }

  addEmail(event: Event): void {
    event.preventDefault();
    const input = this.emailInput.trim().toLowerCase();
    
    if (!input) return;

    // Validar formato email básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input)) {
      this.snackBar.open('Email inválido', 'Cerrar', { duration: 2000 });
      return;
    }

    const currentEmails = this.recipients.value || [];
    
    if (currentEmails.includes(input)) {
      this.snackBar.open('Email ya agregado', 'Cerrar', { duration: 2000 });
      return;
    }

    this.recipients.setValue([...currentEmails, input]);
    this.emailInput = '';
  }

  removeEmail(email: string): void {
    const currentEmails = this.recipients.value || [];
    this.recipients.setValue(currentEmails.filter((e: string) => e !== email));
  }

  onEmailKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addEmail(event);
    }
  }

  saveGlobalEmailConfig(): void {
    if (this.globalEmailForm.invalid) {
      this.globalEmailForm.markAllAsTouched();
      return;
    }

    // Obtener configuración global
    const globalConfig = this.globalEmailForm.value;
    
    // 1. Guardar en BD (AppConfig)
    this.configService.updateConfig({ emailReportConfig: globalConfig }).subscribe({
      next: () => {
        // 2. Aplicar a todos los turnos existentes
        if (this.shifts.length > 0) {
          this.shifts.forEach(shift => {
            shift.emailReportConfig = {
              ...shift.emailReportConfig,
              ...globalConfig
            };
          });

          // Guardar cada turno con la nueva configuración
          const updatePromises = this.shifts.map(shift =>
            this.workShiftService.updateShift(shift._id, {
              emailReportConfig: shift.emailReportConfig
            }).toPromise()
          );

          Promise.all(updatePromises).then(() => {
            this.snackBar.open('Configuración de reenvío guardada y aplicada a todos los turnos', 'Cerrar', { duration: 3000 });
            this.showGlobalEmailConfig = false;
          }).catch((error: any) => {
            console.error('Error updating shifts:', error);
            this.snackBar.open('Error al aplicar configuración a turnos', 'Cerrar', { duration: 3000 });
          });
        } else {
          this.snackBar.open('Configuración de reenvío guardada. Se aplicará a nuevos turnos', 'Cerrar', { duration: 3000 });
          this.showGlobalEmailConfig = false;
        }
      },
      error: (error: any) => {
        console.error('Error saving email config:', error);
        this.snackBar.open('Error al guardar configuración', 'Cerrar', { duration: 3000 });
      }
    });
  }
}
