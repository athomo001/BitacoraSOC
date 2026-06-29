/**
 * File Purpose: frontend/src/app/pages/work-shifts/work-shifts-admin/work-shifts-admin.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
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
import { MatTabsModule } from '@angular/material/tabs';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { Observable, Subscription, interval, Subject, forkJoin, of } from 'rxjs';
import { startWith, takeUntil, map, catchError, take } from 'rxjs/operators';
import { WorkShiftService } from '../../../services/work-shift.service';
import { AuthService } from '../../../services/auth.service';
import { ConfigService } from '../../../services/config.service';
import { ChecklistService } from '../../../services/checklist.service';
import { UserService } from '../../../services/user.service';
import { CatalogService } from '../../../services/catalog.service';
import { EscalationService } from '../../../services/escalation.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { WorkShift, WorkShiftFormData, SHIFT_TYPE_OPTIONS, DEFAULT_COLORS } from '../../../models/work-shift.model';
import { isShiftActiveNow } from '../../../utils/shift-time.util';
import { resolverCondicionVisible } from '../../../utils/work-shift-priority.util';

@Component({
  selector: 'app-work-shifts-admin',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
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
    MatDividerModule,
    MatTabsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatExpansionModule,
    MatAutocompleteModule
  ],
  templateUrl: './work-shifts-admin.component.html',
  styleUrls: ['./work-shifts-admin.component.scss']
})
export class WorkShiftsAdminComponent implements OnInit, OnDestroy {
  // Turnos Operativos Diarios
  shifts: WorkShift[] = [];
  users: any[] = [];
  assignments: any[] = [];
  operationalRows: Array<{
    assignmentId: string;
    shiftId: string;
    userId: string;
    analystName: string;
    shiftName: string;
    schedule: string;
    weekdaysLabel: string;
    status: 'EN_TURNO' | 'FUERA_DE_TURNO';
    weekdays: number[];
    shiftRef: any;
  }> = [];
  checklistTemplates: any[] = [];
  loading = false;
  showForm = false;
  editingShift: WorkShift | null = null;
  shiftForm!: FormGroup;
  operationalAssignmentForm!: FormGroup;
  globalEmailForm!: FormGroup;
  shiftTypeOptions = SHIFT_TYPE_OPTIONS;
  colorOptions = DEFAULT_COLORS;
  emailInput = '';
  showGlobalEmailConfig = false;
  selectedPocShiftId: string | null = null;
  sendingPoc = false;
  displayedColumns: string[] = ['order', 'name', 'code', 'type', 'timeRange', 'checklists', 'assignedUser', 'active', 'actions'];

  // Turnos Semanales (Asignación)
  weeklyAssignments: any[] = [];
  currentMonthAssignments: any[] = [];
  futureAssignments: any[] = [];
  previousMonthAssignments: any[] = [];
  historicalAssignments: any[] = [];
  loadingWeeklyAssignments = false;
  loadingHistoricalAssignments = false;
  savingWeeklyAssignment = false;
  importingAssignmentsCsv = false;
  downloadingAssignmentTemplate = false;
  historicalLoaded = false;
  showHistorical = false;
  showAssignmentForm = false;
  assignmentForm!: FormGroup;
  filteredUsersForAssignment: any[] = [];
  filteredExternalPeopleForAssignment: any[] = [];
  filteredDirectoryContactsForAssignment: DirectoryContact[] = [];
  showExternalPeopleForAssignment = true;
  // Lista de condiciones admitidas (operativas y administrativas)
  roles = ['N2', 'TI', 'N1_NO_HABIL', 'TELEWORK', 'OL', 'VACATION', 'MEDICAL_LEAVE', 'MEDICAL_APPOINTMENT'];
  editingWeeklyAssignmentId: string | null = null;

  // Filtros de asignación semanal
  filterAnalyst = '';
  filterRole = '';

  // Eje de Tiempo Gantt Semanal
  ganttWeekStart!: Date;
  ganttWeekEnd!: Date;
  ganttTodayPosition = 0;
  ganttTodayLabel = 'Día Actual';
  ganttRoles: any[] = [];
  ganttGridLines: number[] = [];
  ganttTicks: { label: string; position: number; isToday: boolean }[] = [];
  private serverReferenceMs = 0;
  private monotonicAtSyncMs = 0;
  private hasServerClock = false;

  // Tarjetas de Proximidad Semanales
  upcomingEndAssignments: any[] = [];
  upcomingStartAssignments: any[] = [];

  // Recordatorios Escalamiento Semanal
  escalationReminderForm!: FormGroup;
  availableCargoLabels: string[] = [];
  readonly defaultReminderCargoLabels: string[] = [
    'N1', 'N2', 'N3', 'QA Nivel 1', 'QA Nivel 2', 'Pentester N1', 'Pentester N2',
    'Arquitecto SIEM', 'Customer Success Manager (CSM)', 'Jefe Área', 'Gerente Área'
  ];
  loadingEscalationReminderConfig = false;
  savingEscalationReminderConfig = false;
  testingEscalationReminder = false;
  
  // Automatización de Envío (Múltiples Programaciones)
  notificationSchedules: any[] = [];
  showScheduleForm = false;
  editingScheduleId: string | null = null;
  savingSchedule = false;
  triggeringScheduleSend = false;
  testRecipientEmail = '';
  scheduleForm!: FormGroup;
  loadingAutomationConfig = false;
  savingAutomationConfig = false;
  triggeringManualSend = false;
  daysOfWeek = [
    { value: 1, label: 'Lunes' },
    { value: 2, label: 'Martes' },
    { value: 3, label: 'Miércoles' },
    { value: 4, label: 'Jueves' },
    { value: 5, label: 'Viernes' },
    { value: 6, label: 'Sábado' },
    { value: 0, label: 'Domingo' }
  ];
  automationRecipientSuggestions: DirectoryContact[] = [];
  automationCcSuggestions: DirectoryContact[] = [];
  private _recipientsRaw = '';
  private _ccRaw = '';

  // Personas externas
  externalPeople: any[] = [];
  loadingExternalPeople = false;
  showExternalPersonForm = false;
  externalPersonForm!: FormGroup;
  editingExternalPersonId: string | null = null;
  externalPersonDirectorySuggestions: DirectoryContact[] = [];
  private externalPersonNameSearchTimer?: any;

  // Directory Quick Picker
  directoryQuickPickerVisible = false;
  directoryQuickPickerQuery = '';
  directoryQuickPickerSuggestions: DirectoryContact[] = [];
  directoryQuickPickerTarget: 'external' | null = null;
  private directoryQuickPickerTimer?: any;
  directoryContacts: DirectoryContact[] = [];
  private internalClientCompanyKeys = new Set<string>();

  // Alertas de conflicto en el Editor Lateral
  roleConflictMsg: string | null = null;
  personConflictMsg: string | null = null;
  rangeErrorMsg: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private workShiftService: WorkShiftService,
    private configService: ConfigService,
    private checklistService: ChecklistService,
    private userService: UserService,
    private catalogService: CatalogService,
    private escalationService: EscalationService,
    private directoryService: DirectoryService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {
    this.initForm();
    this.initOperationalAssignmentForm();
    this.initGlobalEmailForm();
    this.initWeeklyForms();
  }

  ngOnInit(): void {
    this.loadData();
    this.loadChecklistTemplates();

    // Refresco en vivo cada minuto para el estado de turnos operativos (startWith(0) ejecuta la primera llamada al inicio)
    interval(60000)
      .pipe(startWith(0), takeUntil(this.destroy$))
      .subscribe(() => {
        this.syncServerClock();
        this.recalculateLiveStatus();
        this.calculateGantt();
        this.calculateProximityCards();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.externalPersonNameSearchTimer) clearTimeout(this.externalPersonNameSearchTimer);
    if (this.directoryQuickPickerTimer) clearTimeout(this.directoryQuickPickerTimer);
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
      userId: [null, Validators.required],
      weekdays: [[]]
    });
  }

  initWeeklyForms(): void {
    this.assignmentForm = this.fb.group({
      roleCode: ['', Validators.required],
      assignedUserId: ['', Validators.required],
      weekStartDate: ['', Validators.required],
      weekEndDate: ['', Validators.required],
      startTime: ['09:00', Validators.required],
      endTime: ['08:59', Validators.required]
    });

    this.assignmentForm.get('roleCode')?.valueChanges.subscribe(() => {
      this.updateAssignmentPeopleOptions();
      this.checkAssignmentConflicts();
    });

    this.assignmentForm.get('assignedUserId')?.valueChanges.subscribe(() => {
      this.checkAssignmentConflicts();
    });

    this.assignmentForm.get('weekStartDate')?.valueChanges.subscribe((startDate) => {
      if (startDate) {
        const start = new Date(startDate);
        const endDate = new Date(start);
        endDate.setDate(endDate.getDate() + 7);
        this.assignmentForm.patchValue({ weekEndDate: endDate }, { emitEvent: false });
      }
      this.checkAssignmentConflicts();
    });

    this.assignmentForm.get('weekEndDate')?.valueChanges.subscribe(() => {
      this.checkAssignmentConflicts();
    });

    this.assignmentForm.get('startTime')?.valueChanges.subscribe(() => {
      this.checkAssignmentConflicts();
    });

    this.assignmentForm.get('endTime')?.valueChanges.subscribe(() => {
      this.checkAssignmentConflicts();
    });

    this.externalPersonForm = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      position: [''],
      active: [true]
    });

    this.escalationReminderForm = this.fb.group({
      escalationReminderEnabled: [false],
      escalationReminderCargoLabels: [['N2']],
      escalationReminderDaysAhead: [7, [Validators.required, Validators.min(1), Validators.max(60)]]
    });

    this.escalationReminderForm.get('escalationReminderEnabled')?.valueChanges.subscribe(() => {
      this.updateEscalationReminderValidators();
    });
    this.updateEscalationReminderValidators();

    this.scheduleForm = this.fb.group({
      name: ['', Validators.required],
      enabled: [true],
      frequency: ['weekly'],
      dayOfWeek: [1],
      time: ['09:00', [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      recipients: ['', Validators.required],
      ccRecipients: [''],
      includeGuard: [true],
      includeTelework: [false],
      includeOl: [false],
      includeVacation: [false],
      includeMedicalLeave: [false],
      includeMedicalAppointment: [false]
    });
  }

  loadData(): void {
    this.loading = true;

    Promise.all([
      this.workShiftService.getShifts().toPromise(),
      this.userService.getUsersList().toPromise(),
      this.workShiftService.getAssignments().toPromise(),
      this.escalationService.getExternalPeople().toPromise(),
      this.directoryService.getAll().toPromise(),
      this.catalogService.getAllLogSources().toPromise()
    ]).then(([shifts, users, assignments, externalPeople, directoryContacts, logSourcesResponse]) => {
      this.shifts = shifts || [];
      this.users = (users || []).filter((user: any) => user?.isActive !== false && user?.role !== 'guest');
      this.assignments = assignments || [];
      this.externalPeople = externalPeople || [];
      this.directoryContacts = directoryContacts || [];
      this.internalClientCompanyKeys = this.buildInternalClientCompanyKeys(logSourcesResponse);

      this.ensurePocShiftSelection();
      this.rebuildOperationalRows();
      this.loadGlobalEmailConfig();

      this.refreshAvailableCargoLabels();
      this.updateAssignmentPeopleOptions();
      
      this.loadWeeklyAssignments();
      this.loadEscalationReminderConfig();
      this.loadNotificationSchedules();

      this.loading = false;
      this.cdr.detectChanges();
    }).catch(error => {
      console.error('Error loading data:', error);
      this.snackBar.open('Error al cargar datos operativos', 'Cerrar', { duration: 3000 });
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  loadShifts(): void {
    this.workShiftService.getShifts().subscribe({
      next: (shifts) => {
        this.shifts = shifts;
        this.ensurePocShiftSelection();
        this.rebuildOperationalRows();
      }
    });
  }

  loadAssignments(): void {
    this.workShiftService.getAssignments().subscribe({
      next: (assignments) => {
        this.assignments = assignments;
        this.rebuildOperationalRows();
      }
    });
  }

  loadGlobalEmailConfig(): void {
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
      }
    });
  }

  // ============ TURNOS OPERATIVOS DIARIOS ============
  private rebuildOperationalRows(): void {
    this.operationalRows = this.assignments
      .filter(asg => asg.active !== false && asg.workShiftId)
      .map(asg => {
        const shiftId = typeof asg.workShiftId === 'object' ? asg.workShiftId._id : asg.workShiftId;
        const userId = typeof asg.userId === 'object' ? asg.userId._id : asg.userId;
        const analystName = typeof asg.userId === 'object' ? asg.userId.fullName : this.getLoadedUserName(userId);
        const shiftData = typeof asg.workShiftId === 'object' ? asg.workShiftId : this.shifts.find(s => s._id === shiftId);

        return {
          assignmentId: asg._id,
          shiftId: shiftId,
          userId: userId,
          analystName: analystName,
          shiftName: shiftData?.name || 'Turno desconocido',
          schedule: shiftData ? this.formatTimeRange(shiftData as any) : '-',
          weekdaysLabel: this.getWeekdaysLabel(asg.weekdays),
          weekdays: asg.weekdays || [],
          shiftRef: shiftData,
          status: 'FUERA_DE_TURNO'
        };
      });

    this.recalculateLiveStatus();
  }

  private recalculateLiveStatus(): void {
    this.operationalRows.forEach(row => {
      if (row.shiftRef) {
        const isActive = isShiftActiveNow(row.shiftRef.startTime, row.shiftRef.endTime, row.weekdays);
        row.status = isActive ? 'EN_TURNO' : 'FUERA_DE_TURNO';
      }
    });
  }

  private getLoadedUserName(userId: string): string {
    const fromLoadedUsers = this.users.find((u: any) => String(u._id) === userId);
    if (fromLoadedUsers?.fullName) {
      return fromLoadedUsers.fullName;
    }
    return 'Usuario asignado';
  }

  /**
   * Obtiene una etiqueta descriptiva en español para los días de la semana asignados.
   */
  getWeekdaysLabel(weekdays: number[]): string {
    if (!weekdays || weekdays.length === 0) return 'Sin días';
    if (weekdays.length === 7) return 'Lun-Dom (Todos)';

    const isMonToFri = weekdays.length === 5 &&
      [1, 2, 3, 4, 5].every(d => weekdays.includes(d));
    if (isMonToFri) return 'Lun-Vie';

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return weekdays.sort((a, b) => a - b).map(d => dayNames[d]).join(', ');
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

    const payload = {
      shiftId: this.operationalAssignmentForm.value.shiftId,
      userId: this.operationalAssignmentForm.value.userId,
      workShiftId: this.operationalAssignmentForm.value.shiftId,
      weekdays: this.operationalAssignmentForm.value.weekdays
    };

    if (!payload.weekdays || payload.weekdays.length === 0) {
      payload.weekdays = [1, 2, 3, 4, 5];
    }

    this.workShiftService.createAssignment(payload).subscribe({
      next: () => {
        this.snackBar.open('Asignación operativa guardada', 'Cerrar', { duration: 2500 });
        this.operationalAssignmentForm.reset({ shiftId: null, userId: null, weekdays: [] });
        this.loadAssignments();
      },
      error: (error: any) => {
        console.error('Error saving operational assignment:', error);
        this.snackBar.open(error?.error?.error || 'Error al guardar asignación', 'Cerrar', { duration: 5000 });
      }
    });
  }

  unlinkOperationalAssignment(row: any): void {
    if (!confirm(`¿Desvincular a ${row.analystName} de este turno?`)) {
      return;
    }

    this.workShiftService.deleteAssignment(row.assignmentId).subscribe({
      next: () => {
        this.snackBar.open(`Analista desvinculado: ${row.analystName}`, 'Cerrar', { duration: 2500 });
        this.loadAssignments();
      },
      error: (error: any) => {
        console.error('Error unlinking operational assignment:', error);
        this.snackBar.open(error?.error?.error || 'Error al desvincular analista', 'Cerrar', { duration: 3000 });
      }
    });
  }

  // ============ TURNOS SEMANALES ============
  loadWeeklyAssignments(): void {
    this.loadingWeeklyAssignments = true;
    const currentDate = new Date();
    const fromDate = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1).toISOString();

    // Usa ruta admin para que el administrador obtenga todas las asignaciones con filtros completos
    this.escalationService.getAssignmentsAdmin(undefined, fromDate).subscribe({
      next: (data: any[]) => {
        this.weeklyAssignments = [...data].sort((a: any, b: any) => 
          new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()
        );
        this.partitionAssignmentsByMonth(this.weeklyAssignments);
        this.calculateGantt();
        this.calculateProximityCards();
        this.loadingWeeklyAssignments = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingWeeklyAssignments = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadHistoricalAssignments(): void {
    if (this.historicalLoaded || this.loadingHistoricalAssignments) return;
    this.loadingHistoricalAssignments = true;
    const currentDate = new Date();
    const previousMonthEnd = this.getEndOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1).toISOString();

    this.escalationService.getAssignmentsAdmin(undefined, undefined, previousMonthEnd, 200).subscribe({
      next: (data: any[]) => {
        const currentMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth());
        const previousMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1);
        this.historicalAssignments = [...data]
          .filter((assignment: any) => {
            const weekStart = new Date(assignment.weekStartDate);
            return weekStart < previousMonthStart && weekStart < currentMonthStart;
          })
          .sort((a: any, b: any) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime());
        this.historicalLoaded = true;
        this.showHistorical = true;
        this.loadingHistoricalAssignments = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingHistoricalAssignments = false;
        this.showError('Error al cargar histórico de asignaciones');
      }
    });
  }

  toggleHistorical(): void {
    if (!this.historicalLoaded) {
      this.loadHistoricalAssignments();
      return;
    }
    this.showHistorical = !this.showHistorical;
  }

  private partitionAssignmentsByMonth(assignments: any[]): void {
    const currentDate = new Date();
    const currentMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth());
    const nextMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
    const previousMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1);

    this.currentMonthAssignments = assignments.filter((assignment: any) => {
      const weekStart = new Date(assignment.weekStartDate);
      return weekStart >= currentMonthStart && weekStart < nextMonthStart;
    });
    this.futureAssignments = assignments.filter((assignment: any) => {
      const weekStart = new Date(assignment.weekStartDate);
      return weekStart >= nextMonthStart;
    });
    this.previousMonthAssignments = assignments.filter((assignment: any) => {
      const weekStart = new Date(assignment.weekStartDate);
      return weekStart >= previousMonthStart && weekStart < currentMonthStart;
    });
  }

  private getStartOfMonth(year: number, month: number): Date {
    return new Date(year, month, 1, 0, 0, 0, 0);
  }

  private getEndOfMonth(year: number, month: number): Date {
    return new Date(year, month + 1, 0, 23, 59, 59, 999);
  }

  getSelectedAssignmentSectionLabel(): string {
    const startDate = this.assignmentForm?.get('weekStartDate')?.value;
    if (!startDate) return '';
    return this.getAssignmentSectionLabel(startDate);
  }

  private getAssignmentSectionLabel(dateValue: string | Date): string {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    const currentDate = new Date();
    const currentMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth());
    const nextMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
    const previousMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1);

    if (date >= currentMonthStart && date < nextMonthStart) return 'Mes actual';
    if (date >= nextMonthStart) return 'Próximos meses';
    if (date >= previousMonthStart && date < currentMonthStart) return 'Mes anterior';
    return 'Histórico';
  }

  addWeeklyAssignment(): void {
    this.showAssignmentForm = true;
    this.editingWeeklyAssignmentId = null;
    const defaultDates = this.calculateDefaultWeekDates();
    this.assignmentForm.reset({
      roleCode: '',
      assignedUserId: '',
      weekStartDate: defaultDates.weekStartDate,
      weekEndDate: defaultDates.weekEndDate,
      startTime: defaultDates.startTime,
      endTime: defaultDates.endTime
    });
    this.updateAssignmentPeopleOptions();
    this.roleConflictMsg = null;
    this.personConflictMsg = null;
    this.rangeErrorMsg = null;
  }

  private calculateDefaultWeekDates() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    let daysToNextMonday = 1 - dayOfWeek;
    if (daysToNextMonday <= 0) daysToNextMonday += 7;
    
    const nextMonday = new Date(today);
    nextMonday.setDate(nextMonday.getDate() + daysToNextMonday);
    nextMonday.setHours(9, 0, 0, 0);
    
    const followingMonday = new Date(nextMonday);
    followingMonday.setDate(followingMonday.getDate() + 7);
    followingMonday.setHours(8, 59, 0, 0);
    
    return {
      weekStartDate: nextMonday,
      weekEndDate: followingMonday,
      startTime: '09:00',
      endTime: '08:59'
    };
  }

  saveWeeklyAssignment(): void {
    if (this.assignmentForm.invalid || this.savingWeeklyAssignment) {
      this.showError('Complete todos los campos obligatorios');
      return;
    }

    this.savingWeeklyAssignment = true;
    const formData = this.assignmentForm.value;
    const assignedUserIdRaw = String(formData.assignedUserId || '');
    
    const startDateTime = new Date(formData.weekStartDate);
    const [startHour, startMin] = formData.startTime.split(':');
    startDateTime.setHours(parseInt(startHour), parseInt(startMin), 0);
    
    const endDateTime = new Date(formData.weekEndDate);
    const [endHour, endMin] = formData.endTime.split(':');
    endDateTime.setHours(parseInt(endHour), parseInt(endMin), 0);

    const submitAssignment = (resolvedUserId?: string, resolvedExternalPersonId?: string): void => {
      const data = {
        roleCode: formData.roleCode,
        userId: resolvedExternalPersonId ? undefined : resolvedUserId,
        externalPersonId: resolvedExternalPersonId,
        weekStartDate: startDateTime.toISOString(),
        weekEndDate: endDateTime.toISOString()
      };

      const obs$ = this.editingWeeklyAssignmentId
        ? this.escalationService.updateAssignment(this.editingWeeklyAssignmentId, data)
        : this.escalationService.createAssignment(data);

      obs$.subscribe({
        next: (res: any) => {
          this.ngZone.run(() => {
            // Si el backend autolimpia turnos previos por ausencia (vacaciones/licencia), se notifica detalladamente
            if (res && (res.vacationAutoCleaned || res.absenceAutoCleaned)) {
              this.showSuccess(res.message || 'Turno de ausencia guardado y turnos anteriores liberados.');
            } else {
              this.showSuccess(this.editingWeeklyAssignmentId ? 'Turno actualizado correctamente' : 'Turno asignado correctamente');
            }
            this.cancelWeeklyAssignmentEdit();
            this.loadWeeklyAssignments();
            this.savingWeeklyAssignment = false;
          });
        },
        error: (err: any) => {
          const backendMessage = err?.error?.error || err?.error?.message;
          const sectionLabel = this.getSelectedAssignmentSectionLabel();
          const enhancedMessage = backendMessage?.includes('mismo período') && sectionLabel
            ? `${backendMessage}. Revísala en "${sectionLabel}".`
            : backendMessage;
          this.showError(enhancedMessage || 'Error al guardar turno');
          this.savingWeeklyAssignment = false;
        }
      });
    };

    if (assignedUserIdRaw.startsWith('dir_')) {
      const directoryId = assignedUserIdRaw.replace('dir_', '');
      const selectedDirectoryContact = (this.directoryContacts || []).find((item) => String(item?._id || '') === directoryId);
      const roleCode = String(formData.roleCode || '');

      if (selectedDirectoryContact && this.isDirectoryContactInternal(selectedDirectoryContact)) {
        // Para TI role, permitir asignar directamente desde directorio interno sin buscar usuario sistema
        if (roleCode === 'TI') {
          this.ensureExternalPersonFromDirectory(directoryId).subscribe({
            next: (externalPersonId) => {
              submitAssignment(undefined, externalPersonId);
            },
            error: () => {
              this.showError('No se pudo preparar el contacto del directorio para TI.');
              this.savingWeeklyAssignment = false;
            }
          });
          return;
        }

        // Para otros roles, buscar usuario interno coincidente
        const resolvedInternalUserId = this.findInternalUserIdFromDirectoryContact(selectedDirectoryContact);
        if (!resolvedInternalUserId) {
          this.showError('El contacto del directorio es interno. Asígnalo desde Analistas Internos (Usuarios).');
          this.savingWeeklyAssignment = false;
          return;
        }
        submitAssignment(resolvedInternalUserId, undefined);
        return;
      }

      this.ensureExternalPersonFromDirectory(directoryId).subscribe({
        next: (externalPersonId) => {
          if (!externalPersonId) {
            this.showError('No se pudo resolver la persona del directorio para asignar el turno.');
            this.savingWeeklyAssignment = false;
            return;
          }
          submitAssignment(undefined, externalPersonId);
        },
        error: () => {
          this.showError('No se pudo preparar la persona desde el directorio.');
          this.savingWeeklyAssignment = false;
        }
      });
      return;
    }

    if (assignedUserIdRaw.startsWith('ext_')) {
      submitAssignment(undefined, assignedUserIdRaw.replace('ext_', ''));
      return;
    }

    submitAssignment(assignedUserIdRaw, undefined);
  }

  private ensureExternalPersonFromDirectory(directoryId: string): Observable<string> {
    const match = (this.directoryContacts || []).find((item) => String(item?._id || '') === String(directoryId));
    if (!match) {
      return of('');
    }

    const normalizedName = String(match.name || '').trim().toLowerCase();
    const normalizedEmail = String(match.email || '').trim().toLowerCase();
    const normalizedPhone = String(match.phone || '').trim();

    const existing = (this.externalPeople || []).find((person) => {
      const sameName = String(person?.name || '').trim().toLowerCase() === normalizedName;
      const sameEmail = normalizedEmail && String(person?.email || '').trim().toLowerCase() === normalizedEmail;
      const samePhone = normalizedPhone && String(person?.phone || '').trim() === normalizedPhone;
      return sameName && (sameEmail || samePhone || (!normalizedEmail && !normalizedPhone));
    });

    if (existing?._id) {
      return of(String(existing._id));
    }

    return this.escalationService.createExternalPerson({
      name: match.name,
      email: match.email || 'sin-correo@directorio.local',
      phone: match.phone || '000000000',
      position: match.position || '',
      active: true
    }).pipe(
      map((created: any) => {
        const createdId = String(created?._id || '');
        if (createdId) {
          this.externalPeople = [...this.externalPeople, created];
          this.updateAssignmentPeopleOptions();
        }
        return createdId;
      }),
      catchError(() => of(''))
    );
  }

  deleteWeeklyAssignment(id: string): void {
    if (confirm('¿Eliminar esta asignación?')) {
      this.escalationService.deleteAssignment(id).subscribe({
        next: () => {
          this.showSuccess('Asignación eliminada');
          this.selectedAssignmentIds.delete(id); // Limpiar de seleccionados si existe
          this.loadWeeklyAssignments();
        },
        error: () => this.showError('Error al eliminar')
      });
    }
  }

  // ============ SELECCIÓN MÚLTIPLE Y BORRADO MASIVO ============
  selectedAssignmentIds = new Set<string>();

  isAssignmentSelected(asg: any): boolean {
    return this.selectedAssignmentIds.has(asg._id);
  }

  toggleAssignmentSelection(asg: any, checked: boolean): void {
    if (checked) {
      this.selectedAssignmentIds.add(asg._id);
    } else {
      this.selectedAssignmentIds.delete(asg._id);
    }
  }

  isAllSelected(): boolean {
    const list = this.getFilteredWeeklyAssignments();
    return list.length > 0 && list.every(asg => this.selectedAssignmentIds.has(asg._id));
  }

  isSomeSelected(): boolean {
    const list = this.getFilteredWeeklyAssignments();
    const count = list.filter(asg => this.selectedAssignmentIds.has(asg._id)).length;
    return count > 0 && count < list.length;
  }

  toggleAllSelections(checked: boolean): void {
    const list = this.getFilteredWeeklyAssignments();
    if (checked) {
      list.forEach(asg => this.selectedAssignmentIds.add(asg._id));
    } else {
      list.forEach(asg => this.selectedAssignmentIds.delete(asg._id));
    }
  }

  bulkDeleteSelected(): void {
    const count = this.selectedAssignmentIds.size;
    if (count === 0) return;

    if (!confirm(`¿Está seguro de eliminar de forma masiva las ${count} asignaciones seleccionadas?`)) {
      return;
    }

    const idsArray = Array.from(this.selectedAssignmentIds);
    this.loadingWeeklyAssignments = true;
    this.escalationService.bulkDeleteAssignments(idsArray).subscribe({
      next: (res) => {
        this.showSuccess(res.message || `Se eliminaron ${res.deletedCount} asignaciones.`);
        this.selectedAssignmentIds.clear();
        this.loadWeeklyAssignments();
      },
      error: (err) => {
        this.loadingWeeklyAssignments = false;
        this.showError(err?.error?.error || 'Error al realizar el borrado masivo');
      }
    });
  }

  // ============ GANTT VISUAL SEMANAL ============
  calculateGantt(): void {
    const now = this.getOfficialNow();
    
    const currentMonday = new Date(now);
    const day = currentMonday.getDay();
    const diff = currentMonday.getDate() - day + (day === 0 ? -6 : 1);
    currentMonday.setDate(diff);
    currentMonday.setHours(0, 0, 0, 0);

    // Ventana visual: 3 días previos + semana actual (7) + 3 días posteriores = 13 días.
    const previousHalfDays = 3;
    const nextHalfDays = 3;
    const currentWeekDays = 7;
    const totalDays = previousHalfDays + currentWeekDays + nextHalfDays;

    const windowStart = new Date(currentMonday);
    windowStart.setDate(windowStart.getDate() - previousHalfDays);
    windowStart.setHours(0, 0, 0, 0);

    // Fin exclusivo para cálculos temporales.
    const windowEndExclusive = new Date(windowStart);
    windowEndExclusive.setDate(windowEndExclusive.getDate() + totalDays);
    windowEndExclusive.setHours(0, 0, 0, 0);

    // Fin inclusivo para etiqueta visual de período.
    const windowEndInclusive = new Date(windowEndExclusive);
    windowEndInclusive.setDate(windowEndInclusive.getDate() - 1);

    this.ganttWeekStart = windowStart;
    this.ganttWeekEnd = windowEndInclusive;

    const totalMs = windowEndExclusive.getTime() - windowStart.getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    // Grid: limites reales de cada día (0..totalDays).
    this.ganttGridLines = Array.from({ length: totalDays + 1 }, (_, i) => (i / totalDays) * 100);

    // Dia actual: marcador dinamico por hora/minuto real dentro de la ventana.
    const nowMs = now.getTime() - windowStart.getTime();
    this.ganttTodayPosition = Math.min(Math.max((nowMs / totalMs) * 100, 0), 100);
    this.ganttTodayLabel = `Día Actual servidor (${this.formatShortDateTime(now)})`;

    const ticks = [];
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      const isToday = this.isSameLocalDay(d, now);
      const dayName = dayNames[d.getDay()];
      ticks.push({
        label: `${dayName} ${d.getDate()}/${d.getMonth() + 1}`,
        position: ((i + 0.5) / totalDays) * 100,
        isToday
      });
    }
    this.ganttTicks = ticks;

    // Solo mostramos los turnos operativos en el diagrama de Gantt
    const roles = ['N2', 'TI', 'N1_NO_HABIL'];
    this.ganttRoles = roles.map(roleCode => {
      const matches = this.weeklyAssignments.filter(asg => {
        if (asg.roleCode !== roleCode) return false;
        const start = new Date(asg.weekStartDate);
        const end = new Date(asg.weekEndDate);
        return start < windowEndExclusive && end > windowStart;
      });

      const bars = matches.map(asg => {
        const start = new Date(asg.weekStartDate);
        const end = new Date(asg.weekEndDate);

        const startMs = Math.max(start.getTime(), windowStart.getTime()) - windowStart.getTime();
        const endMs = Math.min(end.getTime(), windowEndExclusive.getTime()) - windowStart.getTime();

        // Si el tramo visible no tiene duracion, no dibujar barra para evitar artefactos.
        if (endMs <= startMs) {
          return null;
        }

        const left = (startMs / totalMs) * 100;
        const width = ((endMs - startMs) / totalMs) * 100;

        const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';
        const status = this.getAssignmentStatus(asg);

        return {
          left,
          width: Math.max(width, 0.8),
          label: personName,
          status,
          statusClass: this.getWeeklyStatusClass(status),
          asg
        };
      })
      .filter((bar): bar is NonNullable<typeof bar> => bar !== null)
      .sort((a, b) => a.left - b.left);

      return {
        roleCode,
        roleLabel: this.getRoleLabel(roleCode),
        bars
      };
    });
  }

  /**
   * Obtiene la etiqueta amigable para mostrar el nombre del rol en español.
   */
  getRoleLabel(roleCode: string): string {
    if (roleCode === 'N1_NO_HABIL') return 'N1_NO_HABIL';
    if (roleCode === 'N2') return 'N2';
    if (roleCode === 'TI') return 'TI';
    if (roleCode === 'TELEWORK') return 'Teletrabajo';
    if (roleCode === 'OL') return 'Charla/Capacitacion (OL)';
    if (roleCode === 'VACATION') return 'Vacaciones';
    if (roleCode === 'MEDICAL_LEAVE') return 'Licencia médica';
    if (roleCode === 'MEDICAL_APPOINTMENT') return 'Trámite Médico';
    return roleCode;
  }

  getAssignmentStatus(asg: any): 'Pasado' | 'En Curso' | 'Próximo' {
    const now = this.getOfficialNow();
    const start = new Date(asg.weekStartDate);
    const end = new Date(asg.weekEndDate);
    if (end < now) return 'Pasado';
    if (start <= now && end >= now) return 'En Curso';
    return 'Próximo';
  }

  private syncServerClock(): void {
    const requestStartedMonotonicMs = performance.now();
    this.workShiftService.getCurrentShift()
      .pipe(
        take(1), // QA-SHIFTS-PERF-001: Se fuerza la finalización explícita para evitar fugas de memoria por suscripciones anidadas
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (response) => {
          const requestEndedMonotonicMs = performance.now();

          let serverMs: number | null = null;
          if (typeof response?.currentTimestamp === 'number' && Number.isFinite(response.currentTimestamp)) {
            serverMs = response.currentTimestamp;
          } else if (response?.currentDateTime) {
            const parsed = Date.parse(response.currentDateTime);
            if (Number.isFinite(parsed)) {
              serverMs = parsed;
            }
          }

          if (serverMs === null) return;

          // Aproximación NTP simple: corregimos por mitad del RTT para minimizar sesgo.
          const midpointMonotonicMs = requestStartedMonotonicMs + ((requestEndedMonotonicMs - requestStartedMonotonicMs) / 2);
          this.serverReferenceMs = serverMs;
          this.monotonicAtSyncMs = midpointMonotonicMs;
          this.hasServerClock = true;
        },
        error: () => {
          // Si falla la lectura oficial, conservar la última referencia válida y fallback implícito a reloj local.
        }
      });
  }

  private getOfficialNow(): Date {
    if (!this.hasServerClock) {
      return new Date();
    }
    const elapsedMonotonicMs = performance.now() - this.monotonicAtSyncMs;
    return new Date(this.serverReferenceMs + elapsedMonotonicMs);
  }

  private isSameLocalDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private formatShortDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
  }

  getWeeklyStatusClass(status: string): string {
    if (status === 'En Curso') return 'status-active';
    if (status === 'Próximo') return 'status-upcoming';
    return 'status-past';
  }

  // ============ TARJETAS DE PROXIMIDAD ============
  calculateProximityCards(): void {
    const now = this.getOfficialNow();

    const activeAssignments = this.weeklyAssignments.filter(asg => this.getAssignmentStatus(asg) === 'En Curso');
    const futureAssignments = this.weeklyAssignments.filter(asg => this.getAssignmentStatus(asg) === 'Próximo');

    // Turnos Próximos a Terminar (En Curso)
    this.upcomingEndAssignments = activeAssignments
      .map(asg => {
        const start = new Date(asg.weekStartDate);
        const end = new Date(asg.weekEndDate);
        const total = end.getTime() - start.getTime();
        const elapsed = now.getTime() - start.getTime();
        
        let progress = total > 0 ? (elapsed / total) * 100 : 0;
        progress = Math.min(Math.max(progress, 0), 100);

        const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';
        
        const diffMs = end.getTime() - now.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let remainingText = '';
        if (days > 0) {
          remainingText = `Termina en ${days} día${days > 1 ? 's' : ''}`;
        } else if (hours > 0) {
          remainingText = `Termina en ${hours} hora${hours > 1 ? 's' : ''}`;
        } else {
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          remainingText = `Termina en ${mins} min${mins > 1 ? 's' : ''}`;
        }

        return {
          personName,
          roleCode: asg.roleCode,
          remainingText,
          progress,
          asg
        };
      })
      .sort((a, b) => new Date(a.asg.weekEndDate).getTime() - new Date(b.asg.weekEndDate).getTime());

    // Próximos Turnos a Iniciar (Próximo)
    this.upcomingStartAssignments = futureAssignments
      .map(asg => {
        const start = new Date(asg.weekStartDate);
        const end = new Date(asg.weekEndDate);
        const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';

        const diffMs = start.getTime() - now.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let timeUntilText = '';
        if (days > 0) {
          timeUntilText = `Inicia en ${days} día${days > 1 ? 's' : ''}`;
        } else if (hours > 0) {
          timeUntilText = `Inicia en ${hours} hora${hours > 1 ? 's' : ''}`;
        } else {
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          timeUntilText = `Inicia en ${mins} min${mins > 1 ? 's' : ''}`;
        }

        // Calcular progress: cuánto tiempo ya ha "pasado" (proximidad al inicio)
        // Invertido: 0% = falta mucho (verde), 100% = falta poco (rojo)
        const durationTotal = end.getTime() - start.getTime();
        let progress = durationTotal > 0 ? 100 - ((diffMs / durationTotal) * 100) : 0;
        progress = Math.min(Math.max(progress, 0), 100);

        return {
          personName,
          roleCode: asg.roleCode,
          timeUntilText,
          progress,
          asg
        };
      })
      .sort((a, b) => new Date(a.asg.weekStartDate).getTime() - new Date(b.asg.weekStartDate).getTime());
  }

  // ============ VALIDACIONES DE SOLAPE EN EL EDITOR ============
  checkAssignmentConflicts(): void {
    this.roleConflictMsg = null;
    this.personConflictMsg = null;
    this.rangeErrorMsg = null;

    const roleCode = this.assignmentForm.get('roleCode')?.value;
    const assignedUserId = this.assignmentForm.get('assignedUserId')?.value;
    const weekStartDate = this.assignmentForm.get('weekStartDate')?.value;
    const weekEndDate = this.assignmentForm.get('weekEndDate')?.value;
    const startTime = this.assignmentForm.get('startTime')?.value || '09:00';
    const endTime = this.assignmentForm.get('endTime')?.value || '08:59';

    if (!roleCode || !assignedUserId || !weekStartDate || !weekEndDate) {
      return;
    }

    const start = new Date(weekStartDate);
    const [startHour, startMin] = startTime.split(':');
    start.setHours(parseInt(startHour || '0'), parseInt(startMin || '0'), 0, 0);

    const end = new Date(weekEndDate);
    const [endHour, endMin] = endTime.split(':');
    end.setHours(parseInt(endHour || '23'), parseInt(endMin || '59'), 59, 999);

    if (end <= start) {
      this.rangeErrorMsg = '⚠️ Rango Inválido: La fecha de fin debe ser posterior a la fecha de inicio.';
      return;
    }

    let targetUserId: string | undefined;
    let targetExtId: string | undefined;
    let targetPersonName = '';

    const idStr = String(assignedUserId);
    if (idStr.startsWith('ext_')) {
      targetExtId = idStr.replace('ext_', '');
      const match = this.externalPeople.find(p => p._id === targetExtId);
      targetPersonName = match?.name || 'Persona Externa';
    } else if (idStr.startsWith('dir_')) {
      const dirId = idStr.replace('dir_', '');
      const match = this.directoryContacts.find(c => c._id === dirId);
      targetPersonName = match?.name || 'Contacto de Directorio';
    } else {
      targetUserId = idStr;
      const match = this.users.find(u => u._id === targetUserId);
      targetPersonName = match?.fullName || match?.username || 'Usuario';
    }

    // Los conflictos de exclusividad no aplican si la nueva asignación es Teletrabajo o una ausencia.
    // Teletrabajo puede coexistir, y las ausencias (vacaciones/licencia) hacen limpieza automática en backend.
    const isCurrentTeleworkOrAbsence = roleCode === 'TELEWORK' || roleCode === 'OL' || roleCode === 'VACATION' || roleCode === 'MEDICAL_LEAVE' || roleCode === 'MEDICAL_APPOINTMENT';

    for (const asg of this.weeklyAssignments) {
      if (this.editingWeeklyAssignmentId && asg._id === this.editingWeeklyAssignmentId) {
        continue;
      }

      const asgStart = new Date(asg.weekStartDate);
      const asgEnd = new Date(asg.weekEndDate);

      const overlap = start <= asgEnd && end >= asgStart;
      if (!overlap) {
        continue;
      }

      // 1. Conflicto de Condición (solo si ambas asignaciones requieren exclusividad)
      if (asg.roleCode === roleCode
        && !isCurrentTeleworkOrAbsence
        && asg.roleCode !== 'TELEWORK'
        && asg.roleCode !== 'OL'
        && asg.roleCode !== 'VACATION'
        && asg.roleCode !== 'MEDICAL_LEAVE'
        && asg.roleCode !== 'MEDICAL_APPOINTMENT') {
        const assignedName = asg.userId?.fullName || asg.externalPersonId?.name || 'otra persona';
        const startStr = asgStart.toLocaleDateString('es-CL');
        const endStr = asgEnd.toLocaleDateString('es-CL');
        // Se actualiza el mensaje de alerta de colisión refiriéndose a Condición en lugar de Rol
        this.roleConflictMsg = `⚠️ Conflicto de Condición: Ya existe un turno asignado para la condición ${this.getRoleLabel(roleCode)} en este período (${startStr} - ${endStr}) por ${assignedName}.`;
      }

      // 2. Conflicto de Persona (Disponibilidad)
      const matchesUser = targetUserId && asg.userId && String(asg.userId._id || asg.userId) === String(targetUserId);
      const matchesExt = targetExtId && asg.externalPersonId && String(asg.externalPersonId._id || asg.externalPersonId) === String(targetExtId);
      
      if (matchesUser || matchesExt) {
        // Teletrabajo y ausencias no bloquean disponibilidad local porque backend resuelve ausencias.
        if (!isCurrentTeleworkOrAbsence
          && asg.roleCode !== 'TELEWORK'
          && asg.roleCode !== 'OL'
          && asg.roleCode !== 'VACATION'
          && asg.roleCode !== 'MEDICAL_LEAVE'
          && asg.roleCode !== 'MEDICAL_APPOINTMENT') {
          const otherRole = this.getRoleLabel(asg.roleCode);
          const startStr = asgStart.toLocaleDateString('es-CL');
          const endStr = asgEnd.toLocaleDateString('es-CL');
          this.personConflictMsg = `⚠️ Conflicto de Disponibilidad: ${targetPersonName} ya tiene asignado otro turno (${otherRole}) en este período (${startStr} - ${endStr}).`;
        }
      }
    }
  }

  /**
   * Determina si una asignación tiene conflictos visuales de solape de rol o disponibilidad.
   */
  hasRowConflict(asg: any): boolean {
    const start = new Date(asg.weekStartDate);
    const end = new Date(asg.weekEndDate);
    const roleCode = asg.roleCode;
    const userId = asg.userId?._id || asg.userId;
    const extId = asg.externalPersonId?._id || asg.externalPersonId;

    for (const other of this.weeklyAssignments) {
      if (other._id === asg._id) continue;
      
      const otherStart = new Date(other.weekStartDate);
      const otherEnd = new Date(other.weekEndDate);
      const overlap = start <= otherEnd && end >= otherStart;
      if (!overlap) continue;

      // El conflicto de condición no aplica si uno es Teletrabajo o una ausencia.
      if (other.roleCode === roleCode
        && roleCode !== 'TELEWORK'
        && roleCode !== 'OL'
        && roleCode !== 'VACATION'
        && roleCode !== 'MEDICAL_LEAVE'
        && roleCode !== 'MEDICAL_APPOINTMENT') return true;

      const matchesUser = userId && other.userId && String(other.userId._id || other.userId) === String(userId);
      const matchesExt = extId && other.externalPersonId && String(other.externalPersonId._id || other.externalPersonId) === String(extId);
      if (matchesUser || matchesExt) {
        // Si cualquiera es Teletrabajo o ausencia, no representa conflicto visual de disponibilidad.
        if (roleCode === 'TELEWORK' || roleCode === 'OL' || roleCode === 'VACATION' || roleCode === 'MEDICAL_LEAVE' || roleCode === 'MEDICAL_APPOINTMENT') continue;
        if (other.roleCode === 'TELEWORK' || other.roleCode === 'OL' || other.roleCode === 'VACATION' || other.roleCode === 'MEDICAL_LEAVE' || other.roleCode === 'MEDICAL_APPOINTMENT') continue;
        return true;
      }
    }
    return false;
  }

  /**
   * Genera el mensaje descriptivo del tooltip cuando hay un conflicto.
   */
  getRowConflictTooltip(asg: any): string {
    const start = new Date(asg.weekStartDate);
    const end = new Date(asg.weekEndDate);
    const roleCode = asg.roleCode;
    const userId = asg.userId?._id || asg.userId;
    const extId = asg.externalPersonId?._id || asg.externalPersonId;

    for (const other of this.weeklyAssignments) {
      if (other._id === asg._id) continue;
      
      const otherStart = new Date(other.weekStartDate);
      const otherEnd = new Date(other.weekEndDate);
      const overlap = start <= otherEnd && end >= otherStart;
      if (!overlap) continue;

      if (other.roleCode === roleCode
        && roleCode !== 'TELEWORK'
        && roleCode !== 'OL'
        && roleCode !== 'VACATION'
        && roleCode !== 'MEDICAL_LEAVE'
        && roleCode !== 'MEDICAL_APPOINTMENT') {
        // Se retorna un texto de colisión adaptado a Condición para consistencia
        const otherName = other.userId?.fullName || other.externalPersonId?.name || 'otra persona';
        return `Conflicto de Condición: ${this.getRoleLabel(roleCode)} ya está asignado a ${otherName} en este período.`;
      }

      const matchesUser = userId && other.userId && String(other.userId._id || other.userId) === String(userId);
      const matchesExt = extId && other.externalPersonId && String(other.externalPersonId._id || other.externalPersonId) === String(extId);
      if (matchesUser || matchesExt) {
        if (roleCode === 'TELEWORK' || roleCode === 'OL' || roleCode === 'VACATION' || roleCode === 'MEDICAL_LEAVE' || roleCode === 'MEDICAL_APPOINTMENT') continue;
        if (other.roleCode === 'TELEWORK' || other.roleCode === 'OL' || other.roleCode === 'VACATION' || other.roleCode === 'MEDICAL_LEAVE' || other.roleCode === 'MEDICAL_APPOINTMENT') continue;
        return `Conflicto de Disponibilidad: Esta persona tiene otro turno (${this.getRoleLabel(other.roleCode)}) en este período.`;
      }
    }
    return '';
  }

  // ============ FILTRADO Y AGRUPAMIENTO EN TABLA DE ASIGNACIONES ============
  getFilteredWeeklyAssignments(): any[] {
    let result = [...this.weeklyAssignments];

    // Filtrar para ocultar turnos que están tapados por licencias médicas o vacaciones (inclusivo)
    result = result.filter(asg => {
      const userId = asg.userId?._id || asg.userId;
      const extId = asg.externalPersonId?._id || asg.externalPersonId;
      const start = new Date(asg.weekStartDate);
      const end = new Date(asg.weekEndDate);

      const priorityRole = resolverCondicionVisible(this.weeklyAssignments, userId, extId, start, end);

      // Si hay una condición de mayor prioridad en este rango y no coincide con el registro actual, se oculta
      if (priorityRole && priorityRole !== asg.roleCode) {
        return false;
      }
      return true;
    });

    if (this.filterAnalyst) {
      const q = this.filterAnalyst.toLowerCase().trim();
      result = result.filter(asg => {
        const name = (asg.userId?.fullName || asg.externalPersonId?.name || '').toLowerCase();
        const email = (asg.userId?.email || asg.externalPersonId?.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    if (this.filterRole) {
      result = result.filter(asg => asg.roleCode === this.filterRole);
    }

    // Separar las asignaciones según su estado
    const proximos = result.filter(asg => this.getAssignmentStatus(asg) === 'Próximo');
    const enCurso = result.filter(asg => this.getAssignmentStatus(asg) === 'En Curso');
    const pasados = result.filter(asg => this.getAssignmentStatus(asg) === 'Pasado');

    // Ordenar turnos próximos por fecha de inicio ascendente
    proximos.sort((a, b) => new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime());

    // Ordenar turnos en curso por fecha de inicio ascendente
    enCurso.sort((a, b) => new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime());

    // Ordenar turnos pasados de más recientes a más antiguos para tomar solo los 4 últimos
    pasados.sort((a, b) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime());
    const pasadosLimitados = pasados.slice(0, 4);
    // Volver a ordenarlos de forma ascendente para mantener consistencia cronológica
    pasadosLimitados.sort((a, b) => new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime());

    // Consolidar el resultado final en el orden: Próximo → En Curso → Pasado
    return [...proximos, ...enCurso, ...pasadosLimitados];
  }

  editWeeklyAssignment(asg: any): void {
    this.editingWeeklyAssignmentId = asg._id;
    this.showAssignmentForm = true;

    let assignedVal = '';
    if (asg.externalPersonId) {
      assignedVal = `ext_${asg.externalPersonId._id || asg.externalPersonId}`;
    } else if (asg.userId) {
      assignedVal = asg.userId._id || asg.userId;
    }

    const start = new Date(asg.weekStartDate);
    const end = new Date(asg.weekEndDate);

    const pad = (n: number) => n.toString().padStart(2, '0');
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

    // 1. Primero cargar las opciones basadas en el rol (sin filtrar el valor actual)
    this.updateAssignmentPeopleOptionsForRole(asg.roleCode, assignedVal);

    // 2. Ahora setear el formulario — la persona ya está disponible en las opciones
    this.assignmentForm.setValue({
      roleCode: asg.roleCode,
      assignedUserId: assignedVal,
      weekStartDate: start,
      weekEndDate: end,
      startTime: startTime,
      endTime: endTime
    });

    this.checkAssignmentConflicts();
    this.cdr.detectChanges();
  }

  cancelWeeklyAssignmentEdit(): void {
    this.editingWeeklyAssignmentId = null;
    this.showAssignmentForm = false;
    const defaultDates = this.calculateDefaultWeekDates();
    this.assignmentForm.reset({
      roleCode: '',
      assignedUserId: '',
      weekStartDate: defaultDates.weekStartDate,
      weekEndDate: defaultDates.weekEndDate,
      startTime: defaultDates.startTime,
      endTime: defaultDates.endTime
    });
    this.updateAssignmentPeopleOptions();
    this.roleConflictMsg = null;
    this.personConflictMsg = null;
    this.rangeErrorMsg = null;
  }

  // ============ RECORDATORIOS ============
  loadEscalationReminderConfig(): void {
    this.loadingEscalationReminderConfig = true;
    this.configService.getConfig().subscribe({
      next: (config: any) => {
        const selectedCargoLabels = Array.isArray(config.escalationReminderCargoLabels)
          ? config.escalationReminderCargoLabels.filter((cargo: string) => String(cargo || '').trim().length > 0)
          : [];
        this.escalationReminderForm.patchValue({
          escalationReminderEnabled: config.escalationReminderEnabled ?? false,
          escalationReminderCargoLabels: selectedCargoLabels.length > 0 ? selectedCargoLabels : ['N2'],
          escalationReminderDaysAhead: config.escalationReminderDaysAhead || 7
        }, { emitEvent: false });
        this.updateEscalationReminderValidators();
        this.loadingEscalationReminderConfig = false;
      },
      error: () => {
        this.loadingEscalationReminderConfig = false;
      }
    });
  }

  saveEscalationReminderConfig(): void {
    this.updateEscalationReminderValidators();
    if (this.escalationReminderForm.invalid || this.savingEscalationReminderConfig) {
      this.showError('Configura al menos un cargo para el recordatorio');
      return;
    }
    this.savingEscalationReminderConfig = true;
    const value = this.escalationReminderForm.value;
    const selectedCargoLabels = Array.isArray(value.escalationReminderCargoLabels)
      ? value.escalationReminderCargoLabels.filter((cargo: string) => String(cargo || '').trim().length > 0)
      : [];
    const daysAhead = Number(value.escalationReminderDaysAhead || 7);

    this.configService.updateConfig({
      escalationReminderEnabled: !!value.escalationReminderEnabled,
      escalationReminderCargoLabels: selectedCargoLabels,
      escalationReminderDaysAhead: Number.isFinite(daysAhead) ? Math.min(Math.max(daysAhead, 1), 60) : 7
    }).subscribe({
      next: () => this.showSuccess('Recordatorio de escalación interna actualizado'),
      error: () => this.showError('Error guardando recordatorio'),
      complete: () => this.savingEscalationReminderConfig = false
    });
  }

  testEscalationReminder(): void {
    if (this.testingEscalationReminder) return;
    const selectedCargoLabelsRaw = this.escalationReminderForm?.get('escalationReminderCargoLabels')?.value;
    const selectedCargoLabels = Array.isArray(selectedCargoLabelsRaw)
      ? selectedCargoLabelsRaw.map((v: string) => String(v || '').trim()).filter((v: string) => v.length > 0)
      : [];
    if (selectedCargoLabels.length === 0) {
      this.showError('Selecciona al menos un cargo para probar el recordatorio');
      return;
    }
    this.testingEscalationReminder = true;
    this.escalationService.testEscalationReminder(selectedCargoLabels).subscribe({
      next: (response: any) => {
        const total = Number(response?.totalRecipients || 0);
        this.showSuccess(`${response?.message || 'Prueba ejecutada'} (${total} destinatarios)`);
      },
      error: (err: any) => this.showError(err?.error?.message || 'Error en prueba'),
      complete: () => this.testingEscalationReminder = false
    });
  }

  private refreshAvailableCargoLabels(): void {
    const unique = new Set<string>();
    this.defaultReminderCargoLabels.forEach((cargo) => unique.add(cargo));
    this.users.forEach((user) => {
      const value = String(user?.cargoLabel || '').trim();
      if (value) unique.add(value);
    });
    this.availableCargoLabels = Array.from(unique).sort((a, b) => a.localeCompare(b));
    this.ensureEscalationReminderSelection();
  }

  private ensureEscalationReminderSelection(): void {
    const currentSelection = this.escalationReminderForm?.get('escalationReminderCargoLabels')?.value;
    const selected = Array.isArray(currentSelection)
      ? currentSelection.filter((cargo: string) => this.availableCargoLabels.includes(cargo))
      : [];
    const fallback = selected.length > 0 ? selected : (this.availableCargoLabels.includes('N2') ? ['N2'] : this.availableCargoLabels.slice(0, 1));
    this.escalationReminderForm?.patchValue({ escalationReminderCargoLabels: fallback }, { emitEvent: false });
    this.updateEscalationReminderValidators();
  }

  private updateEscalationReminderValidators(): void {
    const enabled = !!this.escalationReminderForm?.get('escalationReminderEnabled')?.value;
    const cargoControl = this.escalationReminderForm?.get('escalationReminderCargoLabels');
    const daysAheadControl = this.escalationReminderForm?.get('escalationReminderDaysAhead');
    if (!cargoControl || !daysAheadControl) return;
    if (enabled) {
      cargoControl.setValidators([Validators.required, (control) => Array.isArray(control.value) && control.value.length > 0 ? null : { required: true }]);
      daysAheadControl.setValidators([Validators.required, Validators.min(1), Validators.max(60)]);
    } else {
      cargoControl.clearValidators();
      daysAheadControl.clearValidators();
    }
    cargoControl.updateValueAndValidity({ emitEvent: false });
    daysAheadControl.updateValueAndValidity({ emitEvent: false });
  }

  // ============ AUTOMATIZACIÓN DE TURNOS (MÚLTIPLES NOTIFICACIONES) ============

  /**
   * Carga todas las programaciones de notificaciones de turnos activas desde la API del backend.
   */
  loadNotificationSchedules(): void {
    this.loadingAutomationConfig = true;
    this.escalationService.getNotificationSchedules().subscribe({
      next: (schedules) => {
        this.notificationSchedules = schedules || [];
        this.loadingAutomationConfig = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error al cargar notificaciones programadas:', error);
        this.loadingAutomationConfig = false;
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * Prepara el formulario reactivo para añadir una nueva programación de notificación.
   */
  addNotificationSchedule(): void {
    this.showScheduleForm = true;
    this.editingScheduleId = null;
    this.testRecipientEmail = '';
    this.scheduleForm.reset({
      name: '',
      enabled: true,
      frequency: 'weekly',
      dayOfWeek: 1,
      time: '09:00',
      recipients: '',
      ccRecipients: '',
      includeGuard: true,
      includeTelework: false,
      includeOl: false,
      includeVacation: false,
      includeMedicalLeave: false,
      includeMedicalAppointment: false
    });
    this._recipientsRaw = '';
    this._ccRaw = '';
    this.cdr.detectChanges();
  }

  /**
   * Carga los datos de una programación seleccionada al formulario para permitir su edición.
   */
  editNotificationSchedule(schedule: any): void {
    this.showScheduleForm = true;
    this.editingScheduleId = schedule._id;
    this.testRecipientEmail = '';

    // Analizar el filtro de roles guardado para marcar los checkboxes correspondientes
    const filter = schedule.roleFilter || [];
    const includeGuard = filter.includes('N2') || filter.includes('TI') || filter.includes('N1_NO_HABIL');
    const includeTelework = filter.includes('TELEWORK');
    const includeOl = filter.includes('OL');
    const includeVacation = filter.includes('VACATION');
    const includeMedicalLeave = filter.includes('MEDICAL_LEAVE');
    const includeMedicalAppointment = filter.includes('MEDICAL_APPOINTMENT');

    const recs = Array.isArray(schedule.recipients) ? schedule.recipients.join(', ') : '';
    const ccs = Array.isArray(schedule.ccRecipients) ? schedule.ccRecipients.join(', ') : '';

    this.scheduleForm.setValue({
      name: schedule.name || '',
      enabled: schedule.enabled ?? true,
      frequency: schedule.frequency || 'weekly',
      dayOfWeek: schedule.dayOfWeek ?? 1,
      time: schedule.time || '09:00',
      recipients: recs,
      ccRecipients: ccs,
      includeGuard,
      includeTelework,
      includeOl,
      includeVacation,
      includeMedicalLeave,
      includeMedicalAppointment
    });

    this._recipientsRaw = recs;
    this._ccRaw = ccs;
    this.cdr.detectChanges();
  }

  /**
   * Guarda los cambios de la programación actual, ya sea creando una nueva o editando una existente.
   */
  saveNotificationSchedule(): void {
    if (this.scheduleForm.invalid || this.savingSchedule) {
      this.showError('Complete los campos obligatorios del formulario.');
      return;
    }

    const formVal = this.scheduleForm.value;

    // Convertir las condiciones seleccionadas a la lista de roles de base de datos correspondiente
    const roleFilter: string[] = [];
    if (formVal.includeGuard) {
      roleFilter.push('N2', 'TI', 'N1_NO_HABIL');
    }
    if (formVal.includeTelework) {
      roleFilter.push('TELEWORK');
    }
    if (formVal.includeOl) {
      roleFilter.push('OL');
    }
    if (formVal.includeVacation) {
      roleFilter.push('VACATION');
    }
    if (formVal.includeMedicalLeave) {
      roleFilter.push('MEDICAL_LEAVE');
    }
    if (formVal.includeMedicalAppointment) {
      roleFilter.push('MEDICAL_APPOINTMENT');
    }

    if (roleFilter.length === 0) {
      this.showError('Debe seleccionar al menos una condición a notificar (Guardia, Teletrabajo, Charla/Capacitación, Vacaciones, Trámite Médico o Licencia médica).');
      return;
    }

    this.savingSchedule = true;

    const payload = {
      name: formVal.name,
      enabled: formVal.enabled,
      frequency: formVal.frequency,
      dayOfWeek: formVal.dayOfWeek,
      time: formVal.time,
      recipients: String(formVal.recipients || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      ccRecipients: String(formVal.ccRecipients || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      roleFilter
    };

    const request$ = this.editingScheduleId
      ? this.escalationService.updateNotificationSchedule(this.editingScheduleId, payload)
      : this.escalationService.createNotificationSchedule(payload);

    request$.subscribe({
      next: () => {
        this.showSuccess(this.editingScheduleId ? 'Notificación programada actualizada' : 'Nueva programación de notificación creada');
        this.cancelScheduleForm();
        this.loadNotificationSchedules();
      },
      error: (error) => {
        console.error('Error al guardar programación de notificación:', error);
        this.showError(error?.error?.error || 'Error al guardar la programación.');
      },
      complete: () => {
        this.savingSchedule = false;
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * Elimina una programación de notificación seleccionada.
   */
  deleteNotificationSchedule(id: string): void {
    if (!confirm('¿Está seguro de eliminar esta programación de notificación?')) {
      return;
    }

    this.escalationService.deleteNotificationSchedule(id).subscribe({
      next: () => {
        this.showSuccess('Programación de notificación eliminada correctamente.');
        this.loadNotificationSchedules();
      },
      error: (error) => {
        console.error('Error al eliminar programación de notificación:', error);
        this.showError('Error al eliminar la programación.');
      }
    });
  }

  /**
   * Fuerza el envío manual inmediato de la notificación seleccionada.
   */
  triggerManualSendForSchedule(schedule: any): void {
    if (this.triggeringScheduleSend) return;

    if (!confirm(`¿Desea forzar el envío de la notificación "${schedule.name}" en este momento?`)) {
      return;
    }

    this.triggeringScheduleSend = true;
    this.escalationService.triggerNotificationScheduleSend(schedule._id).subscribe({
      next: (res: any) => {
        this.showSuccess(res.message || 'Envío de turnos procesado correctamente.');
        this.loadNotificationSchedules();
      },
      error: (err: any) => {
        console.error('Error al disparar envío manual de notificación:', err);
        this.showError(err?.error?.error || 'Error al forzar el envío.');
      },
      complete: () => {
        this.triggeringScheduleSend = false;
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * Envía un correo de prueba inmediato para la programación que se está editando.
   * Utiliza el correo ingresado en el campo de pruebas sin alterar el lastSentAt.
   */
  sendTestEmail(): void {
    if (!this.editingScheduleId) return;
    if (!this.testRecipientEmail || !this.testRecipientEmail.includes('@')) {
      this.showError('Ingrese un correo de prueba válido.');
      return;
    }

    // Obtener los roles seleccionados del formulario actual para pasarlos en la prueba
    const formVal = this.scheduleForm.value;
    const roleFilter: string[] = [];
    if (formVal.includeGuard) {
      roleFilter.push('N2', 'TI', 'N1_NO_HABIL');
    }
    if (formVal.includeTelework) {
      roleFilter.push('TELEWORK');
    }
    if (formVal.includeOl) {
      roleFilter.push('OL');
    }
    if (formVal.includeVacation) {
      roleFilter.push('VACATION');
    }
    if (formVal.includeMedicalLeave) {
      roleFilter.push('MEDICAL_LEAVE');
    }
    if (formVal.includeMedicalAppointment) {
      roleFilter.push('MEDICAL_APPOINTMENT');
    }

    this.triggeringScheduleSend = true;
    this.escalationService.triggerNotificationScheduleSend(this.editingScheduleId, {
      name: formVal.name,
      recipients: [this.testRecipientEmail.trim().toLowerCase()],
      ccRecipients: [],
      roleFilter,
      isTest: true
    } as any).subscribe({
      next: (res: any) => {
        this.showSuccess(res.message || 'Envío de prueba procesado correctamente.');
        this.testRecipientEmail = '';
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('Error al disparar envío de prueba:', err);
        this.showError(err?.error?.error || 'Error al enviar correo de prueba.');
      },
      complete: () => {
        this.triggeringScheduleSend = false;
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * Cancela la creación/edición de programación y retorna a la lista.
   */
  cancelScheduleForm(): void {
    this.showScheduleForm = false;
    this.editingScheduleId = null;
    this.testRecipientEmail = '';
    this.cdr.detectChanges();
  }

  onAutomationRecipientsInput(rawValue: string): void {
    this._recipientsRaw = rawValue;
    this.automationRecipientSuggestions = this.findDirectoryEmails(rawValue);
  }

  onAutomationCcInput(rawValue: string): void {
    this._ccRaw = rawValue;
    this.automationCcSuggestions = this.findDirectoryEmails(rawValue);
  }

  useAutomationRecipientEmail(email: string): void {
    this.applyEmailToControl('recipients', email || '');
    this.automationRecipientSuggestions = [];
  }

  useAutomationCcEmail(email: string): void {
    this.applyEmailToControl('ccRecipients', email || '');
    this.automationCcSuggestions = [];
  }

  private applyEmailToControl(controlName: 'recipients' | 'ccRecipients', email: string): void {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return;

    const cached = controlName === 'recipients' ? this._recipientsRaw : this._ccRaw;
    const parts = cached
      .split(',')
      .map((s) => String(s || '').trim())
      .filter((s) => s.length > 0);

    const lastToken = String(parts[parts.length - 1] || '').toLowerCase();
    if (lastToken && normalizedEmail.startsWith(lastToken) && lastToken !== normalizedEmail) {
      parts.pop();
    }

    const existing = parts.map((s) => s.toLowerCase());
    if (!existing.includes(normalizedEmail)) {
      existing.push(normalizedEmail);
    }

    const newValue = existing.join(', ');
    const control = this.scheduleForm.get(controlName);
    control?.setValue(newValue);

    if (controlName === 'recipients') {
      this._recipientsRaw = newValue;
    } else {
      this._ccRaw = newValue;
    }
  }

  private findDirectoryEmails(rawValue: string): DirectoryContact[] {
    const query = this.getLastCsvToken(rawValue).toLowerCase();
    const source = this.directoryContacts || [];

    return source
      .filter((contact) => {
        const email = String(contact.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return false;
        if (!query) return true;
        const name = String(contact.name || '').toLowerCase();
        const company = String(contact.company || '').toLowerCase();
        return email.includes(query) || name.includes(query) || company.includes(query);
      })
      .slice(0, 8);
  }

  private getLastCsvToken(rawValue: string): string {
    const value = String(rawValue || '');
    const parts = value.split(',');
    return String(parts[parts.length - 1] || '').trim();
  }

  // ============ PERSONAS EXTERNAS ============
  loadExternalPeople(): void {
    this.loadingExternalPeople = true;
    this.escalationService.getExternalPeople().subscribe({
      next: (data: any[]) => {
        this.externalPeople = [...data];
        this.updateAssignmentPeopleOptions();
        this.loadingExternalPeople = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingExternalPeople = false;
        this.cdr.detectChanges();
      }
    });
  }

  addExternalPerson(): void {
    this.showExternalPersonForm = true;
    this.editingExternalPersonId = null;
    this.externalPersonForm.reset({ name: '', email: '', phone: '', position: '', active: true });
  }

  saveExternalPerson(): void {
    if (this.externalPersonForm.invalid) {
      this.showError('Complete todos los campos obligatorios');
      return;
    }
    const data = this.externalPersonForm.value;
    this.escalationService.createExternalPerson(data).subscribe({
      next: () => {
        this.showSuccess('Persona agregada');
        this.showExternalPersonForm = false;
        this.loadExternalPeople();
      },
      error: () => this.showError('Error al agregar persona')
    });
  }

  deleteExternalPerson(id: string): void {
    if (confirm('¿Eliminar esta persona?')) {
      this.escalationService.deleteExternalPerson(id).subscribe({
        next: () => {
          this.showSuccess('Persona eliminada');
          this.loadExternalPeople();
        },
        error: () => this.showError('Error al eliminar persona')
      });
    }
  }

  // ============ CSV ============
  onAssignmentsCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file || this.importingAssignmentsCsv) return;
    this.importingAssignmentsCsv = true;
    this.escalationService.importAssignmentsCsv(file).subscribe({
      next: (response: any) => {
        const obs = response.errorCount > 0 ? ` con ${response.errorCount} observación(es)` : '';
        this.showSuccess(`Turnos procesados: ${response.created} nuevos, ${response.updated} actualizados${obs}`);
        this.loadWeeklyAssignments();
      },
      error: (err: any) => this.showError(err?.error?.message || 'Error importando CSV'),
      complete: () => {
        this.importingAssignmentsCsv = false;
        if (input) input.value = '';
      }
    });
  }

  downloadAssignmentTemplate(): void {
    if (this.downloadingAssignmentTemplate) return;
    this.downloadingAssignmentTemplate = true;
    this.escalationService.downloadAssignmentsTemplateCsv().subscribe({
      next: (blob: Blob) => this.downloadBlob(blob, 'turnos-internos-template.csv'),
      error: () => this.showError('Error descargando plantilla'),
      complete: () => this.downloadingAssignmentTemplate = false
    });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // ============ HELPERS Y AUTOPLAY ============
  private updateAssignmentPeopleOptions(): void {
    const roleCode = String(this.assignmentForm?.get('roleCode')?.value || '').trim();
    const currentVal = String(this.assignmentForm?.get('assignedUserId')?.value || '');
    this.updateAssignmentPeopleOptionsForRole(roleCode, currentVal);
  }

  /**
   * Carga las listas filtradas según el rol y garantiza que la persona
   * actualmente asignada (currentAssignedVal) siempre esté en las opciones,
   * incluso si no coincide con el filtro de cargo.
   */
  private updateAssignmentPeopleOptionsForRole(roleCode: string, currentAssignedVal: string): void {
    const hasDisplay = (u: any) => !!(u?.fullName || u?.username || u?.email);
    const externalDirectoryContacts = (this.directoryContacts || [])
      .filter((c) => this.isDirectoryContactExternal(c) && this.isDirectoryPersonContact(c));
    const internalDirectoryContacts = (this.directoryContacts || [])
      .filter((c) => this.isDirectoryContactInternal(c) && this.isDirectoryPersonContact(c));

    if (roleCode === 'N2') {
      this.filteredUsersForAssignment = this.users.filter((u) => hasDisplay(u) && this.matchesRoleCargo(u, 'N2'));
      this.filteredExternalPeopleForAssignment = this.externalPeople.filter((p) => this.matchesRoleCargo(p, 'N2'));
      this.filteredDirectoryContactsForAssignment = externalDirectoryContacts.filter((c) => this.matchesRoleCargo(c, 'N2'));
      this.showExternalPeopleForAssignment = this.filteredExternalPeopleForAssignment.length > 0 || this.filteredDirectoryContactsForAssignment.length > 0;
    } else if (roleCode === 'N1_NO_HABIL') {
      this.filteredUsersForAssignment = this.users.filter((u) => hasDisplay(u) && this.matchesRoleCargo(u, 'N1_NO_HABIL'));
      this.filteredExternalPeopleForAssignment = this.externalPeople.filter((p) => this.matchesRoleCargo(p, 'N1_NO_HABIL'));
      this.filteredDirectoryContactsForAssignment = externalDirectoryContacts.filter((c) => this.matchesRoleCargo(c, 'N1_NO_HABIL'));
      this.showExternalPeopleForAssignment = this.filteredExternalPeopleForAssignment.length > 0 || this.filteredDirectoryContactsForAssignment.length > 0;
    } else if (roleCode === 'TI') {
      this.filteredUsersForAssignment = this.users.filter((u) => {
        if (!hasDisplay(u)) return false;
        const isN2 = this.matchesRoleCargo(u, 'N2');
        const isN1 = this.matchesRoleCargo(u, 'N1_NO_HABIL');
        return !isN2 && !isN1;
      });
      this.filteredExternalPeopleForAssignment = [];
      this.filteredDirectoryContactsForAssignment = internalDirectoryContacts;
      this.showExternalPeopleForAssignment = this.filteredDirectoryContactsForAssignment.length > 0;
    } else {
      this.filteredUsersForAssignment = this.users.filter((u) => hasDisplay(u));
      this.filteredExternalPeopleForAssignment = [...this.externalPeople];
      this.filteredDirectoryContactsForAssignment = [...externalDirectoryContacts];
      this.showExternalPeopleForAssignment = true;
    }

    // Garantizar que la persona asignada siempre esté en la lista
    if (currentAssignedVal) {
      const s = currentAssignedVal;
      if (s.startsWith('ext_')) {
        const extId = s.replace('ext_', '');
        const alreadyInList = this.filteredExternalPeopleForAssignment.some((p: any) => String(p._id) === extId);
        if (!alreadyInList) {
          const match = this.externalPeople.find((p: any) => String(p._id) === extId);
          if (match) {
            this.filteredExternalPeopleForAssignment = [match, ...this.filteredExternalPeopleForAssignment];
            this.showExternalPeopleForAssignment = true;
          }
        }
      } else if (s.startsWith('dir_')) {
        const dirId = s.replace('dir_', '');
        const alreadyInList = this.filteredDirectoryContactsForAssignment.some((c: any) => String(c._id) === dirId);
        if (!alreadyInList) {
          const match = (this.directoryContacts || []).find((c: any) => String(c._id) === dirId);
          if (match) {
            this.filteredDirectoryContactsForAssignment = [match, ...this.filteredDirectoryContactsForAssignment];
            this.showExternalPeopleForAssignment = true;
          }
        }
      } else {
        const alreadyInList = this.filteredUsersForAssignment.some((u: any) => String(u._id) === s);
        if (!alreadyInList) {
          const match = this.users.find((u: any) => String(u._id) === s);
          if (match) {
            this.filteredUsersForAssignment = [match, ...this.filteredUsersForAssignment];
          }
        }
      }
    }
  }

  private matchesRoleCargo(entity: any, roleCode: 'N1_NO_HABIL' | 'N2' | 'TI'): boolean {
    const roleToken = roleCode === 'N1_NO_HABIL' ? 'N1' : roleCode;
    const candidates = [
      String(entity?.cargoLabel || ''),
      String(entity?.position || ''),
      String(entity?.role || '')
    ].map((value) => value.trim().toUpperCase()).filter((value) => value.length > 0);

    return candidates.some((value) => {
      if (value === roleToken) return true;
      if (value.startsWith(`${roleToken} `)) return true;
      if (value.includes(` ${roleToken} `)) return true;
      return value.includes(roleToken);
    });
  }

  private buildInternalClientCompanyKeys(logSourcesResponse: any): Set<string> {
    const items = Array.isArray(logSourcesResponse?.items)
      ? logSourcesResponse.items
      : (Array.isArray(logSourcesResponse) ? logSourcesResponse : []);

    const keys = new Set<string>();
    items
      .filter((item: any) => item?.enabled !== false && item?.isInternal === true)
      .forEach((item: any) => {
        const key = this.normalizeCompanyKey(item?.name);
        if (key) {
          keys.add(key);
        }
      });
    return keys;
  }

  private normalizeCompanyKey(value: unknown): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private isDirectoryContactInternal(contact: DirectoryContact): boolean {
    const type = String(contact?.type || '').trim();
    const scope = String(contact?.scope || '').trim();
    const source = String(contact?.source || '').trim();
    if (type === 'Internal' || scope === 'Internal' || source === 'User') {
      return true;
    }

    const companyKey = this.normalizeCompanyKey(contact?.company);
    return !!companyKey && this.internalClientCompanyKeys.has(companyKey);
  }

  private isDirectoryContactExternal(contact: DirectoryContact): boolean {
    return !this.isDirectoryContactInternal(contact);
  }

  private isDirectoryPersonContact(contact: DirectoryContact): boolean {
    return String(contact?.type || '').trim() !== 'List';
  }

  private findInternalUserIdFromDirectoryContact(contact: DirectoryContact): string {
    const email = String(contact?.email || '').trim().toLowerCase();
    if (email) {
      const emailMatch = (this.users || []).find((user: any) => String(user?.email || '').trim().toLowerCase() === email);
      if (emailMatch?._id) {
        return String(emailMatch._id);
      }
    }

    const contactName = this.normalizeCompanyKey(contact?.name);
    if (!contactName) {
      return '';
    }

    const nameMatch = (this.users || []).find((user: any) => this.normalizeCompanyKey(user?.fullName) === contactName);
    return nameMatch?._id ? String(nameMatch._id) : '';
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('es-CL');
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }

  // ============ DIRECTORY QUICK PICKER ============
  openDirectoryQuickPicker(target: 'external', queryHint = ''): void {
    this.directoryQuickPickerTarget = target;
    this.directoryQuickPickerVisible = true;
    this.directoryQuickPickerQuery = String(queryHint || '').trim();
    this.directoryQuickPickerSuggestions = this.getLocalDirectoryMatches(this.directoryQuickPickerQuery);
  }

  closeDirectoryQuickPicker(): void {
    this.directoryQuickPickerVisible = false;
    this.directoryQuickPickerTarget = null;
    this.directoryQuickPickerQuery = '';
    this.directoryQuickPickerSuggestions = [];
  }

  onDirectoryQuickPickerInput(rawValue: string): void {
    const query = String(rawValue || '').trim();
    this.directoryQuickPickerQuery = query;
    if (this.directoryQuickPickerTimer) clearTimeout(this.directoryQuickPickerTimer);
    if (query.length < 2) {
      this.directoryQuickPickerSuggestions = this.getLocalDirectoryMatches(query);
      return;
    }
    this.directoryQuickPickerTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items: DirectoryContact[]) => this.directoryQuickPickerSuggestions = items || [],
        error: () => this.directoryQuickPickerSuggestions = []
      });
    }, 250);
  }

  useDirectoryQuickPick(contact: DirectoryContact): void {
    if (!contact || this.directoryQuickPickerTarget !== 'external') return;
    this.externalPersonForm.patchValue({
      name: contact.name || '',
      email: contact.email || this.externalPersonForm.get('email')?.value || '',
      phone: contact.phone || this.externalPersonForm.get('phone')?.value || '',
      position: contact.position || this.externalPersonForm.get('position')?.value || ''
    }, { emitEvent: false });
    this.closeDirectoryQuickPicker();
  }

  private getLocalDirectoryMatches(term: string): DirectoryContact[] {
    const normalized = String(term || '').trim().toLowerCase();
    const source = (this.directoryContacts || []).filter((c) => this.isDirectoryContactExternal(c) && this.isDirectoryPersonContact(c));
    if (!normalized) return source.slice(0, 8);
    return source.filter((c) => [c.name, c.email, c.phone, c.company].some(v => String(v || '').toLowerCase().includes(normalized))).slice(0, 8);
  }

  onExternalPersonNameInput(rawValue: string): void {
    const query = String(rawValue || '').trim();
    if (this.externalPersonNameSearchTimer) clearTimeout(this.externalPersonNameSearchTimer);
    if (query.length < 2) {
      this.externalPersonDirectorySuggestions = this.getLocalDirectoryMatches(query);
      return;
    }
    this.externalPersonNameSearchTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items: DirectoryContact[]) => this.externalPersonDirectorySuggestions = items || [],
        error: () => this.externalPersonDirectorySuggestions = []
      });
    }, 250);
  }

  onExternalPersonNameFocus(): void {
    const currentValue = String(this.externalPersonForm.get('name')?.value || '');
    this.externalPersonDirectorySuggestions = this.getLocalDirectoryMatches(currentValue);
  }

  onExternalPersonDirectorySelected(contact: DirectoryContact): void {
    this.externalPersonForm.patchValue({
      name: contact.name || '',
      email: contact.email || this.externalPersonForm.get('email')?.value || '',
      phone: contact.phone || this.externalPersonForm.get('phone')?.value || '',
      position: contact.position || this.externalPersonForm.get('position')?.value || ''
    }, { emitEvent: false });
    this.externalPersonDirectorySuggestions = [];
    this.closeDirectoryQuickPicker();
  }

  displayDirectoryContact(value: DirectoryContact | string | null): string {
    return typeof value === 'string' ? value : (value?.name || '');
  }

  // ============ TURNOS DIARIOS / CONFIGURACION ============
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
    formData.code = formData.code.toUpperCase();
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
    this.initForm();
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
    const assignedIds = this.assignments
      .filter(a => a.active !== false && (typeof a.workShiftId === 'object' ? a.workShiftId._id === shift._id : a.workShiftId === shift._id))
      .map(a => typeof a.userId === 'object' ? a.userId._id : a.userId);

    if (assignedIds.length === 0) {
      return 'Sin asignar';
    }

    if (assignedIds.length === 1) {
      return this.getLoadedUserName(assignedIds[0]);
    }

    return `${assignedIds.length} asignados`;
  }

  get recipients() {
    return this.globalEmailForm.get('recipients') as any;
  }

  toggleGlobalEmailConfig(): void {
    this.showGlobalEmailConfig = !this.showGlobalEmailConfig;
  }

  private ensurePocShiftSelection(): void {
    if (!this.shifts || this.shifts.length === 0) {
      this.selectedPocShiftId = null;
      return;
    }

    const selectedStillExists = this.selectedPocShiftId
      && this.shifts.some((shift) => shift._id === this.selectedPocShiftId);

    if (selectedStillExists) {
      return;
    }

    const preferred = this.shifts.find((shift) => shift.active && shift.type === 'regular')
      || this.shifts.find((shift) => shift.active)
      || this.shifts[0];

    this.selectedPocShiftId = preferred?._id || null;
  }

  sendPocReport(): void {
    if (!this.selectedPocShiftId) {
      this.snackBar.open('Selecciona un turno para enviar prueba PoC', 'Cerrar', { duration: 3000 });
      return;
    }

    this.sendingPoc = true;
    this.workShiftService.sendShiftReportPoc(this.selectedPocShiftId).subscribe({
      next: (result: any) => {
        this.sendingPoc = false;
        if (result?.success) {
          this.snackBar.open(result?.message || 'Vista previa PoC enviada y auditada como prueba', 'Cerrar', { duration: 3500 });
          return;
        }
        this.snackBar.open(result?.message || 'No se pudo enviar correo PoC', 'Cerrar', { duration: 3500 });
      },
      error: (error: any) => {
        this.sendingPoc = false;
        console.error('Error sending PoC shift report:', error);
        this.snackBar.open(error?.error?.error || 'Error al enviar correo PoC', 'Cerrar', { duration: 3500 });
      }
    });
  }

  addEmail(event: Event): void {
    event.preventDefault();
    const input = this.emailInput.trim().toLowerCase();

    if (!input) return;

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

    const globalConfig = this.globalEmailForm.value;

    this.configService.updateConfig({ emailReportConfig: globalConfig }).subscribe({
      next: () => {
        if (this.shifts.length > 0) {
          this.shifts.forEach(shift => {
            shift.emailReportConfig = {
              ...shift.emailReportConfig,
              ...globalConfig
            };
          });

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
