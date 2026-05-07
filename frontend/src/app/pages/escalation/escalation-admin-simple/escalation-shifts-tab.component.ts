import { Component, Input, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EscalationService } from '../../../services/escalation.service';
import { UserService } from '../../../services/user.service';
import { ConfigService } from '../../../services/config.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-escalation-shifts-tab',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatSnackBarModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatTooltipModule
  ],
  templateUrl: './escalation-shifts-tab.component.html',
  styleUrls: ['./escalation-shifts-tab.component.scss']
})
export class EscalationShiftsTabComponent implements OnInit {
  @Input() isAdminUser = false;
  @Input() directoryContacts: DirectoryContact[] = [];

  // Turnos internos
  assignments: any[] = [];
  currentMonthAssignments: any[] = [];
  futureAssignments: any[] = [];
  previousMonthAssignments: any[] = [];
  historicalAssignments: any[] = [];
  loadingAssignments = false;
  loadingHistoricalAssignments = false;
  savingAssignment = false;
  importingAssignmentsCsv = false;
  downloadingAssignmentTemplate = false;
  historicalLoaded = false;
  showHistorical = false;
  showAssignmentForm = false;
  assignmentForm!: FormGroup;
  users: any[] = [];
  filteredUsersForAssignment: any[] = [];
  filteredExternalPeopleForAssignment: any[] = [];
  filteredDirectoryContactsForAssignment: DirectoryContact[] = [];
  showExternalPeopleForAssignment = true;
  roles = ['N2', 'TI', 'N1_NO_HABIL'];

  // Recordatorios
  escalationReminderForm!: FormGroup;
  availableCargoLabels: string[] = [];
  readonly defaultReminderCargoLabels: string[] = [
    'N1', 'N2', 'N3', 'QA Nivel 1', 'QA Nivel 2', 'Pentester N1', 'Pentester N2',
    'Arquitecto SIEM', 'Customer Success Manager (CSM)', 'Jefe ├ürea', 'Gerente ├ürea'
  ];
  loadingEscalationReminderConfig = false;
  savingEscalationReminderConfig = false;
  testingEscalationReminder = false;
  
