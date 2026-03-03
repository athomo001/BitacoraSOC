import { Component, OnInit, ChangeDetectorRef, NgZone, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
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
        MatCardModule,
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
        MatCheckboxModule
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
  previousMonthAssignments: any[] = [];
  historicalAssignments: any[] = [];
  loadingAssignments = false;
  loadingHistoricalAssignments = false;
  savingAssignment = false;
  historicalLoaded = false;
  showHistorical = false;
  showAssignmentForm = false;
  assignmentForm!: FormGroup;
  users: any[] = [];
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

  // Contactos de clientes
  clients: any[] = [];
  services: any[] = [];
  contacts: any[] = [];
  loadingClients = false;
  loadingServices = false;
  loadingContacts = false;

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
  selectedRaciServiceId: string | null = null;

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

  initForms(): void {
    this.assignmentForm = this.fb.group({
      roleCode: ['', Validators.required],
      assignedUserId: ['', Validators.required],
      weekStartDate: ['', Validators.required],
      weekEndDate: ['', Validators.required],
      startTime: ['08:00', Validators.required],
      endTime: ['18:00', Validators.required]
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
      serviceId: ['', Validators.required],
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      role: ['PARA', Validators.required],
      active: [true]
    });

    this.raciForm = this.fb.group({
      clientId: ['', Validators.required],
      serviceId: [''],
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

  // ============ TURNOS INTERNOS ============
  loadUsers(): void {
    this.escalationService.getUsers().subscribe({
      next: (data) => {
        this.users = [...data];
        this.refreshAvailableCargoLabels();
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
    const toDate = this.getEndOfMonth(currentDate.getFullYear(), currentDate.getMonth()).toISOString();

    this.escalationService.getAssignments(undefined, fromDate, toDate).subscribe({
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

  addAssignment(): void {
    this.showAssignmentForm = true;
    this.assignmentForm.reset({
      roleCode: '',
      assignedUserId: '',
      weekStartDate: '',
      weekEndDate: '',
      startTime: '08:00',
      endTime: '18:00'
    });
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
        this.showError('Error al asignar turno');
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
    this.escalationService.getAllContacts().subscribe({
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
    this.escalationService.getRaciAdmin(this.selectedRaciClientId || undefined, this.selectedRaciServiceId || undefined)
      .subscribe({
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
      serviceId: this.selectedRaciServiceId || '',
      activity: '',
      responsible: { name: '', email: '', phone: '' },
      accountable: { name: '', email: '', phone: '' },
      consulted: { name: '', email: '', phone: '' },
      informed: { name: '', email: '', phone: '' },
      notes: '',
      active: true
    });
  }

  editRaciEntry(entry: any): void {
    this.showRaciForm = true;
    this.editingRaciId = entry._id;
    this.raciForm.reset({
      clientId: entry.clientId?._id || entry.clientId,
      serviceId: entry.serviceId?._id || entry.serviceId || '',
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
  }

  saveRaciEntry(): void {
    if (this.raciForm.invalid) {
      this.showError('Completa los campos obligatorios de RACI');
      return;
    }

    const payload = this.raciForm.value;
    if (!payload.serviceId) {
      payload.serviceId = null;
    }

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

  addContact(): void {
    this.showContactForm = true;
    this.editingContactId = null;
    this.contactForm.reset({ 
      serviceId: '', 
      name: '', 
      email: '', 
      phone: '', 
      role: 'PARA',
      active: true 
    });
  }

  saveContact(): void {
    if (this.contactForm.invalid) return;

    const data = this.contactForm.value;
    const request$ = this.editingContactId
      ? this.escalationService.updateContact(this.editingContactId, data)
      : this.escalationService.createContact(data);

    request$.subscribe({
      next: () => {
        this.ngZone.run(() => {
          this.showSuccess(this.editingContactId ? 'Contacto actualizado' : 'Contacto creado');
          this.showContactForm = false;
          this.editingContactId = null;
          this.loadContacts();
        });
      },
      error: (err) => {
        console.error('Error:', err);
        this.showError('Error al guardar contacto');
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
        error: (err) => this.showError('Error al eliminar')
      });
    }
  }

  editContact(contact: any): void {
    this.showContactForm = true;
    this.editingContactId = contact._id;
    const serviceId = typeof contact.serviceId === 'object' && contact.serviceId !== null
      ? contact.serviceId._id
      : (contact.serviceId || '');
    this.contactForm.patchValue({
      serviceId,
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      role: contact.role || 'PARA',
      active: contact.active !== false
    });
  }

  // ============ PERSONAS EXTERNAS ============
  loadExternalPeople(): void {
    this.loadingExternalPeople = true;
    this.escalationService.getExternalPeople().subscribe({
      next: (data) => {
        this.externalPeople = [...data];
        this.loadingExternalPeople = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading external people:', err);
        this.loadingExternalPeople = false;
      }
    });
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
