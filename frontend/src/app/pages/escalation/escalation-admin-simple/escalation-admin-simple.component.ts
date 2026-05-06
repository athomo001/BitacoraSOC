/**
 * File Purpose: frontend/src/app/pages/escalation/escalation-admin-simple/escalation-admin-simple.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit, ChangeDetectorRef, NgZone, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, DateAdapter, NativeDateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { EscalationService } from '../../../services/escalation.service';
import { UserService } from '../../../services/user.service';
import { CatalogService } from '../../../services/catalog.service';
import { ConfigService } from '../../../services/config.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { AuthService } from '../../../services/auth.service';
import { CatalogLogSource } from '../../../models/catalog.model';
import { EscalationFlowStep } from '../../../models/escalation.model';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

@Injectable()
class MondayFirstNativeDateAdapter extends NativeDateAdapter {
  // Mostrar lunes como inicio de semana en el datepicker
  override getFirstDayOfWeek(): number {
    return 1;
  }
}

@Component({
    selector: 'app-escalation-admin-simple',
    imports: [
        CommonModule,
      FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatSnackBarModule,
        MatDatepickerModule,
        MatNativeDateModule,
        MatTabsModule,
        MatExpansionModule,
        MatCheckboxModule,
        MatAutocompleteModule,
        MatTooltipModule,
        DragDropModule
    ],
    providers: [
        { provide: MAT_DATE_LOCALE, useValue: 'es-CL' },
        {
            provide: DateAdapter,
            useClass: MondayFirstNativeDateAdapter
        }
    ],
    templateUrl: './escalation-admin-simple.component.html',
    styleUrls: ['./escalation-admin-simple.component.scss']
})
export class EscalationAdminSimpleComponent implements OnInit {
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
  showExternalPeopleForAssignment = true;
  roles = ['N2', 'TI', 'N1_NO_HABIL'];
  escalationReminderForm!: FormGroup;
  availableCargoLabels: string[] = [];
  readonly defaultReminderCargoLabels: string[] = [
    'N1',
    'N2',
    'N3',
    'QA Nivel 1',
    'QA Nivel 2',
    'Pentester N1',
    'Pentester N2',
    'Arquitecto SIEM',
    'Customer Success Manager (CSM)',
    'Jefe Área',
    'Gerente Área'
  ];
  loadingEscalationReminderConfig = false;
  savingEscalationReminderConfig = false;
  testingEscalationReminder = false;

  // Personas externas (no usuarios del sistema)
  externalPeople: any[] = [];
  loadingExternalPeople = false;
  showExternalPersonForm = false;
  externalPersonForm!: FormGroup;
  editingExternalPersonId: string | null = null;
  externalPersonDirectorySuggestions: DirectoryContact[] = [];
  private externalPersonNameSearchTimer?: ReturnType<typeof setTimeout>;

  // Contactos de escalación + agenda preventiva
  clients: any[] = [];
  services: any[] = [];
  contacts: any[] = [];
  flowClientSearch = '';
  serviceClientSearch = '';
  raciClientSearch = '';
  showQuickClientForm = false;
  quickClientName = '';
  quickClientDescription = '';
  savingQuickClient = false;
  selectedFlowClientId: string | null = null;
  flowSteps: any[] = [];
  flowLegend = '';
  loadingFlow = false;
  savingFlow = false;
  directorySuggestions: Record<string, DirectoryContact[]> = {};
  private directorySearchTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
  directoryContacts: DirectoryContact[] = [];
  directorySearch = '';
  directoryTypeFilter: '' | 'Internal' | 'External' | 'List' = '';
  directoryPageSize = 10;
  directoryPageIndex = 0;
  loadingDirectoryContacts = false;
  rebuildingDirectory = false;
  showDirectoryForm = false;
  savingDirectoryContact = false;
  editingDirectoryContactId: string | null = null;
  directoryQuickPickerVisible = false;
  directoryQuickPickerQuery = '';
  directoryQuickPickerSuggestions: DirectoryContact[] = [];
  directoryQuickPickerTarget: 'contact' | 'external' | 'raci:responsible' | 'raci:accountable' | 'raci:consulted' | 'raci:informed' | null = null;
  private directoryQuickPickerTimer?: ReturnType<typeof setTimeout>;
  isAdminUser = false;
  directoryOnlyAccess = false;
  canDirectoryWrite = false;
  canDirectoryDelete = false;
  directoryFormModel: {
    name: string;
    email: string;
    phone: string;
    company: string;
    position: string;
    type: 'Internal' | 'External' | 'List';
    isFavorite: boolean;
  } = {
    name: '',
    email: '',
    phone: '',
    company: '',
    position: '',
    type: 'External',
    isFavorite: false
  };
  loadingClients = false;
  loadingServices = false;
  loadingContacts = false;
  importingPreventiveCsv = false;
  exportingPreventiveCsv = false;
  preventiveSearch = '';
  preventiveCompanyFilter = '';
  preventiveFavoritesOnly = false;
  preventiveTypeFilter: '' | 'personal' | 'list' = '';
  filteredOrgSuggestions: string[] = [];

  showClientForm = false;
  clientForm!: FormGroup;
  editingClientId: string | null = null;

  showServiceForm = false;
  serviceForm!: FormGroup;
  editingServiceId: string | null = null;

  showContactForm = false;
  contactForm!: FormGroup;
  editingContactId: string | null = null;
  contactDirectorySuggestions: DirectoryContact[] = [];
  private contactNameSearchTimer?: ReturnType<typeof setTimeout>;
  private selectedContactDirectoryId = '';

  // RACI
  raciClients: CatalogLogSource[] = [];
  loadingRaciClients = false;
  raciEntries: any[] = [];
  loadingRaci = false;
  showRaciForm = false;
  raciForm!: FormGroup;
  editingRaciId: string | null = null;
  selectedRaciClientId: string | null = null;
  selectedRaciTopic: string = '';
  reusableRaciTemplates: any[] = [];
  reusableRaciPeople: Array<{ name: string; email: string; phone: string }> = [];
  raciDirectorySuggestions: Record<string, DirectoryContact[]> = {};
  private raciSearchTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

  constructor(
    private fb: FormBuilder,
    private escalationService: EscalationService,
    private userService: UserService,
    private catalogService: CatalogService,
    private directoryService: DirectoryService,
    private authService: AuthService,
    private configService: ConfigService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private router: Router
  ) {}

  readonly displayDirectoryContact = (value: DirectoryContact | string | null): string =>
    typeof value === 'string' ? value : (value?.name || '');

  readonly getDirectoryTypeLabel = (type?: string): string => {
    if (type === 'Internal') return 'Interno';
    if (type === 'List') return 'Lista';
    return 'Externo';
  };

  readonly isDirectoryInternal = (contact?: DirectoryContact | null): boolean =>
    String(contact?.type || '') === 'Internal';

  get pageHeaderTitle(): string {
    return this.directoryOnlyAccess ? 'Directorio Global de Contactos' : 'Administración de Escalamientos';
  }

  get pageHeaderSubtitle(): string {
    return this.directoryOnlyAccess
      ? 'Fuente única de contactos para todos los módulos operativos'
      : 'Configura turnos internos, contactos de escalación y agenda preventiva';
  }

  copyDirectoryValue(value: string, label: 'nombre' | 'correo' | 'telefono'): void {
    const text = String(value || '').trim();
    if (!text || text === '-') {
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      const labelMap = {
        nombre: 'Nombre',
        correo: 'Correo',
        telefono: 'Teléfono'
      } as const;
      this.showSuccess(`${labelMap[label]} copiado al portapapeles`);
    }).catch(() => {
      this.showError('No se pudo copiar al portapapeles');
    });
  }

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    this.isAdminUser = this.authService.hasRole('admin');
    const normalizedCargo = this.normalizeCargoLabel(user?.cargoLabel || '');
    const editOnlyCargos = new Set(['qa nivel 1', 'qa nivel 2', 'customer success manager (csm)', 'customer success manager', 'csm']);
    const fullAccessCargos = new Set(['n2', 'n3', 'jefe area', 'gerente area', 'arquitecto siem']);
    this.canDirectoryWrite = this.isAdminUser || editOnlyCargos.has(normalizedCargo) || fullAccessCargos.has(normalizedCargo);
    this.canDirectoryDelete = this.isAdminUser || fullAccessCargos.has(normalizedCargo);
    this.directoryOnlyAccess = this.router.url.includes('/main/escalation/directory');
    this.initForms();
    this.loadAllData();
  }

  private normalizeCargoLabel(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calcula automáticamente el próximo lunes a las 09:00 y el siguiente lunes a las 08:59
   */
  private calculateDefaultWeekDates() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
    
    // Calcular cuántos días para llegar al próximo lunes
    let daysToNextMonday = 0;
    if (dayOfWeek === 0) {
      // Si es domingo, el próximo lunes es mañana
      daysToNextMonday = 1;
    } else if (dayOfWeek === 1) {
      // Si es lunes, el próximo lunes es en 7 días
      daysToNextMonday = 7;
    } else {
      // Si es otro día (2-6), calcula días hasta el próximo lunes
      daysToNextMonday = 8 - dayOfWeek;
    }
    
    // Próximo lunes a las 09:00
    const nextMonday = new Date(today);
    nextMonday.setDate(nextMonday.getDate() + daysToNextMonday);
    nextMonday.setHours(9, 0, 0, 0);
    
    // Próximo lunes de la siguiente semana a las 08:59
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

  initForms(): void {
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

    // Cuando cambia la fecha de inicio, actualiza automáticamente la fecha de fin al siguiente lunes
    this.assignmentForm.get('weekStartDate')?.valueChanges.subscribe((startDate) => {
      if (startDate) {
        const start = new Date(startDate);
        const endDate = new Date(start);
        endDate.setDate(endDate.getDate() + 7); // Suma 7 días para el siguiente lunes
        this.assignmentForm.patchValue({ weekEndDate: endDate }, { emitEvent: false });
      }
    });

    this.clientForm = this.fb.group({
      name: ['', Validators.required],
      active: [true]
    });

    this.serviceForm = this.fb.group({
      clientId: ['', Validators.required],
      name: ['', Validators.required],
      active: [true]
    });

    this.contactForm = this.fb.group({
      contactType: ['escalation', Validators.required],
      serviceId: [''],
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      organization: [''],
      role: ['PARA'],
      favorite: [false],
      isMailingList: [false],
      doNotSend: [false],
      notes: [''],
      active: [true]
    });

    this.contactForm.get('contactType')?.valueChanges.subscribe(() => {
      this.updateContactValidators();
    });
    this.updateContactValidators();

    this.raciForm = this.fb.group({
      clientId: ['', Validators.required],
      topic: [''],
      activity: ['', Validators.required],
      responsible: this.fb.group({
        name: ['', Validators.required],
        email: [''],
        phone: ['']
      }),
      accountable: this.fb.group({
        name: ['', Validators.required],
        email: [''],
        phone: ['']
      }),
      consulted: this.fb.group({
        name: [''],
        email: [''],
        phone: ['']
      }),
      informed: this.fb.group({
        name: [''],
        email: [''],
        phone: ['']
      }),
      notes: [''],
      active: [true]
    });

    this.raciForm.get('clientId')?.valueChanges.subscribe((clientId) => {
      if (!this.showRaciForm) {
        return;
      }
      this.loadReusableRaciData(clientId || undefined);
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
  }

  loadAllData(): void {
    this.loadUsers();
    this.loadExternalPeople();
    this.loadAssignments();
    this.loadClients();
    this.loadServices();
    this.loadContacts();
    this.loadRaciClients();
    this.loadDirectoryContacts();
    this.loadEscalationReminderConfig();
  }

  private refreshOperationalViewsAfterDirectoryChange(): void {
    this.loadContacts();
    this.loadExternalPeople();
    this.loadRaciEntries();
    this.loadEscalationFlow();
  }

  loadDirectoryContacts(): void {
    this.loadingDirectoryContacts = true;
    this.directoryService.getAll().subscribe({
      next: (contacts) => {
        this.directoryContacts = contacts || [];
        this.ensureDirectoryPageBounds();
        this.loadingDirectoryContacts = false;
      },
      error: () => {
        this.directoryContacts = [];
        this.loadingDirectoryContacts = false;
      }
    });
  }

  get filteredDirectoryContacts(): DirectoryContact[] {
    const term = this.directorySearch.trim().toLowerCase();
    return this.directoryContacts
      .filter((contact) => !this.directoryTypeFilter || contact.type === this.directoryTypeFilter)
      .filter((contact) => !term || [contact.name, contact.email, contact.phone, contact.company]
        .some((value) => String(value || '').toLowerCase().includes(term)));
  }

  get paginatedDirectoryContacts(): DirectoryContact[] {
    const start = this.directoryPageIndex * this.directoryPageSize;
    const end = start + this.directoryPageSize;
    return this.filteredDirectoryContacts.slice(start, end);
  }

  get directoryTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredDirectoryContacts.length / this.directoryPageSize));
  }

  get directoryStartItem(): number {
    if (this.filteredDirectoryContacts.length === 0) {
      return 0;
    }
    return this.directoryPageIndex * this.directoryPageSize + 1;
  }

  get directoryEndItem(): number {
    return Math.min((this.directoryPageIndex + 1) * this.directoryPageSize, this.filteredDirectoryContacts.length);
  }

  applyDirectoryFilters(): void {
    this.directoryPageIndex = 0;
    this.ensureDirectoryPageBounds();
  }

  nextDirectoryPage(): void {
    if (this.directoryPageIndex < this.directoryTotalPages - 1) {
      this.directoryPageIndex += 1;
    }
  }

  prevDirectoryPage(): void {
    if (this.directoryPageIndex > 0) {
      this.directoryPageIndex -= 1;
    }
  }

  private ensureDirectoryPageBounds(): void {
    const totalPages = this.directoryTotalPages;
    if (this.directoryPageIndex > totalPages - 1) {
      this.directoryPageIndex = Math.max(totalPages - 1, 0);
    }
  }

  rebuildDirectoryFromEscalation(): void {
    if (this.rebuildingDirectory) {
      return;
    }
    this.rebuildingDirectory = true;
    this.directoryService.rebuildFromEscalation().subscribe({
      next: (response) => {
        this.showSuccess(response?.message || 'Directorio sincronizado');
        this.loadDirectoryContacts();
        this.refreshOperationalViewsAfterDirectoryChange();
        this.rebuildingDirectory = false;
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'No se pudo sincronizar el directorio');
        this.rebuildingDirectory = false;
      }
    });
  }

  private updateContactValidators(): void {
    const contactType = this.contactForm?.get('contactType')?.value === 'preventive' ? 'preventive' : 'escalation';
    const serviceControl = this.contactForm?.get('serviceId');
    const organizationControl = this.contactForm?.get('organization');
    const roleControl = this.contactForm?.get('role');

    if (!serviceControl || !organizationControl || !roleControl) {
      return;
    }

    if (contactType === 'preventive') {
      serviceControl.clearValidators();
      roleControl.clearValidators();
      organizationControl.setValidators([Validators.required]);
      if (serviceControl.value) {
        serviceControl.setValue('', { emitEvent: false });
      }
      if (!roleControl.value) {
        roleControl.setValue('PREVENTIVO', { emitEvent: false });
      }
    } else {
      serviceControl.setValidators([Validators.required]);
      roleControl.setValidators([Validators.required]);
      organizationControl.clearValidators();
      if (!roleControl.value || roleControl.value === 'PREVENTIVO') {
        roleControl.setValue('PARA', { emitEvent: false });
      }
    }

    serviceControl.updateValueAndValidity({ emitEvent: false });
    roleControl.updateValueAndValidity({ emitEvent: false });
    organizationControl.updateValueAndValidity({ emitEvent: false });
  }

  // ============ TURNOS INTERNOS ============
  loadUsers(): void {
    this.escalationService.getUsers().subscribe({
      next: (data) => {
        this.users = [...data];
        this.refreshAvailableCargoLabels();
        this.updateAssignmentPeopleOptions();
        console.log('✅ Users loaded from escalation service:', this.users.length, 'users');
        if (this.users.length > 0) {
          console.log('First user:', this.users[0]);
        }
        setTimeout(() => this.cdr.detectChanges(), 0);
      },
      error: (err) => {
        console.log('⚠️ Escalation service failed, trying user service...', err.message);
        // Si falla, intentar con endpoint público de users
        this.userService.getUsersList().subscribe({
          next: (data) => {
            this.users = [...data];
            this.refreshAvailableCargoLabels();
            this.updateAssignmentPeopleOptions();
            console.log('✅ Users loaded from user service:', this.users.length, 'users');
            if (this.users.length > 0) {
              console.log('First user:', this.users[0]);
            }
            setTimeout(() => this.cdr.detectChanges(), 0);
          },
          error: (err2) => {
            console.error('❌ Error loading users from user service:', err2);
            this.showError('Error al cargar usuarios');
            this.users = [];
            this.refreshAvailableCargoLabels();
            this.updateAssignmentPeopleOptions();
            setTimeout(() => this.cdr.detectChanges(), 0);
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
      next: (data) => {
        this.assignments = [...data].sort((a: any, b: any) => 
          new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()
        );
        this.partitionAssignmentsByMonth(this.assignments);
        this.loadingAssignments = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading assignments:', err);
        this.loadingAssignments = false;
      }
    });
  }

  loadHistoricalAssignments(): void {
    if (this.historicalLoaded || this.loadingHistoricalAssignments) {
      return;
    }

    this.loadingHistoricalAssignments = true;
    const currentDate = new Date();
    const previousMonthEnd = this.getEndOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1).toISOString();

    this.escalationService.getAssignments(undefined, undefined, previousMonthEnd, 200).subscribe({
      next: (data) => {
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
      error: (err) => {
        console.error('Error loading historical assignments:', err);
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
    if (!startDate) {
      return '';
    }

    return this.getAssignmentSectionLabel(startDate);
  }

  private getAssignmentSectionLabel(dateValue: string | Date): string {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const currentDate = new Date();
    const currentMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth());
    const nextMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
    const previousMonthStart = this.getStartOfMonth(currentDate.getFullYear(), currentDate.getMonth() - 1);

    if (date >= currentMonthStart && date < nextMonthStart) {
      return 'Mes actual';
    }

    if (date >= nextMonthStart) {
      return 'Próximos meses';
    }

    if (date >= previousMonthStart && date < currentMonthStart) {
      return 'Mes anterior';
    }

    return 'Histórico';
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

  saveAssignment(): void {
    if (this.assignmentForm.invalid || this.savingAssignment) {
      this.showError('Complete todos los campos');
      return;
    }

    this.savingAssignment = true;
    const formData = this.assignmentForm.value;
    const isExternal = typeof formData.assignedUserId === 'string' && formData.assignedUserId.startsWith('ext_');
    const externalPersonId = isExternal ? formData.assignedUserId.replace('ext_', '') : undefined;
    // Combinar fecha con hora para crear datetime completo
    const startDateTime = new Date(formData.weekStartDate);
    const [startHour, startMin] = formData.startTime.split(':');
    startDateTime.setHours(parseInt(startHour), parseInt(startMin), 0);
    
    const endDateTime = new Date(formData.weekEndDate);
    const [endHour, endMin] = formData.endTime.split(':');
    endDateTime.setHours(parseInt(endHour), parseInt(endMin), 0);

    const data = {
      roleCode: formData.roleCode,
      userId: isExternal ? undefined : formData.assignedUserId,
      externalPersonId: isExternal ? externalPersonId : undefined,
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
      error: (err) => {
        console.error('Error:', err);
        const backendMessage = err?.error?.error || err?.error?.message;
        const sectionLabel = this.getSelectedAssignmentSectionLabel();
        const enhancedMessage = backendMessage?.includes('mismo período') && sectionLabel
          ? `${backendMessage}. Revísala en "${sectionLabel}".`
          : backendMessage;
        this.showError(enhancedMessage || 'Error al asignar turno');
        this.savingAssignment = false;
      }
    });
  }

  deleteAssignment(id: string): void {
    if (confirm('¿Eliminar esta asignación?')) {
      this.escalationService.deleteAssignment(id).subscribe({
        next: () => {
          this.showSuccess('Asignación eliminada');
          this.loadAssignments();
        },
        error: (err) => {
          console.error('Error:', err);
          this.showError('Error al eliminar');
        }
      });
    }
  }

  // ============ CLIENTES ============
  loadClients(): void {
    this.loadingClients = true;
    this.catalogService.getAllLogSources().subscribe({
      next: (response) => {
        const items = response?.items || response || [];
        this.clients = [...items].filter((client: any) => client.enabled !== false);
        this.raciClients = [...this.clients];
        if (!this.selectedFlowClientId && this.clients.length > 0) {
          this.selectedFlowClientId = this.clients[0]._id;
          this.loadEscalationFlow();
        }
        if (!this.selectedRaciClientId && this.raciClients.length > 0) {
          this.selectedRaciClientId = this.raciClients[0]._id;
          this.loadRaciEntries();
        }
        this.loadingClients = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error:', err);
        this.loadingClients = false;
      }
    });
  }

  onFlowClientChange(): void {
    this.loadEscalationFlow();
  }

  loadEscalationFlow(): void {
    if (!this.selectedFlowClientId) {
      this.flowSteps = [];
      this.flowLegend = '';
      return;
    }

    this.loadingFlow = true;
    this.escalationService.getEscalationFlow(this.selectedFlowClientId).subscribe({
      next: (response) => {
        this.flowSteps = (response?.flow || []).map((step: any, idx: number) => ({
          order: idx + 1,
          title: step?.title || `Paso ${idx + 1}`,
          type: step?.type === 'pool' ? 'pool' : 'unique',
          contactName: step?.contactName || '',
          contactTel: step?.contactTel || '',
          callAt: step?.callAt ? new Date(step.callAt).toISOString().slice(0, 16) : '',
          contacts: Array.isArray(step?.contacts) ? step.contacts.map((c: any) => ({
            name: c?.name || '',
            tel: c?.tel || ''
          })) : []
        }));
        this.flowLegend = response?.legend || '';
        this.loadingFlow = false;
      },
      error: () => {
        this.flowSteps = [];
        this.flowLegend = '';
        this.loadingFlow = false;
      }
    });
  }

  addFlowStep(type: 'unique' | 'pool' = 'unique'): void {
    this.flowSteps.push({
      order: this.flowSteps.length + 1,
      title: type === 'pool' ? 'POOL de Llamados' : `${this.flowSteps.length + 1}er Llamado`,
      type,
      contactName: '',
      contactTel: '',
      callAt: '',
      contacts: type === 'pool' ? [{ name: '', tel: '' }] : []
    });
    this.cleanupDirectoryState();
  }

  deleteFlowStep(index: number): void {
    this.flowSteps.splice(index, 1);
    this.reindexFlowSteps();
  }

  addPoolContact(stepIndex: number): void {
    if (!Array.isArray(this.flowSteps[stepIndex].contacts)) {
      this.flowSteps[stepIndex].contacts = [];
    }
    this.flowSteps[stepIndex].contacts.push({ name: '', tel: '' });
    this.cleanupDirectoryState();
  }

  removePoolContact(stepIndex: number, contactIndex: number): void {
    this.flowSteps[stepIndex].contacts.splice(contactIndex, 1);
    this.cleanupDirectoryState();
  }

  dropFlowStep(event: CdkDragDrop<any[]>): void {
    moveItemInArray(this.flowSteps, event.previousIndex, event.currentIndex);
    this.reindexFlowSteps();
  }

  saveEscalationFlow(): void {
    if (!this.selectedFlowClientId || this.savingFlow) {
      return;
    }

    this.savingFlow = true;
    const payload: { flow: EscalationFlowStep[]; legend: string } = {
      flow: this.flowSteps.map((step, idx): EscalationFlowStep => ({
        order: idx + 1,
        title: String(step?.title || '').trim() || `Paso ${idx + 1}`,
        type: step?.type === 'pool' ? 'pool' : 'unique',
        contactName: step?.type === 'pool' ? '' : String(step?.contactName || '').trim(),
        contactTel: step?.type === 'pool' ? '' : String(step?.contactTel || '').trim(),
        callAt: step?.type === 'pool' ? null : (step?.callAt ? new Date(step.callAt).toISOString() : null),
        contacts: step?.type === 'pool'
          ? (Array.isArray(step?.contacts) ? step.contacts.map((c: any) => ({
            name: String(c?.name || '').trim(),
            tel: String(c?.tel || '').trim()
          })) : []).filter((c: any) => c.name || c.tel)
          : []
      })),
      legend: String(this.flowLegend || '').trim()
    };

    this.syncNewFlowContactsToDirectory(this.flowSteps as any).pipe(
      switchMap(() => this.escalationService.saveEscalationFlow(this.selectedFlowClientId as string, payload))
    ).subscribe({
      next: () => {
        this.showSuccess('Flujo de escalamiento actualizado');
        this.savingFlow = false;
        this.loadDirectoryContacts();
        this.loadEscalationFlow();
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'Error guardando flujo de escalamiento');
        this.savingFlow = false;
      }
    });
  }

  private reindexFlowSteps(): void {
    this.flowSteps = this.flowSteps.map((step, idx) => ({ ...step, order: idx + 1 }));
    this.cleanupDirectoryState();
  }

  getDirectoryOptions(stepIndex: number, contactIndex?: number): DirectoryContact[] {
    return this.directorySuggestions[this.getFlowContactKey(stepIndex, contactIndex)] || [];
  }

  onFlowNameInput(stepIndex: number, rawValue: string, contactIndex?: number): void {
    const key = this.getFlowContactKey(stepIndex, contactIndex);
    const value = String(rawValue || '').trim();
    this.clearFlowContactSelection(stepIndex, contactIndex);

    if (this.directorySearchTimers[key]) {
      clearTimeout(this.directorySearchTimers[key]);
    }

    if (value.length < 2) {
      this.directorySuggestions[key] = this.getLocalDirectoryMatches(value);
      return;
    }

    this.directorySearchTimers[key] = setTimeout(() => {
      this.directoryService.quickSearch(value).subscribe({
        next: (items) => {
          this.directorySuggestions[key] = items || [];
        },
        error: () => {
          this.directorySuggestions[key] = [];
        }
      });
    }, 250);
  }

  onFlowNameFocus(stepIndex: number, contactIndex?: number): void {
    const key = this.getFlowContactKey(stepIndex, contactIndex);
    const currentValue = contactIndex === undefined
      ? String(this.flowSteps?.[stepIndex]?.contactName || '')
      : String(this.flowSteps?.[stepIndex]?.contacts?.[contactIndex || 0]?.name || '');
    this.directorySuggestions[key] = this.getLocalDirectoryMatches(currentValue);
  }

  onFlowDirectoryContactSelected(stepIndex: number, contact: DirectoryContact, contactIndex?: number): void {
    const key = this.getFlowContactKey(stepIndex, contactIndex);
    if (contactIndex === undefined) {
      this.flowSteps[stepIndex].contactName = contact.name || '';
      this.flowSteps[stepIndex].contactTel = contact.phone || '';
      this.flowSteps[stepIndex].directoryContactId = contact._id;
    } else if (this.flowSteps[stepIndex]?.contacts?.[contactIndex]) {
      this.flowSteps[stepIndex].contacts[contactIndex].name = contact.name || '';
      this.flowSteps[stepIndex].contacts[contactIndex].tel = contact.phone || '';
      this.flowSteps[stepIndex].contacts[contactIndex].directoryContactId = contact._id;
    }

    this.directorySuggestions[key] = [];
  }

  private clearFlowContactSelection(stepIndex: number, contactIndex?: number): void {
    if (contactIndex === undefined) {
      if (this.flowSteps[stepIndex]) {
        this.flowSteps[stepIndex].directoryContactId = '';
      }
      return;
    }

    if (this.flowSteps[stepIndex]?.contacts?.[contactIndex]) {
      this.flowSteps[stepIndex].contacts[contactIndex].directoryContactId = '';
    }
  }

  private getFlowContactKey(stepIndex: number, contactIndex?: number): string {
    return contactIndex === undefined ? `step-${stepIndex}` : `step-${stepIndex}-pool-${contactIndex}`;
  }

  private cleanupDirectoryState(): void {
    const validKeys = new Set<string>();
    this.flowSteps.forEach((step, stepIndex) => {
      validKeys.add(this.getFlowContactKey(stepIndex));
      if (step.type === 'pool' && Array.isArray(step.contacts)) {
        step.contacts.forEach((_: any, contactIndex: number) => {
          validKeys.add(this.getFlowContactKey(stepIndex, contactIndex));
        });
      }
    });

    Object.keys(this.directorySuggestions).forEach((key) => {
      if (!validKeys.has(key)) {
        delete this.directorySuggestions[key];
      }
    });
  }

  private syncNewFlowContactsToDirectory(flow: EscalationFlowStep[]): Observable<void> {
    const newContacts: Array<{ name: string; phone?: string }> = [];

    flow.forEach((step: any) => {
      if (step.type === 'pool') {
        (step.contacts || []).forEach((contact: any) => {
          if (contact.name && !contact.directoryContactId) {
            newContacts.push({ name: contact.name, phone: contact.tel || '' });
          }
        });
        return;
      }

      if (step.contactName && !step.directoryContactId) {
        newContacts.push({ name: step.contactName, phone: step.contactTel || '' });
      }
    });

    if (newContacts.length === 0) {
      return of(void 0);
    }

    const deduped = new Map<string, { name: string; phone?: string }>();
    newContacts.forEach((contact) => {
      const key = `${contact.name.trim().toLowerCase()}|${String(contact.phone || '').trim().toLowerCase()}`;
      if (!deduped.has(key)) {
        deduped.set(key, contact);
      }
    });

    const requests = Array.from(deduped.values()).map((contact) =>
      this.directoryService.quickSearch(contact.name).pipe(
        map((matches) => {
          const match = (matches || []).find((item) => item.name?.trim().toLowerCase() === contact.name.trim().toLowerCase());
          return { contact, exists: Boolean(match) };
        }),
        switchMap((result) => {
          if (result.exists) {
            return of(null);
          }
          return this.directoryService.create({
            name: result.contact.name,
            phone: result.contact.phone || '',
            type: 'External'
          });
        }),
        catchError(() => of(null))
      )
    );

    return forkJoin(requests).pipe(map(() => void 0));
  }

  addClient(): void {
    this.showError('Los clientes se administran desde Catálogos > Log Sources');
  }

  saveClient(): void {
    this.showError('Los clientes se administran desde Catálogos > Log Sources');
  }

  deleteClient(): void {
    this.showError('Los clientes se administran desde Catálogos > Log Sources');
  }

  // ============ SERVICIOS ============
  loadServices(): void {
    this.loadingServices = true;
    this.escalationService.getAllServices().subscribe({
      next: (data) => {
        this.services = [...data];
        this.loadingServices = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error:', err);
        this.loadingServices = false;
      }
    });
  }

  addService(): void {
    this.showServiceForm = true;
    this.editingServiceId = null;
    this.serviceForm.reset({ clientId: '', name: '', active: true });
  }

  saveService(): void {
    if (this.serviceForm.invalid) return;

    const data = this.serviceForm.value;
    this.escalationService.createService(data).subscribe({
      next: () => {
        this.ngZone.run(() => {
          this.showSuccess('Servicio creado');
          this.showServiceForm = false;
          this.loadServices();
        });
      },
      error: (err) => {
        console.error('Error:', err);
        this.showError('Error al crear servicio');
      }
    });
  }

  deleteService(id: string): void {
    if (confirm('¿Eliminar servicio?')) {
      this.escalationService.deleteService(id).subscribe({
        next: () => {
          this.showSuccess('Servicio eliminado');
          this.loadServices();
        },
        error: (err) => this.showError('Error al eliminar')
      });
    }
  }

  // ============ CONTACTOS ============
  loadContacts(): void {
    this.loadingContacts = true;
    this.escalationService.getAllContacts('all').subscribe({
      next: (data) => {
        this.contacts = [...data];
        this.loadingContacts = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error:', err);
        this.loadingContacts = false;
      }
    });
  }

  get escalationContacts(): any[] {
    return (this.contacts || [])
      .filter((contact) => (contact.contactType || 'escalation') !== 'preventive')
      .sort((a, b) => Number((b.active !== false)) - Number((a.active !== false))
        || String(a.serviceId?.clientId?.name || '').localeCompare(String(b.serviceId?.clientId?.name || ''))
        || String(a.serviceId?.name || '').localeCompare(String(b.serviceId?.name || ''))
        || String(a.name || '').localeCompare(String(b.name || '')));
  }

  get preventiveContacts(): any[] {
    return (this.contacts || [])
      .filter((contact) => (contact.contactType || 'escalation') === 'preventive')
      .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || String(a.organization || '').localeCompare(String(b.organization || '')) || String(a.name || '').localeCompare(String(b.name || '')));
  }

  get preventiveCompanyOptions(): string[] {
    const values = new Set(
      this.preventiveContacts
        .map((contact) => String(contact.organization || '').trim())
        .filter((value) => value.length > 0)
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }

  get filteredPreventiveContacts(): any[] {
    const term = this.preventiveSearch.trim().toLowerCase();
    return this.preventiveContacts.filter((contact) => {
      const matchesTerm = !term || [contact.name, contact.email, contact.organization]
        .some((value) => String(value || '').toLowerCase().includes(term));
      const matchesCompany = !this.preventiveCompanyFilter || contact.organization === this.preventiveCompanyFilter;
      const matchesFavorite = !this.preventiveFavoritesOnly || !!contact.favorite;
      const matchesType = !this.preventiveTypeFilter
        || (this.preventiveTypeFilter === 'list' && !!contact.isMailingList)
        || (this.preventiveTypeFilter === 'personal' && !contact.isMailingList);
      return matchesTerm && matchesCompany && matchesFavorite && matchesType;
    });
  }

  filterOrgSuggestions(event: Event): void {
    const term = (event.target as HTMLInputElement).value.trim().toLowerCase();
    this.filteredOrgSuggestions = this.preventiveCompanyOptions
      .filter(org => org.toLowerCase().includes(term));
  }

  // ============ RACI ============
  loadRaciClients(): void {
    if (this.clients.length > 0) {
      this.raciClients = [...this.clients];
      if (!this.selectedRaciClientId && this.raciClients.length > 0) {
        this.selectedRaciClientId = this.raciClients[0]._id;
      }
      this.loadRaciEntries();
      return;
    }

    this.loadingRaciClients = true;
    this.catalogService.getAllLogSources().subscribe({
      next: (response) => {
        const items = response?.items || response || [];
        this.raciClients = [...items].filter((c: any) => c.enabled !== false);
        if (!this.selectedRaciClientId && this.raciClients.length > 0) {
          this.selectedRaciClientId = this.raciClients[0]._id;
        }
        this.loadingRaciClients = false;
        this.loadRaciEntries();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading RACI clients:', err);
        this.loadingRaciClients = false;
      }
    });
  }

  loadRaciEntries(): void {
    this.loadingRaci = true;
    this.escalationService.getRaciAdmin(
      this.selectedRaciClientId || undefined,
      undefined,
      this.selectedRaciTopic || undefined
    ).subscribe({
      next: (data) => {
        this.raciEntries = [...data];
        this.loadingRaci = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading RACI:', err);
        this.loadingRaci = false;
      }
    });
  }

  onRaciFilterChange(): void {
    this.loadRaciEntries();
  }

  get filteredClientsForFlow(): any[] {
    const term = this.flowClientSearch.trim().toLowerCase();
    if (!term) return this.clients;
    return this.clients.filter((client) => String(client?.name || '').toLowerCase().includes(term));
  }

  get filteredClientsForServiceForm(): any[] {
    const term = this.serviceClientSearch.trim().toLowerCase();
    if (!term) return this.clients;
    return this.clients.filter((client) => String(client?.name || '').toLowerCase().includes(term));
  }

  get filteredClientsForRaci(): CatalogLogSource[] {
    const term = this.raciClientSearch.trim().toLowerCase();
    if (!term) return this.raciClients;
    return this.raciClients.filter((client) => String(client?.name || '').toLowerCase().includes(term));
  }

  toggleQuickClientForm(nameHint?: string): void {
    this.showQuickClientForm = !this.showQuickClientForm;
    if (this.showQuickClientForm) {
      this.quickClientName = String(nameHint || '').trim();
      this.quickClientDescription = '';
    }
  }

  saveQuickClient(): void {
    const name = this.quickClientName.trim();
    if (!name) {
      this.showError('Ingresa un nombre para el cliente');
      return;
    }
    if (this.savingQuickClient) {
      return;
    }

    this.savingQuickClient = true;
    this.catalogService.createLogSource({
      name,
      description: this.quickClientDescription.trim(),
      enabled: true
    } as any).subscribe({
      next: (created: any) => {
        this.showSuccess('Cliente creado en el listado central');
        this.showQuickClientForm = false;
        this.quickClientName = '';
        this.quickClientDescription = '';
        this.loadClients();
        if (created?._id) {
          this.selectedFlowClientId = created._id;
          this.selectedRaciClientId = created._id;
        }
        this.savingQuickClient = false;
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'No se pudo crear el cliente');
        this.savingQuickClient = false;
      }
    });
  }

  getRaciClientName(entry: any): string {
    const directName = entry?.clientId?.name;
    if (directName) return directName;
    const id = entry?.clientId?._id || entry?.clientId;
    const match = this.raciClients.find((client) => client._id === id);
    return match?.name || '-';
  }

  addRaciEntry(): void {
    this.showRaciForm = true;
    this.editingRaciId = null;
    this.raciForm.reset({
      clientId: this.selectedRaciClientId || '',
      topic: this.selectedRaciTopic || '',
      activity: '',
      responsible: { name: '', email: '', phone: '' },
      accountable: { name: '', email: '', phone: '' },
      consulted: { name: '', email: '', phone: '' },
      informed: { name: '', email: '', phone: '' },
      notes: '',
      active: true
    });
    const clientId = this.raciForm.get('clientId')?.value;
    this.loadReusableRaciData(clientId || undefined);
  }

  editRaciEntry(entry: any): void {
    this.showRaciForm = true;
    this.editingRaciId = entry._id;
    this.raciForm.reset({
      clientId: entry.clientId?._id || entry.clientId,
      topic: entry.topic || entry.serviceId?.name || '',
      activity: entry.activity,
      responsible: {
        name: entry.responsible?.name || '',
        email: entry.responsible?.email || '',
        phone: entry.responsible?.phone || ''
      },
      accountable: {
        name: entry.accountable?.name || '',
        email: entry.accountable?.email || '',
        phone: entry.accountable?.phone || ''
      },
      consulted: {
        name: entry.consulted?.name || '',
        email: entry.consulted?.email || '',
        phone: entry.consulted?.phone || ''
      },
      informed: {
        name: entry.informed?.name || '',
        email: entry.informed?.email || '',
        phone: entry.informed?.phone || ''
      },
      notes: entry.notes || '',
      active: entry.active !== false
    });
    const clientId = entry.clientId?._id || entry.clientId;
    this.loadReusableRaciData(clientId || undefined, entry._id);
  }

  loadReusableRaciData(clientId?: string, excludeEntryId?: string): void {
    if (!clientId) {
      this.reusableRaciTemplates = [];
      this.reusableRaciPeople = [];
      return;
    }

    this.escalationService.getRaciAdmin(clientId).subscribe({
      next: (entries) => {
        const filteredEntries = (entries || []).filter((entry: any) => entry?._id !== excludeEntryId);
        this.reusableRaciTemplates = filteredEntries;
        this.reusableRaciPeople = this.extractReusablePeople(filteredEntries);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading reusable RACI data:', err);
        this.reusableRaciTemplates = [];
        this.reusableRaciPeople = [];
      }
    });
  }

  applyRaciTemplate(templateId: string): void {
    if (!templateId) {
      return;
    }

    const template = this.reusableRaciTemplates.find((entry: any) => entry._id === templateId);
    if (!template) {
      return;
    }

    this.raciForm.patchValue({
      topic: template.topic || template.serviceId?.name || '',
      activity: template.activity || '',
      responsible: {
        name: template.responsible?.name || '',
        email: template.responsible?.email || '',
        phone: template.responsible?.phone || ''
      },
      accountable: {
        name: template.accountable?.name || '',
        email: template.accountable?.email || '',
        phone: template.accountable?.phone || ''
      },
      consulted: {
        name: template.consulted?.name || '',
        email: template.consulted?.email || '',
        phone: template.consulted?.phone || ''
      },
      informed: {
        name: template.informed?.name || '',
        email: template.informed?.email || '',
        phone: template.informed?.phone || ''
      },
      notes: template.notes || ''
    });
  }

  applyReusablePerson(role: 'responsible' | 'accountable' | 'consulted' | 'informed', person: any): void {
    if (!person) {
      return;
    }

    this.raciForm.get(role)?.patchValue({
      name: person.name || '',
      email: person.email || '',
      phone: person.phone || ''
    });
  }

  formatReusablePerson(person: { name: string; email: string; phone: string }): string {
    if (!person) {
      return '';
    }

    const segments = [person.name || 'Sin nombre'];
    if (person.email) {
      segments.push(person.email);
    }
    if (person.phone) {
      segments.push(person.phone);
    }
    return segments.join(' · ');
  }

  formatRaciTemplateLabel(template: any): string {
    if (!template) {
      return '';
    }

    const topic = template.topic || template.serviceId?.name || 'Sin tópico';
    const activity = template.activity || 'Sin actividad';
    return `${topic} — ${activity}`;
  }

  private extractReusablePeople(entries: any[]): Array<{ name: string; email: string; phone: string }> {
    const roles: Array<'responsible' | 'accountable' | 'consulted' | 'informed'> = [
      'responsible',
      'accountable',
      'consulted',
      'informed'
    ];
    const unique = new Map<string, { name: string; email: string; phone: string }>();

    for (const entry of entries || []) {
      for (const role of roles) {
        const person = entry?.[role] || {};
        const name = String(person.name || '').trim();
        const email = String(person.email || '').trim();
        const phone = String(person.phone || '').trim();

        if (!name && !email && !phone) {
          continue;
        }

        const key = `${name.toLowerCase()}|${email.toLowerCase()}|${phone.toLowerCase()}`;
        if (!unique.has(key)) {
          unique.set(key, { name, email, phone });
        }
      }
    }

    return Array.from(unique.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  saveRaciEntry(): void {
    if (this.raciForm.invalid) {
      this.showError('Completa los campos obligatorios de RACI');
      return;
    }

    const payload = this.raciForm.value;
    payload.topic = String(payload.topic || '').trim();
    payload.serviceId = null;

    const request$ = this.editingRaciId
      ? this.escalationService.updateRaci(this.editingRaciId, payload)
      : this.escalationService.createRaci(payload);

    request$.subscribe({
      next: () => {
        this.syncRaciPeopleToDirectory(payload);
        this.showSuccess('RACI guardado correctamente');
        this.showRaciForm = false;
        this.editingRaciId = null;
        this.loadRaciEntries();
      },
      error: (err) => {
        console.error('Error saving RACI:', err);
        this.showError('Error guardando RACI');
      }
    });
  }

  onRaciPersonNameInput(role: 'responsible' | 'accountable' | 'consulted' | 'informed', rawValue: string): void {
    const query = String(rawValue || '').trim();
    if (this.raciSearchTimers[role]) {
      clearTimeout(this.raciSearchTimers[role]);
    }

    if (query.length < 2) {
      this.raciDirectorySuggestions[role] = this.getLocalDirectoryMatches(query);
      return;
    }

    this.raciSearchTimers[role] = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items) => {
          this.raciDirectorySuggestions[role] = items || [];
        },
        error: () => {
          this.raciDirectorySuggestions[role] = [];
        }
      });
    }, 250);
  }

  onRaciPersonNameFocus(role: 'responsible' | 'accountable' | 'consulted' | 'informed'): void {
    const currentValue = String(this.raciForm.get(`${role}.name`)?.value || '');
    this.raciDirectorySuggestions[role] = this.getLocalDirectoryMatches(currentValue);
  }

  getRaciDirectoryOptions(role: 'responsible' | 'accountable' | 'consulted' | 'informed'): DirectoryContact[] {
    return this.raciDirectorySuggestions[role] || [];
  }

  onRaciDirectorySelected(role: 'responsible' | 'accountable' | 'consulted' | 'informed', contact: DirectoryContact): void {
    this.raciForm.get(role)?.patchValue({
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || ''
    });
    this.raciDirectorySuggestions[role] = [];
  }

  private syncRaciPeopleToDirectory(payload: any): void {
    const roles: Array<'responsible' | 'accountable' | 'consulted' | 'informed'> = [
      'responsible',
      'accountable',
      'consulted',
      'informed'
    ];

    const people = roles
      .map((role) => payload?.[role])
      .filter((person: any) => person && (person.name || person.email || person.phone))
      .map((person: any) => ({
        name: String(person.name || '').trim(),
        email: String(person.email || '').trim(),
        phone: String(person.phone || '').trim(),
        type: 'External' as const
      }))
      .filter((person) => person.name.length > 0);

    if (people.length === 0) {
      return;
    }

    const dedup = new Map<string, (typeof people)[number]>();
    people.forEach((person) => {
      const key = `${person.name.toLowerCase()}|${person.email.toLowerCase()}|${person.phone.toLowerCase()}`;
      dedup.set(key, person);
    });

    Array.from(dedup.values()).forEach((person) => {
      this.directoryService.quickSearch(person.name).subscribe({
        next: (matches) => {
          const exists = (matches || []).some((item) => {
            const sameName = String(item.name || '').trim().toLowerCase() === person.name.toLowerCase();
            const sameEmail = person.email && String(item.email || '').trim().toLowerCase() === person.email.toLowerCase();
            const samePhone = person.phone && String(item.phone || '').trim() === person.phone;
            return sameName && (sameEmail || samePhone || (!person.email && !person.phone));
          });
          if (!exists) {
            this.directoryService.create(person).subscribe({ next: () => void 0, error: () => void 0 });
          }
        },
        error: () => void 0
      });
    });
  }

  deleteRaciEntry(id: string): void {
    if (!confirm('¿Eliminar este registro RACI?')) return;
    this.escalationService.deleteRaci(id).subscribe({
      next: () => {
        this.showSuccess('RACI eliminado');
        this.loadRaciEntries();
      },
      error: (err) => {
        console.error('Error deleting RACI:', err);
        this.showError('Error eliminando RACI');
      }
    });
  }

  addContact(contactType: 'escalation' | 'preventive' = 'escalation'): void {
    this.showContactForm = true;
    this.editingContactId = null;
    this.selectedContactDirectoryId = '';
    this.contactDirectorySuggestions = [];
    this.filteredOrgSuggestions = [...this.preventiveCompanyOptions];
    this.contactForm.reset({
      contactType,
      serviceId: '',
      name: '',
      email: '',
      phone: '',
      organization: '',
      role: contactType === 'preventive' ? 'PREVENTIVO' : 'PARA',
      favorite: false,
      isMailingList: false,
      doNotSend: false,
      notes: '',
      active: true
    });
    this.updateContactValidators();
  }

  saveContact(): void {
    this.updateContactValidators();
    if (this.contactForm.invalid) {
      this.showError('Completa los campos obligatorios del contacto');
      return;
    }

    const data = { ...this.contactForm.value };
    if (data.contactType === 'preventive') {
      data.serviceId = null;
      data.role = 'PREVENTIVO';
    }

    const request$ = this.editingContactId
      ? this.escalationService.updateContact(this.editingContactId, data)
      : this.escalationService.createContact(data);

    request$.subscribe({
      next: () => {
        this.ngZone.run(() => {
          this.syncContactFormToDirectory(data);
          const isPreventive = data.contactType === 'preventive';
          this.showSuccess(this.editingContactId
            ? (isPreventive ? 'Contacto preventivo actualizado' : 'Contacto de escalación actualizado')
            : (isPreventive ? 'Contacto preventivo creado' : 'Contacto de escalación creado'));
          this.showContactForm = false;
          this.editingContactId = null;
          this.loadContacts();
        });
      },
      error: (err) => {
        console.error('Error:', err);
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'Error al guardar contacto');
      }
    });
  }

  deleteContact(id: string): void {
    if (confirm('¿Eliminar contacto?')) {
      this.escalationService.deleteContact(id).subscribe({
        next: () => {
          this.showSuccess('Contacto eliminado');
          this.loadContacts();
        },
        error: () => this.showError('Error al eliminar')
      });
    }
  }

  editContact(contact: any): void {
    this.showContactForm = true;
    this.editingContactId = contact._id;
    this.selectedContactDirectoryId = '';
    this.contactDirectorySuggestions = [];
    this.filteredOrgSuggestions = [...this.preventiveCompanyOptions];
    const serviceId = typeof contact.serviceId === 'object' && contact.serviceId !== null
      ? contact.serviceId._id
      : (contact.serviceId || '');
    this.contactForm.patchValue({
      contactType: contact.contactType || 'escalation',
      serviceId,
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      organization: contact.organization || '',
      role: contact.role || ((contact.contactType || 'escalation') === 'preventive' ? 'PREVENTIVO' : 'PARA'),
      favorite: !!contact.favorite,
      isMailingList: !!contact.isMailingList,
      doNotSend: !!contact.doNotSend,
      notes: contact.notes || '',
      active: contact.active !== false
    });
    this.updateContactValidators();
  }

  onContactNameInput(rawValue: string): void {
    const query = String(rawValue || '').trim();
    this.selectedContactDirectoryId = '';
    if (this.contactNameSearchTimer) {
      clearTimeout(this.contactNameSearchTimer);
    }

    if (query.length < 2) {
      this.contactDirectorySuggestions = this.getLocalDirectoryMatches(query);
      return;
    }

    this.contactNameSearchTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items) => {
          this.contactDirectorySuggestions = items || [];
        },
        error: () => {
          this.contactDirectorySuggestions = [];
        }
      });
    }, 250);
  }

  onContactNameFocus(): void {
    const currentValue = String(this.contactForm.get('name')?.value || '');
    this.contactDirectorySuggestions = this.getLocalDirectoryMatches(currentValue);
  }

  addDirectoryContact(): void {
    if (!this.canDirectoryWrite) {
      this.showError('No tienes permisos para crear contactos del directorio');
      return;
    }
    this.editingDirectoryContactId = null;
    this.directoryFormModel = {
      name: '',
      email: '',
      phone: '',
      company: '',
      position: '',
      type: 'External',
      isFavorite: false
    };
    this.showDirectoryForm = true;
  }

  editDirectoryContact(contact: DirectoryContact): void {
    if (!this.canDirectoryWrite) {
      this.showError('No tienes permisos para editar el directorio');
      return;
    }
    if (this.isDirectoryInternal(contact)) {
      this.showError('Los usuarios internos se editan desde el módulo de Usuarios');
      return;
    }
    this.editingDirectoryContactId = contact._id;
    this.directoryFormModel = {
      name: String(contact.name || ''),
      email: String(contact.email || ''),
      phone: String(contact.phone || ''),
      company: String(contact.company || ''),
      position: String(contact.position || ''),
      type: (contact.type as 'Internal' | 'External' | 'List') || 'External',
      isFavorite: !!contact.isFavorite
    };
    this.showDirectoryForm = true;
  }

  cancelDirectoryForm(): void {
    this.showDirectoryForm = false;
    this.editingDirectoryContactId = null;
  }

  saveDirectoryContact(): void {
    if (!this.canDirectoryWrite) {
      this.showError('No tienes permisos para modificar el directorio');
      return;
    }
    const payload = {
      name: String(this.directoryFormModel.name || '').trim(),
      email: String(this.directoryFormModel.email || '').trim(),
      phone: String(this.directoryFormModel.phone || '').trim(),
      company: String(this.directoryFormModel.company || '').trim(),
      position: String(this.directoryFormModel.position || '').trim(),
      type: this.directoryFormModel.type,
      isFavorite: !!this.directoryFormModel.isFavorite
    };

    if (!payload.name) {
      this.showError('El nombre es obligatorio en el directorio');
      return;
    }
    if (this.savingDirectoryContact) {
      return;
    }

    this.savingDirectoryContact = true;
    const request$ = this.editingDirectoryContactId
      ? this.directoryService.update(this.editingDirectoryContactId, payload)
      : this.directoryService.create(payload);

    request$.subscribe({
      next: () => {
        this.showSuccess(this.editingDirectoryContactId ? 'Contacto del directorio actualizado' : 'Contacto agregado al directorio');
        this.showDirectoryForm = false;
        this.editingDirectoryContactId = null;
        this.savingDirectoryContact = false;
        this.loadDirectoryContacts();
        this.refreshOperationalViewsAfterDirectoryChange();
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'No se pudo guardar el contacto en el directorio');
        this.savingDirectoryContact = false;
      }
    });
  }

  deleteDirectoryContact(contactId: string): void {
    if (!this.canDirectoryDelete) {
      this.showError('No tienes permisos para eliminar en el directorio');
      return;
    }
    if (!contactId) {
      return;
    }
    const contact = this.directoryContacts.find((item) => item._id === contactId);
    if (this.isDirectoryInternal(contact)) {
      this.showError('Los usuarios internos no se eliminan desde el directorio');
      return;
    }
    if (!confirm('¿Eliminar este contacto del directorio centralizado?')) {
      return;
    }
    this.directoryService.delete(contactId).subscribe({
      next: () => {
        this.showSuccess('Contacto eliminado del directorio');
        this.loadDirectoryContacts();
        this.refreshOperationalViewsAfterDirectoryChange();
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'No se pudo eliminar el contacto del directorio');
      }
    });
  }

  private getLocalDirectoryMatches(term: string): DirectoryContact[] {
    const normalized = String(term || '').trim().toLowerCase();
    const source = this.directoryContacts || [];
    if (!normalized) {
      return source.slice(0, 8);
    }
    return source
      .filter((contact) => [contact.name, contact.email, contact.phone, contact.company]
        .some((value) => String(value || '').toLowerCase().includes(normalized)))
      .slice(0, 8);
  }

  onContactDirectorySelected(contact: DirectoryContact): void {
    this.selectedContactDirectoryId = contact._id;
    this.contactForm.patchValue({
      name: contact.name || '',
      email: contact.email || this.contactForm.get('email')?.value || '',
      phone: contact.phone || '',
      organization: contact.company || this.contactForm.get('organization')?.value || ''
    }, { emitEvent: false });
    this.contactDirectorySuggestions = [];
    this.closeDirectoryQuickPicker();
  }

  private syncContactFormToDirectory(data: any): void {
    const name = String(data?.name || '').trim();
    if (!name || this.selectedContactDirectoryId) {
      return;
    }

    this.directoryService.quickSearch(name).subscribe({
      next: (matches) => {
        const email = String(data?.email || '').trim().toLowerCase();
        const phone = String(data?.phone || '').trim();
        const exact = (matches || []).find((item) => {
          const sameName = String(item.name || '').trim().toLowerCase() === name.toLowerCase();
          const sameEmail = email && String(item.email || '').trim().toLowerCase() === email;
          const samePhone = phone && String(item.phone || '').trim() === phone;
          return sameName && (sameEmail || samePhone || (!email && !phone));
        });
        if (exact) {
          return;
        }

        this.directoryService.create({
          name,
          email: data?.email || '',
          phone: data?.phone || '',
          company: data?.organization || '',
          type: data?.contactType === 'preventive' ? 'List' : 'External'
        }).subscribe({
          next: () => this.loadDirectoryContacts(),
          error: () => void 0
        });
      },
      error: () => void 0
    });
  }

  onPreventiveCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    this.importingPreventiveCsv = true;
    this.escalationService.importContactsCsv(file, 'preventive').subscribe({
      next: (response) => {
        const observationText = response.errorCount > 0
          ? ` con ${response.errorCount} observación(es)`
          : '';
        this.showSuccess(`CSV procesado: ${response.created} nuevos, ${response.updated} actualizados${observationText}`);
        this.loadContacts();
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'Error importando CSV');
      },
      complete: () => {
        this.importingPreventiveCsv = false;
        if (input) input.value = '';
      }
    });
  }

  onAssignmentsCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file || this.importingAssignmentsCsv) {
      return;
    }

    this.importingAssignmentsCsv = true;
    this.escalationService.importAssignmentsCsv(file).subscribe({
      next: (response) => {
        const observationText = response.errorCount > 0
          ? ` con ${response.errorCount} observación(es)`
          : '';
        this.showSuccess(`Turnos procesados: ${response.created} nuevos, ${response.updated} actualizados${observationText}`);
        this.loadAssignments();
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'Error importando turnos desde CSV');
      },
      complete: () => {
        this.importingAssignmentsCsv = false;
        if (input) input.value = '';
      }
    });
  }

  downloadAssignmentTemplate(): void {
    if (this.downloadingAssignmentTemplate) {
      return;
    }

    this.downloadingAssignmentTemplate = true;
    this.escalationService.downloadAssignmentsTemplateCsv().subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'turnos-internos-template.csv');
      },
      error: () => {
        this.showError('Error descargando plantilla de turnos');
      },
      complete: () => {
        this.downloadingAssignmentTemplate = false;
      }
    });
  }

  exportPreventiveContacts(): void {
    if (this.exportingPreventiveCsv) return;
    this.exportingPreventiveCsv = true;

    this.escalationService.exportContactsCsv('preventive').subscribe({
      next: (blob) => {
        this.downloadBlob(blob, `agenda-preventiva-${new Date().toISOString().slice(0, 10)}.csv`);
        this.showSuccess('CSV exportado correctamente');
      },
      error: () => {
        this.showError('Error exportando CSV');
      },
      complete: () => {
        this.exportingPreventiveCsv = false;
      }
    });
  }

  downloadPreventiveTemplate(): void {
    const template = [
      'name,email,organization,phone,favorite,doNotSend,notes',
      'Ejemplo Cliente,cliente@example.com,Empresa Demo,+56911111111,true,false,Contacto preferente para boletines'
    ].join('\n');
    this.downloadBlob(new Blob([`\ufeff${template}`], { type: 'text/csv;charset=utf-8;' }), 'agenda-preventiva-template.csv');
  }

  // ============ PERSONAS EXTERNAS ============
  loadExternalPeople(): void {
    this.loadingExternalPeople = true;
    this.escalationService.getExternalPeople().subscribe({
      next: (data) => {
        this.externalPeople = [...data];
        this.updateAssignmentPeopleOptions();
        this.loadingExternalPeople = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading external people:', err);
        this.loadingExternalPeople = false;
      }
    });
  }

  private updateAssignmentPeopleOptions(): void {
    const roleCode = String(this.assignmentForm?.get('roleCode')?.value || '').trim();

    if (roleCode === 'N2') {
      this.filteredUsersForAssignment = this.users.filter((user) => this.matchesRoleCargo(user, 'N2'));
      this.showExternalPeopleForAssignment = false;
    } else if (roleCode === 'N1_NO_HABIL') {
      this.filteredUsersForAssignment = this.users.filter((user) => this.matchesRoleCargo(user, 'N1_NO_HABIL'));
      this.showExternalPeopleForAssignment = false;
    } else if (roleCode === 'TI') {
      this.filteredUsersForAssignment = this.users.filter((user) => this.matchesRoleCargo(user, 'TI'));
      this.showExternalPeopleForAssignment = false;
    } else {
      this.filteredUsersForAssignment = [...this.users];
      this.showExternalPeopleForAssignment = true;
    }

    const selectedAssignee = this.assignmentForm?.get('assignedUserId')?.value;
    if (!selectedAssignee) {
      return;
    }

    const selectedAsString = String(selectedAssignee);
    const selectedIsExternal = selectedAsString.startsWith('ext_');

    const isValidExternal = selectedIsExternal
      && this.showExternalPeopleForAssignment
      && this.externalPeople.some((person) => `ext_${person._id}` === selectedAsString);

    const isValidUser = !selectedIsExternal
      && this.filteredUsersForAssignment.some((user) => String(user._id) === selectedAsString);

    if (!isValidExternal && !isValidUser) {
      this.assignmentForm.patchValue({ assignedUserId: '' }, { emitEvent: false });
    }
  }

  private matchesRoleCargo(user: any, roleCode: 'N1_NO_HABIL' | 'N2' | 'TI'): boolean {
    const cargoLabel = String(user?.cargoLabel || '').trim().toUpperCase();
    if (!cargoLabel) {
      return false;
    }

    const expectedCargoByRole = {
      N1_NO_HABIL: 'N1',
      N2: 'N2',
      TI: 'TI'
    };

    return cargoLabel === expectedCargoByRole[roleCode];
  }

  addExternalPerson(): void {
    this.showExternalPersonForm = true;
    this.editingExternalPersonId = null;
    this.externalPersonForm.reset({
      name: '',
      email: '',
      phone: '',
      position: '',
      active: true
    });
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
      error: (err) => {
        console.error('Error creating external person:', err);
        this.showError('Error al agregar persona');
      }
    });
  }

  onExternalPersonNameInput(rawValue: string): void {
    const query = String(rawValue || '').trim();
    if (this.externalPersonNameSearchTimer) {
      clearTimeout(this.externalPersonNameSearchTimer);
    }

    if (query.length < 2) {
      this.externalPersonDirectorySuggestions = this.getLocalDirectoryMatches(query);
      return;
    }

    this.externalPersonNameSearchTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items) => {
          this.externalPersonDirectorySuggestions = items || [];
        },
        error: () => {
          this.externalPersonDirectorySuggestions = [];
        }
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

  openDirectoryQuickPicker(
    target: 'contact' | 'external' | 'raci:responsible' | 'raci:accountable' | 'raci:consulted' | 'raci:informed',
    queryHint = ''
  ): void {
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
    if (this.directoryQuickPickerTimer) {
      clearTimeout(this.directoryQuickPickerTimer);
    }

    if (query.length < 2) {
      this.directoryQuickPickerSuggestions = this.getLocalDirectoryMatches(query);
      return;
    }

    this.directoryQuickPickerTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items) => {
          this.directoryQuickPickerSuggestions = items || [];
        },
        error: () => {
          this.directoryQuickPickerSuggestions = [];
        }
      });
    }, 250);
  }

  useDirectoryQuickPick(contact: DirectoryContact): void {
    if (!contact || !this.directoryQuickPickerTarget) {
      return;
    }

    if (this.directoryQuickPickerTarget === 'contact') {
      this.onContactDirectorySelected(contact);
      return;
    }

    if (this.directoryQuickPickerTarget === 'external') {
      this.onExternalPersonDirectorySelected(contact);
      return;
    }

    const role = this.directoryQuickPickerTarget.replace('raci:', '') as 'responsible' | 'accountable' | 'consulted' | 'informed';
    this.onRaciDirectorySelected(role, contact);
    this.closeDirectoryQuickPicker();
  }

  deleteExternalPerson(id: string): void {
    if (confirm('¿Eliminar esta persona?')) {
      this.escalationService.deleteExternalPerson(id).subscribe({
        next: () => {
          this.showSuccess('Persona eliminada');
          this.loadExternalPeople();
        },
        error: (err) => {
          console.error('Error deleting external person:', err);
          this.showError('Error al eliminar persona');
        }
      });
    }
  }

  loadEscalationReminderConfig(): void {
    this.loadingEscalationReminderConfig = true;
    this.configService.getConfig().subscribe({
      next: (config) => {
        const selectedCargoLabels = Array.isArray(config.escalationReminderCargoLabels)
          ? config.escalationReminderCargoLabels.filter((cargo) => String(cargo || '').trim().length > 0)
          : [];

        this.escalationReminderForm.patchValue({
          escalationReminderEnabled: config.escalationReminderEnabled ?? false,
          escalationReminderCargoLabels: selectedCargoLabels.length > 0 ? selectedCargoLabels : ['N2'],
          escalationReminderDaysAhead: config.escalationReminderDaysAhead || 7
        }, { emitEvent: false });

        this.updateEscalationReminderValidators();
        this.loadingEscalationReminderConfig = false;
      },
      error: (err) => {
        console.error('Error loading escalation reminder config:', err);
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
      next: () => {
        this.showSuccess('Recordatorio de escalación interna actualizado');
      },
      error: (err) => {
        console.error('Error saving escalation reminder config:', err);
        this.showError('Error guardando recordatorio de escalación interna');
      },
      complete: () => {
        this.savingEscalationReminderConfig = false;
      }
    });
  }

  testEscalationReminder(): void {
    if (this.testingEscalationReminder) {
      return;
    }

    const selectedCargoLabelsRaw = this.escalationReminderForm?.get('escalationReminderCargoLabels')?.value;
    const selectedCargoLabels = Array.isArray(selectedCargoLabelsRaw)
      ? selectedCargoLabelsRaw.map((value: string) => String(value || '').trim()).filter((value: string) => value.length > 0)
      : [];

    if (selectedCargoLabels.length === 0) {
      this.showError('Selecciona al menos un cargo para probar el recordatorio');
      return;
    }

    this.testingEscalationReminder = true;
    this.escalationService.testEscalationReminder(selectedCargoLabels).subscribe({
      next: (response) => {
        const total = Number(response?.totalRecipients || 0);
        this.showSuccess(`${response?.message || 'Prueba ejecutada'} (${total} destinatarios)`);
      },
      error: (err) => {
        const backendMessage = err?.error?.message || err?.error?.error;
        this.showError(backendMessage || 'Error en prueba de recordatorio de escalación interna');
      },
      complete: () => {
        this.testingEscalationReminder = false;
      }
    });
  }

  private refreshAvailableCargoLabels(): void {
    const unique = new Set<string>();

    this.defaultReminderCargoLabels.forEach((cargo) => unique.add(cargo));

    this.users.forEach((user) => {
      const value = String(user?.cargoLabel || '').trim();
      if (value) {
        unique.add(value);
      }
    });

    this.availableCargoLabels = Array.from(unique).sort((a, b) => a.localeCompare(b));
    this.ensureEscalationReminderSelection();
  }

  private ensureEscalationReminderSelection(): void {
    const currentSelection = this.escalationReminderForm?.get('escalationReminderCargoLabels')?.value;
    const selected = Array.isArray(currentSelection)
      ? currentSelection.filter((cargo: string) => this.availableCargoLabels.includes(cargo))
      : [];

    const fallback = selected.length > 0
      ? selected
      : (this.availableCargoLabels.includes('N2') ? ['N2'] : this.availableCargoLabels.slice(0, 1));

    this.escalationReminderForm?.patchValue({ escalationReminderCargoLabels: fallback }, { emitEvent: false });
    this.updateEscalationReminderValidators();
  }

  private updateEscalationReminderValidators(): void {
    const enabled = !!this.escalationReminderForm?.get('escalationReminderEnabled')?.value;
    const cargoControl = this.escalationReminderForm?.get('escalationReminderCargoLabels');
    const daysAheadControl = this.escalationReminderForm?.get('escalationReminderDaysAhead');

    if (!cargoControl || !daysAheadControl) return;

    if (enabled) {
      cargoControl.setValidators([
        Validators.required,
        (control) => Array.isArray(control.value) && control.value.length > 0 ? null : { required: true }
      ]);
    } else {
      cargoControl.clearValidators();
    }

    cargoControl.updateValueAndValidity({ emitEvent: false });

    if (enabled) {
      daysAheadControl.setValidators([Validators.required, Validators.min(1), Validators.max(60)]);
    } else {
      daysAheadControl.clearValidators();
    }

    daysAheadControl.updateValueAndValidity({ emitEvent: false });
  }

  // ============ UTILIDADES ============
  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
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
}
