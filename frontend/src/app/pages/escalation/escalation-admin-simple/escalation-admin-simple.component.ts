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
import { EscalationService } from '../../../services/escalation.service';
import { UserService } from '../../../services/user.service';
import { CatalogService } from '../../../services/catalog.service';
import { ConfigService } from '../../../services/config.service';
import { CatalogLogSource } from '../../../models/catalog.model';

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
        MatAutocompleteModule
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

  // Contactos de escalación + agenda preventiva
  clients: any[] = [];
  services: any[] = [];
  contacts: any[] = [];
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

  constructor(
    private fb: FormBuilder,
    private escalationService: EscalationService,
    private userService: UserService,
    private catalogService: CatalogService,
    private configService: ConfigService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.initForms();
    this.loadAllData();
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
    this.loadEscalationReminderConfig();
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
        this.loadingClients = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error:', err);
        this.loadingClients = false;
      }
    });
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
    return (this.contacts || []).filter((contact) => (contact.contactType || 'escalation') !== 'preventive');
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