  // Automatizaci├│n de Env├¡o (ESC-SHIFT-111)
  escalationScheduleAutomationForm!: FormGroup;
  loadingAutomationConfig = false;
  savingAutomationConfig = false;
  triggeringManualSend = false;
  daysOfWeek = [
    { value: 1, label: 'Lunes' },
    { value: 2, label: 'Martes' },
    { value: 3, label: 'Mi├®rcoles' },
    { value: 4, label: 'Jueves' },
    { value: 5, label: 'Viernes' },
    { value: 6, label: 'S├íbado' },
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

  // Directory Quick Picker (Local to tab)
  directoryQuickPickerVisible = false;
  directoryQuickPickerQuery = '';
  directoryQuickPickerSuggestions: DirectoryContact[] = [];
  directoryQuickPickerTarget: 'external' | null = null;
  private directoryQuickPickerTimer?: any;

  constructor(
    private fb: FormBuilder,
    private escalationService: EscalationService,
    private userService: UserService,
    private configService: ConfigService,
    private directoryService: DirectoryService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.initForms();
    this.loadAllData();
  }

  private initForms(): void {
    this.assignmentForm = this.fb.group({
      roleCode: ['', Validators.required],
      assignedUserId: ['', Validators.required],
      weekStartDate: ['', Validators.required],
      weekEndDate: ['', Validators.required],
      startTime: ['08:00', Validators.required],
      endTime: ['18:00', Validators.required]
    });

    this.assignmentForm.get('roleCode')?.valueChanges.subscribe(() => {
      this.updateAssignmentPeopleOptions();
    });

    this.assignmentForm.get('weekStartDate')?.valueChanges.subscribe((startDate) => {
      if (startDate) {
        const start = new Date(startDate);
        const endDate = new Date(start);
        endDate.setDate(endDate.getDate() + 7);
        this.assignmentForm.patchValue({ weekEndDate: endDate }, { emitEvent: false });
      }
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

    this.escalationScheduleAutomationForm = this.fb.group({
      enabled: [false],
      frequency: ['weekly'],
      dayOfWeek: [1],
      time: ['09:00', [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      recipients: [''],
      ccRecipients: ['']
    });

    this.escalationReminderForm.get('escalationReminderEnabled')?.valueChanges.subscribe(() => {
      this.updateEscalationReminderValidators();
    });
    this.updateEscalationReminderValidators();
  }

  loadAllData(): void {
    this.loadUsers();
    this.loadExternalPeople();
    this.loadAssignments();
    this.loadEscalationReminderConfig();
    this.loadAutomationConfig();
  }

  // ============ TURNOS INTERNOS ============
  loadUsers(): void {
    this.escalationService.getUsers().subscribe({
      next: (data: any[]) => {
        this.users = [...data];
        this.refreshAvailableCargoLabels();
        this.updateAssignmentPeopleOptions();
        setTimeout(() => this.cdr.detectChanges(), 0);
      },
      error: () => {
        this.userService.getUsersList().subscribe({
          next: (data: any[]) => {
            this.users = [...data];
            this.refreshAvailableCargoLabels();
            this.updateAssignmentPeopleOptions();
            setTimeout(() => this.cdr.detectChanges(), 0);
          },
          error: () => {
            this.showError('Error al cargar usuarios');
            this.users = [];
            this.refreshAvailableCargoLabels();
            this.updateAssignmentPeopleOptions();
          }
        });
      }
    });
  }

  loadAssignments(): void {
    this.loadingAssignments = true;
    const currentDate = new Date();
    const fromDate = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1).toISOString();

    this.escalationService.getAssignments(undefined, fromDate).subscribe({
      next: (data: any[]) => {
        this.assignments = [...data].sort((a: any, b: any) => 
          new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()
        );
        this.partitionAssignmentsByMonth(this.assignments);
        this.loadingAssignments = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingAssignments = false;
      }
    });
  }

  loadHistoricalAssignments(): void {
    if (this.historicalLoaded || this.loadingHistoricalAssignments) return;
    this.loadingHistoricalAssignments = true;
    const currentDate = new Date();
    const previousMonthEnd = this.getEndOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1).toISOString();

    this.escalationService.getAssignments(undefined, undefined, previousMonthEnd, 200).subscribe({
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
        this.showError('Error al cargar hist├│rico de asignaciones');
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
    if (date >= nextMonthStart) return 'Pr├│ximos meses';
    if (date >= previousMonthStart && date < currentMonthStart) return 'Mes anterior';
    return 'Hist├│rico';
  }

  addAssignment(): void {
    this.showAssignmentForm = true;
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

  saveAssignment(): void {
    if (this.assignmentForm.invalid || this.savingAssignment) {
      this.showError('Complete todos los campos');
      return;
    }

    this.savingAssignment = true;
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

      this.escalationService.createAssignment(data).subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showSuccess('Turno asignado correctamente');
            this.showAssignmentForm = false;
            this.loadAssignments();
            this.savingAssignment = false;
          });
        },
        error: (err: any) => {
          const backendMessage = err?.error?.error || err?.error?.message;
          const sectionLabel = this.getSelectedAssignmentSectionLabel();
          const enhancedMessage = backendMessage?.includes('mismo per├¡odo') && sectionLabel
            ? `${backendMessage}. Rev├¡sala en "${sectionLabel}".`
            : backendMessage;
          this.showError(enhancedMessage || 'Error al asignar turno');
          this.savingAssignment = false;
        }
      });
    };

    if (assignedUserIdRaw.startsWith('dir_')) {
      const directoryId = assignedUserIdRaw.replace('dir_', '');
      this.ensureExternalPersonFromDirectory(directoryId).subscribe({
        next: (externalPersonId) => {
          if (!externalPersonId) {
            this.showError('No se pudo resolver la persona del directorio para asignar el turno.');
            this.savingAssignment = false;
            return;
          }
          submitAssignment(undefined, externalPersonId);
        },
        error: () => {
          this.showError('No se pudo preparar la persona desde el directorio.');
          this.savingAssignment = false;
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

  deleteAssignment(id: string): void {
    if (confirm('┬┐Eliminar esta asignaci├│n?')) {
      this.escalationService.deleteAssignment(id).subscribe({
        next: () => {
          this.showSuccess('Asignaci├│n eliminada');
          this.loadAssignments();
        },
        error: () => this.showError('Error al eliminar')
      });
    }
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
      next: () => this.showSuccess('Recordatorio de escalaci├│n interna actualizado'),
      error: () => this.showError('Error guardando recordatorio'),
      complete: () => this.savingEscalationReminderConfig = false
    });
  }

  // ============ AUTOMATIZACI├ôN DE TURNOS (ESC-SHIFT-111) ============
  loadAutomationConfig(): void {
    this.loadingAutomationConfig = true;
    this.configService.getConfig().subscribe({
      next: (config: any) => {
        const auto = config.escalationScheduleAutomation || {};
        this.escalationScheduleAutomationForm.patchValue({
          enabled: auto.enabled ?? false,
          frequency: auto.frequency || 'weekly',
          dayOfWeek: auto.dayOfWeek ?? 1,
          time: auto.time || '09:00',
          recipients: Array.isArray(auto.recipients) ? auto.recipients.join(', ') : '',
          ccRecipients: Array.isArray(auto.ccRecipients) ? auto.ccRecipients.join(', ') : ''
        });
        this.loadingAutomationConfig = false;
      },
      error: () => this.loadingAutomationConfig = false
    });
  }

  saveAutomationConfig(): void {
    if (this.escalationScheduleAutomationForm.invalid || this.savingAutomationConfig) return;
    this.savingAutomationConfig = true;
    
    const val = this.escalationScheduleAutomationForm.value;
    const payload = {
      escalationScheduleAutomation: {
        enabled: val.enabled,
        frequency: val.frequency,
        dayOfWeek: val.dayOfWeek,
        time: val.time,
        recipients: val.recipients.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean),
        ccRecipients: val.ccRecipients.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      }
    };

    this.configService.updateConfig(payload).subscribe({
      next: () => this.showSuccess('Configuraci├│n de automatizaci├│n guardada'),
      error: () => this.showError('Error al guardar configuraci├│n'),
      complete: () => this.savingAutomationConfig = false
    });
  }

  triggerManualSend(): void {
    if (this.triggeringManualSend) return;
    
    if (!confirm('┬┐Desea enviar los turnos ahora a los destinatarios configurados?')) return;

    this.triggeringManualSend = true;
    this.escalationService.triggerAutomationSend().subscribe({
      next: (res: any) => this.showSuccess(res.message || 'Env├¡o procesado correctamente'),
      error: (err: any) => this.showError(err?.error?.error || 'Error al disparar el env├¡o'),
      complete: () => this.triggeringManualSend = false
    });
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

    // Use the cached raw value (saved before mat-autocomplete overwrites the control)
    const cached = controlName === 'recipients' ? this._recipientsRaw : this._ccRaw;
    const parts = cached
      .split(',')
      .map((s) => String(s || '').trim())
      .filter((s) => s.length > 0);

    // Remove the last token if it was the partial query that triggered the selection
    const lastToken = String(parts[parts.length - 1] || '').toLowerCase();
    if (lastToken && normalizedEmail.startsWith(lastToken) && lastToken !== normalizedEmail) {
      parts.pop();
    }

    const existing = parts.map((s) => s.toLowerCase());
    if (!existing.includes(normalizedEmail)) {
      existing.push(normalizedEmail);
    }

    const newValue = existing.join(', ');
    const control = this.escalationScheduleAutomationForm.get(controlName);
    control?.setValue(newValue);

    // Keep cache in sync so subsequent selections also work correctly
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
      error: () => this.loadingExternalPeople = false
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
    if (confirm('┬┐Eliminar esta persona?')) {
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
        const obs = response.errorCount > 0 ? ` con ${response.errorCount} observaci├│n(es)` : '';
        this.showSuccess(`Turnos procesados: ${response.created} nuevos, ${response.updated} actualizados${obs}`);
        this.loadAssignments();
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

  // ============ HELPERS ============
  private updateAssignmentPeopleOptions(): void {
    const roleCode = String(this.assignmentForm?.get('roleCode')?.value || '').trim();
    if (roleCode === 'N2') {
      this.filteredUsersForAssignment = this.users.filter((u) => this.matchesRoleCargo(u, 'N2'));
      this.filteredExternalPeopleForAssignment = this.externalPeople.filter((p) => this.matchesRoleCargo(p, 'N2'));
      this.filteredDirectoryContactsForAssignment = (this.directoryContacts || []).filter((c) => this.matchesRoleCargo(c, 'N2'));
      this.showExternalPeopleForAssignment = this.filteredExternalPeopleForAssignment.length > 0 || this.filteredDirectoryContactsForAssignment.length > 0;
    } else if (roleCode === 'N1_NO_HABIL') {
      this.filteredUsersForAssignment = this.users.filter((u) => this.matchesRoleCargo(u, 'N1_NO_HABIL'));
      this.filteredExternalPeopleForAssignment = this.externalPeople.filter((p) => this.matchesRoleCargo(p, 'N1_NO_HABIL'));
      this.filteredDirectoryContactsForAssignment = (this.directoryContacts || []).filter((c) => this.matchesRoleCargo(c, 'N1_NO_HABIL'));
      this.showExternalPeopleForAssignment = this.filteredExternalPeopleForAssignment.length > 0 || this.filteredDirectoryContactsForAssignment.length > 0;
    } else if (roleCode === 'TI') {
      this.filteredUsersForAssignment = this.users.filter((u) => this.matchesRoleCargo(u, 'TI'));
      this.filteredExternalPeopleForAssignment = this.externalPeople.filter((p) => this.matchesRoleCargo(p, 'TI'));
      this.filteredDirectoryContactsForAssignment = (this.directoryContacts || []).filter((c) => this.matchesRoleCargo(c, 'TI'));
      this.showExternalPeopleForAssignment = this.filteredExternalPeopleForAssignment.length > 0 || this.filteredDirectoryContactsForAssignment.length > 0;
    } else {
      this.filteredUsersForAssignment = [...this.users];
      this.filteredExternalPeopleForAssignment = [...this.externalPeople];
      this.filteredDirectoryContactsForAssignment = [...(this.directoryContacts || [])];
      this.showExternalPeopleForAssignment = true;
    }
    const selected = this.assignmentForm?.get('assignedUserId')?.value;
    if (selected) {
      const s = String(selected);
      const isExt = s.startsWith('ext_');
      const isDir = s.startsWith('dir_');
      const validExt = isExt && this.showExternalPeopleForAssignment && this.filteredExternalPeopleForAssignment.some(p => `ext_${p._id}` === s);
      const validDir = isDir && this.showExternalPeopleForAssignment && this.filteredDirectoryContactsForAssignment.some(c => `dir_${c._id}` === s);
      const validUsr = !isExt && this.filteredUsersForAssignment.some(u => String(u._id) === s);
      if (!validExt && !validDir && !validUsr) this.assignmentForm.patchValue({ assignedUserId: '' }, { emitEvent: false });
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

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('es-CL');
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }

  // ============ DIRECTORY QUICK PICKER (External Only) ============
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
    const source = this.directoryContacts || [];
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
}
