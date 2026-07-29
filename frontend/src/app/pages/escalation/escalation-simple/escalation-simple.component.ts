/**
 * File Purpose: frontend/src/app/pages/escalation/escalation-simple/escalation-simple.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, forkJoin } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogLogSource } from '../../../models/catalog.model';
import { ClientAlertRule, EscalationFlowConfig } from '../../../models/escalation.model';
import { EscalationFlowPreviewComponent } from '../shared/escalation-flow-preview.component';

// Estados posibles de una celda día/persona en la grilla de teletrabajo y apoyo
type TeleworkDayStatus = 'telework' | 'training' | 'vacation' | 'medical-leave' | 'medical-appointment' | 'office';

interface TeleworkMatrixColumn {
  date: Date;
  dayLabel: string;
  dayShort: string;
  dateShort: string;
  isToday: boolean;
}

interface TeleworkMatrixDayCell {
  status: TeleworkDayStatus;
  icon: string;
  cssClass: string;
  printLabel: string;
  tooltip: string;
}

interface TeleworkMatrixRow {
  key: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  hasSpecial: boolean;
  days: TeleworkMatrixDayCell[];
}

@Component({
    selector: 'app-escalation-simple',
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatSnackBarModule,
        MatTabsModule,
        MatChipsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatAutocompleteModule,
        MatTooltipModule,
        MatCheckboxModule,
        MatDatepickerModule,
        MatNativeDateModule,
        ReactiveFormsModule,
        EscalationFlowPreviewComponent
    ],
    templateUrl: './escalation-simple.component.html',
    styleUrls: ['./escalation-simple.component.scss']
})
export class EscalationSimpleComponent implements OnInit {
  // Índice de la pestaña activa para navegación con teclado
  activeTabIndex = 0;

  // Escucha de eventos de teclado para la navegación rápida por pestañas con flechas direccionales
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    const activeEl = document.activeElement;
    // Evitar interceptar si el usuario está enfocado en campos de texto de búsqueda o formularios
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.hasAttribute('contenteditable'))) {
      return;
    }

    if (event.key === 'ArrowRight') {
      if (this.activeTabIndex < 3) {
        this.activeTabIndex++;
        this.cdr.detectChanges();
      }
    } else if (event.key === 'ArrowLeft') {
      if (this.activeTabIndex > 0) {
        this.activeTabIndex--;
        this.cdr.detectChanges();
      }
    }
  }

  // Datos para la vista Excel
  escalationData: any[] = [];
  allClients: any[] = [];
  selectedClient: any = null;
  clientSearchTerm = '';
  unassignedContacts: any[] = [];
  selectedClientFlow: EscalationFlowConfig | null = null;
  loadingClientFlow = false;
  loading = false;
  raciClients: CatalogLogSource[] = [];
  selectedRaciClient: CatalogLogSource | null = null;
  raciClientSearchTerm = '';
  showQuickClientForm = false;
  quickClientName = '';
  quickClientDescription = '';
  savingQuickClient = false;
  loadingRaciClients = false;
  raciEntries: any[] = [];
  loadingRaci = false;
  // Flags obsoletos de foco removidos para dar paso a la lógica declarativa de filtros

  // Datos para turnos de la semana
  weekShifts: any = {
    N2: null,
    TI: null,
    N1_NO_HABIL: null
  };
  loadingShifts = false;
  currentWeekStart: Date = new Date();
  currentWeekEnd: Date = new Date();

  // ── ESC-MAINT-042 — Mantenimientos ──────────────────────────────────────
  maintenanceRules: ClientAlertRule[] = [];
  loadingMaintenances = false;
  maintenanceFormOpen = false;
  editingMaintenance: ClientAlertRule | null = null;
  savingMaintenance = false;
  maintenanceForm: FormGroup;

  constructor(
    private escalationService: EscalationService,
    private catalogService: CatalogService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private fb: FormBuilder
  ) {
    this.maintenanceForm = this.fb.group({
      clientId: [null],
      maintenanceTitle: ['', [Validators.required, Validators.maxLength(200)]],
      alertMessage: ['', [Validators.required, Validators.maxLength(500)]],
      validFromDate: [null],
      validFromTime: [''],
      validToDate: [null],
      validToTime: [''],
      blocking: [false],
      enabled: [true]
    });
  }

  ngOnInit(): void {
    this.setCurrentWeek();
    this.loadEscalationView();
    this.loadRaciClients();
    this.loadWeekShifts();
    this.loadMaintenanceRules();
  }

  private normalizeId(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (typeof value._id === 'string') return value._id;
      if (value._id != null) return String(value._id);
      if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        return String(value.toString());
      }
    }
    return String(value);
  }

  async loadEscalationView(): Promise<void> {
    this.loading = true;
    
    try {
      // Traer clientes, servicios y contactos
      const [clients, services, contacts] = await Promise.all([
        firstValueFrom(this.escalationService.getClients()),
        firstValueFrom(this.escalationService.getServices()),
        firstValueFrom(this.escalationService.getContacts())
      ]);

      // Guardar lista completa de clientes para el combobox
      this.allClients = (clients as any[]).filter((c: any) => c.active !== false);
      this.raciClients = [...this.allClients];
      
      // Agrupar servicios por cliente
      const servicesByClient = new Map<string, any[]>();
      (services as any[]).forEach((service: any) => {
        const clientId = this.normalizeId(service.clientId) || 'no-client';
        if (!servicesByClient.has(clientId)) {
          servicesByClient.set(clientId, []);
        }
        servicesByClient.get(clientId)!.push(service);
      });

      // Agrupar contactos por servicio (ordenando PARA primero, luego CC, resto al final)
      const contactsByService = new Map<string, any[]>();
      (contacts as any[]).forEach((contact: any) => {
        const serviceId = this.normalizeId(contact.serviceId) || 'no-service';
        if (!contactsByService.has(serviceId)) {
          contactsByService.set(serviceId, []);
        }
        contactsByService.get(serviceId)!.push(contact);

        const populatedService = typeof contact.serviceId === 'object' ? contact.serviceId : null;
        const populatedClientId = this.normalizeId(populatedService?.clientId);
        if (serviceId !== 'no-service' && populatedService && populatedClientId) {
          if (!servicesByClient.has(populatedClientId)) {
            servicesByClient.set(populatedClientId, []);
          }

          const clientServices = servicesByClient.get(populatedClientId)!;
          const alreadyRegistered = clientServices.some((service: any) => this.normalizeId(service._id) === serviceId);
          if (!alreadyRegistered) {
            clientServices.push({
              _id: serviceId,
              name: populatedService.name || 'Servicio',
              clientId: populatedService.clientId,
              emergencyPhone: populatedService.emergencyPhone || null
            });
          }
        }
      });
      this.unassignedContacts = contactsByService.get('no-service') || [];

      // Construir datos completos por cliente
      this.escalationData = this.allClients.map((client: any) => {
        const clientServices = servicesByClient.get(this.normalizeId(client._id)) || [];
        const servicesWithContacts = clientServices.map((service: any) => {
          const contactsForService = contactsByService.get(this.normalizeId(service._id)) || [];
          const ordered = [...contactsForService].sort((a, b) => {
            const order = { PARA: 0, CC: 1 } as any;
            return (order[a.role] ?? 2) - (order[b.role] ?? 2);
          });

          return {
            name: service.name,
            contacts: ordered,
            emergencyPhone: service.emergencyPhone || null
          };
        });

        return {
          client: client,
          services: servicesWithContacts
        };
      });

      // Seleccionar primer cliente por defecto
      if (this.allClients.length > 0 && !this.selectedClient) {
        this.selectedClient = this.allClients[0];
        this.loadSelectedClientFlow();
      }
      
      this.loading = false;
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Error loading escalation:', err);
      this.showError('Error al cargar datos de escalamiento');
      this.loading = false;
    }
  }

  async loadRaciClients(): Promise<void> {
    if (this.allClients.length > 0) {
      this.raciClients = [...this.allClients];
      if (this.raciClients.length > 0 && !this.selectedRaciClient) {
        this.selectedRaciClient = this.raciClients[0];
        this.loadRaciEntries();
      }
      return;
    }

    this.loadingRaciClients = true;
    try {
      const response = await firstValueFrom(this.catalogService.searchLogSources('', undefined, 200));
      this.raciClients = (response?.items || []).filter((c) => c.enabled !== false);
      if (this.raciClients.length > 0 && !this.selectedRaciClient) {
        this.selectedRaciClient = this.raciClients[0];
        this.loadRaciEntries();
      }
      this.loadingRaciClients = false;
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Error loading RACI clients:', err);
      this.loadingRaciClients = false;
    }
  }

  get selectedClientData(): any {
    if (!this.selectedClient) return null;
    return this.escalationData.find((d: any) => d.client._id === this.selectedClient._id);
  }

  onClientChange(): void {
    this.loadSelectedClientFlow();
  }

  onClientAutocompleteSelected(client: any): void {
    if (!client) return;
    this.selectedClient = client;
    this.clientSearchTerm = String(client?.name || '');
    this.onClientChange();
  }

  displayClientOption(value: any): string {
    if (!value) return '';
    return typeof value === 'string' ? value : String(value?.name || '');
  }

  loadSelectedClientFlow(): void {
    const clientId = this.selectedClient?._id;
    if (!clientId) {
      this.selectedClientFlow = null;
      return;
    }

    this.loadingClientFlow = true;
    this.escalationService.getEscalationFlow(clientId).subscribe({
      next: (flow) => {
        this.selectedClientFlow = flow;
        this.loadingClientFlow = false;
      },
      error: () => {
        this.selectedClientFlow = { clientId, clientName: this.selectedClient?.name || '', flow: [], legend: '' };
        this.loadingClientFlow = false;
      }
    });
  }

  onRaciClientChange(): void {
    this.loadRaciEntries();
  }

  onRaciClientAutocompleteSelected(client: CatalogLogSource): void {
    if (!client) return;
    this.selectedRaciClient = client;
    this.raciClientSearchTerm = String(client?.name || '');
    this.onRaciClientChange();
  }

  displayRaciClientOption(value: any): string {
    if (!value) return '';
    return typeof value === 'string' ? value : String(value?.name || '');
  }

  onClientSearchChange(): void {
    const term = this.clientSearchTerm.trim();
    if (!term && this.selectedClient) {
      this.selectedClient = null;
      this.selectedClientFlow = null;
    }
  }

  onRaciClientSearchChange(): void {
    const term = this.raciClientSearchTerm.trim();
    if (!term && this.selectedRaciClient) {
      this.selectedRaciClient = null;
      this.raciEntries = [];
    }
  }

  get filteredClients(): any[] {
    const term = this.clientSearchTerm.trim();
    // Si el campo está vacío o coincide exactamente con el cliente seleccionado, se despliega toda la lista
    // para evitar obligar al usuario a borrar el input o presionar la X.
    if (!term || (this.selectedClient && term === this.selectedClient.name)) {
      return this.allClients;
    }
    const lowerTerm = term.toLowerCase();
    return this.allClients.filter((client) => String(client?.name || '').toLowerCase().includes(lowerTerm));
  }

  clearClientSelection(): void {
    this.clientSearchTerm = '';
    this.selectedClient = null;
    this.selectedClientFlow = null;
    this.cdr.detectChanges();
  }

  clearRaciClientSelection(): void {
    this.raciClientSearchTerm = '';
    this.selectedRaciClient = null;
    this.raciEntries = [];
    this.cdr.detectChanges();
  }

  get filteredRaciClients(): CatalogLogSource[] {
    const term = this.raciClientSearchTerm.trim();
    // Despliega la lista completa si el campo está vacío o coincide exactamente con el cliente RACI seleccionado.
    if (!term || (this.selectedRaciClient && term === this.selectedRaciClient.name)) {
      return this.raciClients;
    }
    const lowerTerm = term.toLowerCase();
    return this.raciClients.filter((client) => String(client?.name || '').toLowerCase().includes(lowerTerm));
  }

  toggleQuickClientForm(prefill?: string): void {
    this.showQuickClientForm = !this.showQuickClientForm;
    if (this.showQuickClientForm) {
      this.quickClientName = String(prefill || '').trim();
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
        this.loadEscalationView();
        if (created?._id) {
          this.selectedClient = created;
          this.selectedRaciClient = created;
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

  loadRaciEntries(): void {
    if (!this.selectedRaciClient?._id) {
      this.raciEntries = [];
      this.loadingRaci = false;
      return;
    }

    this.loadingRaci = true;
    this.escalationService.getRaci(this.selectedRaciClient._id).subscribe({
      next: (entries) => {
        this.raciEntries = entries || [];
        this.loadingRaci = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading RACI:', err);
        this.raciEntries = [];
        this.loadingRaci = false;
      }
    });
  }

  setCurrentWeek(): void {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Lunes
    
    this.currentWeekStart = new Date(now);
    this.currentWeekStart.setDate(now.getDate() + diff);
    this.currentWeekStart.setHours(0, 0, 0, 0);
    
    this.currentWeekEnd = new Date(this.currentWeekStart);
    this.currentWeekEnd.setDate(this.currentWeekStart.getDate() + 6);
    this.currentWeekEnd.setHours(23, 59, 59, 999);
  }

  previousWeek(): void {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
    this.currentWeekEnd.setDate(this.currentWeekEnd.getDate() - 7);
    this.loadWeekShifts();
  }

  nextWeek(): void {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
    this.currentWeekEnd.setDate(this.currentWeekEnd.getDate() + 7);
    this.loadWeekShifts();
  }

  isCurrentWeek(): boolean {
    const now = new Date();
    return now >= this.currentWeekStart && now <= this.currentWeekEnd;
  }

  getWeekLabel(): string {
    const start = this.currentWeekStart.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
    const end = this.currentWeekEnd.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${start} al ${end}`;
  }

  loadWeekShifts(): void {
    this.loadingShifts = true;
    // Usar un punto medio de la semana para resolver el turno (evita quedar antes de la hora de inicio)
    const now = new Date();
    let referenceDate = new Date(this.currentWeekStart);
    if (now >= this.currentWeekStart && now <= this.currentWeekEnd) {
      referenceDate = now; // semana actual: usar ahora
    } else {
      referenceDate.setHours(12, 0, 0, 0); // semana pasada/futura: mediodía del lunes
    }

    this.escalationService.getInternalShiftsNow(referenceDate.toISOString()).subscribe({
      next: (data) => {
        const shifts = data.internalShifts || [];
        this.weekShifts = {
          N2: shifts.find((s: any) => s.role === 'N2') || null,
          TI: shifts.find((s: any) => s.role === 'TI') || null,
          N1_NO_HABIL: shifts.find((s: any) => s.role === 'N1_NO_HABIL') || null
        };
        this.loadingShifts = false;
        this.loadTeleworkStaff();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading internal shifts:', err);
        this.loadingShifts = false;
        this.loadTeleworkStaff();
      }
    });
  }

  // Metadatos visuales (ícono, clase CSS y abreviación de impresión) por cada estado de la grilla
  private readonly teleworkStatusMeta: Record<TeleworkDayStatus, { icon: string; label: string; printLabel: string }> = {
    'medical-leave': { icon: 'healing', label: 'Licencia Médica', printLabel: 'L' },
    vacation: { icon: 'event_busy', label: 'Vacaciones', printLabel: 'V' },
    'medical-appointment': { icon: 'local_hospital', label: 'Trámite Médico', printLabel: 'M' },
    training: { icon: 'school', label: 'Charla/Capacitación', printLabel: 'C' },
    telework: { icon: 'home', label: 'Teletrabajo', printLabel: 'T' },
    office: { icon: 'business', label: 'En Oficina', printLabel: '' }
  };

  /**
   * Carga las asignaciones y usuarios de la semana seleccionada y construye la grilla día por día.
   */
  loadTeleworkStaff(): void {
    const assignments$ = this.escalationService.getAssignments(undefined, this.currentWeekStart.toISOString(), this.currentWeekEnd.toISOString());
    const users$ = this.escalationService.getUsers();

    forkJoin([assignments$, users$]).subscribe({
      next: ([assignments, users]) => {
        this.buildTeleworkMatrix(assignments || [], users || []);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading telework/absence staff:', err);
      }
    });
  }

  // Última respuesta cargada (se cachea para poder recalcular la grilla en semana completa al momento de imprimir)
  private lastMatrixAssignments: any[] = [];
  private lastMatrixUsers: any[] = [];

  /**
   * Construye la grilla semanal (columnas Lunes-Viernes recortadas al día actual, filas por analista) resolviendo,
   * para cada día, la asignación de mayor prioridad activa. A diferencia del enfoque anterior (una sola asignación
   * "ganadora" por semana), esto permite ver correctamente a una misma persona con estados distintos en días distintos.
   */
  private buildTeleworkMatrix(assignments: any[], users: any[]): void {
    this.lastMatrixAssignments = assignments;
    this.lastMatrixUsers = users;

    this.teleworkMatrixColumns = this.buildWeekdayColumns(false);
    this.teleworkMatrixRows = this.computeMatrixRows(assignments, users, this.teleworkMatrixColumns);
  }

  /**
   * Construye las columnas de días hábiles (Lunes-Viernes) de la semana seleccionada.
   * Cuando fullWeek=false y se está viendo la semana en curso, recorta desde el día actual en adelante
   * (para no mostrar días ya pasados en pantalla). Para impresión se usa fullWeek=true para ver siempre la semana completa.
   */
  private buildWeekdayColumns(fullWeek: boolean): TeleworkMatrixColumn[] {
    const weekdays: Date[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(this.currentWeekStart);
      d.setDate(this.currentWeekStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      weekdays.push(d);
    }

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    let visibleWeekdays = weekdays;
    if (!fullWeek && this.isCurrentWeek()) {
      const todayIsoWeekday = now.getDay(); // 0=Domingo .. 6=Sábado
      if (todayIsoWeekday >= 1 && todayIsoWeekday <= 5) {
        visibleWeekdays = weekdays.filter(d => d.getTime() >= today.getTime());
      }
    }
    if (visibleWeekdays.length === 0) {
      visibleWeekdays = weekdays;
    }

    return visibleWeekdays.map(d => ({
      date: d,
      dayLabel: this.capitalizeFirst(d.toLocaleDateString('es-CL', { weekday: 'long' })),
      dayShort: this.capitalizeFirst(d.toLocaleDateString('es-CL', { weekday: 'short' })).replace(/\./g, ''),
      dateShort: d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
      isToday: d.getTime() === today.getTime()
    }));
  }

  /**
   * Resuelve, para cada usuario y cada columna/día dado, el estado de mayor prioridad activo ese día.
   */
  private computeMatrixRows(assignments: any[], users: any[], columns: TeleworkMatrixColumn[]): TeleworkMatrixRow[] {
    // 1. Agrupar todas las asignaciones detectadas por analista (interno o externo)
    const userGroups = new Map<string, { key: string; name: string; email: string; phone: string; role: string; assignments: any[] }>();

    if (Array.isArray(users)) {
      users.forEach(u => {
        // Exclusión de roles que no corresponden a analistas operativos del SOC
        if (u.role === 'guest' || u.role === 'auditor') return;
        const userIdStr = String(u._id);
        userGroups.set(userIdStr, {
          key: userIdStr,
          name: u.name || u.fullName || 'Sin asignar',
          phone: u.phone || '-',
          email: u.email || '-',
          role: u.cargoLabel || 'Analista',
          assignments: []
        });
      });
    }

    assignments.forEach(asg => {
      if (!asg) return;
      // Esta grilla es el roster interno del SOC (Personal en Teletrabajo y Apoyo): solo se consideran asignaciones
      // de usuarios internos del sistema. Las asignaciones a contactos externos (externalPersonId, ej. especialistas
      // de otras áreas cargados desde el Directorio de Escalación) no representan personal de la bitácora y se ignoran aquí.
      const userIdStr = asg.userId?._id ? String(asg.userId._id) : (typeof asg.userId === 'string' ? asg.userId : null);
      if (!userIdStr || !userGroups.has(userIdStr)) return;

      const group = userGroups.get(userIdStr)!;
      const alreadyHas = group.assignments.some(a => String(a._id) === String(asg._id));
      if (!alreadyHas) {
        group.assignments.push(asg);
      }
    });

    // 2. Prioridad para resolver el caso (poco frecuente) de dos asignaciones relevantes solapadas el mismo día
    const dayPriority: Record<string, number> = {
      VACATION: 1,
      MEDICAL_LEAVE: 1,
      MEDICAL_APPOINTMENT: 2,
      OL: 3,
      TELEWORK: 4
    };
    const relevantRoles = new Set(Object.keys(dayPriority));

    // 3. Construir una fila por analista, con una celda resuelta para cada columna/día solicitado
    const rows: TeleworkMatrixRow[] = [];
    userGroups.forEach(group => {
      const relevantAsgs = group.assignments.filter(a => relevantRoles.has(a.roleCode) && a.isPaused !== true);

      let hasSpecial = false;
      const days = columns.map(col => {
        const dayStart = col.date;
        const dayEnd = new Date(col.date);
        dayEnd.setHours(23, 59, 59, 999);

        const activeToday = relevantAsgs.filter(a => {
          const start = new Date(a.weekStartDate);
          const end = new Date(a.weekEndDate);
          return start <= dayEnd && end >= dayStart;
        });

        if (activeToday.length === 0) {
          return this.buildTeleworkDayCell('office', null);
        }

        activeToday.sort((a, b) => (dayPriority[a.roleCode] ?? 9) - (dayPriority[b.roleCode] ?? 9));
        hasSpecial = true;
        return this.buildTeleworkDayCell(this.mapRoleToTeleworkStatus(activeToday[0].roleCode), activeToday[0]);
      });

      rows.push({
        key: group.key,
        name: group.name,
        email: group.email,
        phone: group.phone,
        role: group.role,
        hasSpecial,
        days
      });
    });

    // 4. Ordenar: primero quienes tienen algún día especial esta semana, luego alfabético dentro de cada grupo
    rows.sort((a, b) => {
      if (a.hasSpecial !== b.hasSpecial) return a.hasSpecial ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return rows;
  }

  private mapRoleToTeleworkStatus(roleCode: string): TeleworkDayStatus {
    if (roleCode === 'MEDICAL_LEAVE') return 'medical-leave';
    if (roleCode === 'VACATION') return 'vacation';
    if (roleCode === 'MEDICAL_APPOINTMENT') return 'medical-appointment';
    if (roleCode === 'OL') return 'training';
    if (roleCode === 'TELEWORK') return 'telework';
    return 'office';
  }

  private buildTeleworkDayCell(status: TeleworkDayStatus, asg: any | null): TeleworkMatrixDayCell {
    const meta = this.teleworkStatusMeta[status];
    const tooltip = asg
      ? `${meta.label}: ${this.formatAssignmentPeriod(new Date(asg.weekStartDate), new Date(asg.weekEndDate), status)}`
      : 'En Oficina';

    return {
      status,
      icon: meta.icon,
      cssClass: status,
      printLabel: meta.printLabel,
      tooltip
    };
  }

  private capitalizeFirst(text: string): string {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000, panelClass: ['error-snackbar'] });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000, panelClass: ['success-snackbar'] });
  }

  copyToClipboard(text: string): void {
    if (!text || text === '-') return;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showSuccess('Copiado al portapapeles');
      }).catch((err) => console.error('Error al copiar:', err));
    }
  }

  // ── ESC-MAINT-042 — Mantenimientos ──────────────────────────────────────

  getMaintenanceClientLabel(rule: ClientAlertRule): string {
    if (rule.clientId && typeof rule.clientId === 'object' && rule.clientId.name) {
      return rule.clientId.name;
    }
    if (!rule.clientId) {
      return 'Todos los clientes';
    }
    return 'Cliente no encontrado';
  }

  loadMaintenanceRules(): void {
    this.loadingMaintenances = true;
    this.escalationService.getMaintenanceRules().subscribe({
      next: (rules) => {
        this.maintenanceRules = rules || [];
        this.loadingMaintenances = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando mantenimientos:', err);
        this.loadingMaintenances = false;
      }
    });
  }

  private splitDateAndTime(iso: any): { date: Date | null; time: string } {
    if (!iso) return { date: null, time: '' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: null, time: '' };
    const pad = (n: number) => String(n).padStart(2, '0');
    return { date: d, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }

  private combineDateAndTime(date: Date | null, time: string): Date | null {
    if (!date) return null;
    const parts = (time || '00:00').split(':').map((n: string) => parseInt(n, 10));
    const hours = Number.isFinite(parts[0]) ? parts[0] : 0;
    const minutes = Number.isFinite(parts[1]) ? parts[1] : 0;
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined;
  }

  openMaintenanceForm(rule: ClientAlertRule | null): void {
    this.editingMaintenance = rule;
    this.maintenanceFormOpen = true;

    if (rule) {
      const from = this.splitDateAndTime(rule.validFrom);
      const to = this.splitDateAndTime(rule.validTo);
      this.maintenanceForm.patchValue({
        clientId: this.normalizeId(rule.clientId) || null,
        maintenanceTitle: rule.maintenanceTitle || rule.name || '',
        alertMessage: rule.alertMessage || '',
        validFromDate: from.date,
        validFromTime: from.time,
        validToDate: to.date,
        validToTime: to.time,
        blocking: rule.blocking === true,
        enabled: rule.enabled !== false
      });
    } else {
      this.maintenanceForm.reset({
        clientId: null,
        blocking: false,
        enabled: true,
        maintenanceTitle: '',
        alertMessage: '',
        validFromDate: null,
        validFromTime: '',
        validToDate: null,
        validToTime: ''
      });
    }

    this.cdr.detectChanges();
  }

  cancelMaintenanceForm(): void {
    this.maintenanceFormOpen = false;
    this.editingMaintenance = null;
    this.maintenanceForm.reset({ clientId: null, blocking: false, enabled: true });
  }

  saveMaintenance(): void {
    if (this.maintenanceForm.invalid) return;

    const v = this.maintenanceForm.value;
    const validFrom = this.combineDateAndTime(v.validFromDate, v.validFromTime);
    const validTo = this.combineDateAndTime(v.validToDate, v.validToTime);

    if (validFrom && validTo && validTo.getTime() <= validFrom.getTime()) {
      this.showError('La Fecha/Hora de Finalización debe ser posterior a la de Inicio');
      return;
    }

    this.savingMaintenance = true;

    const payload: Partial<ClientAlertRule> = {
      clientId: v.clientId || null,
      maintenanceTitle: (v.maintenanceTitle || '').trim(),
      name: (v.maintenanceTitle || '').trim(),
      alertMessage: (v.alertMessage || '').trim(),
      validFrom: validFrom as any,
      validTo: validTo as any,
      blocking: Boolean(v.blocking),
      enabled: Boolean(v.enabled)
    };

    const request = this.editingMaintenance
      ? this.escalationService.updateMaintenanceRule(this.editingMaintenance._id!, payload)
      : this.escalationService.createMaintenanceRule(payload);

    request.subscribe({
      next: () => {
        this.showSuccess(this.editingMaintenance ? 'Mantenimiento actualizado' : 'Mantenimiento creado');
        this.cancelMaintenanceForm();
        this.loadMaintenanceRules();
      },
      error: (err) => {
        console.error('Error guardando mantenimiento:', err);
        this.showError(err?.error?.error || 'Error al guardar el mantenimiento');
        this.savingMaintenance = false;
      },
      complete: () => {
        this.savingMaintenance = false;
      }
    });
  }

  deleteMaintenance(rule: ClientAlertRule): void {
    if (!confirm(`¿Eliminar el mantenimiento "${rule.maintenanceTitle || rule.name}"?`)) return;
    this.escalationService.deleteMaintenanceRule(rule._id!).subscribe({
      next: () => {
        this.showSuccess('Mantenimiento eliminado');
        this.loadMaintenanceRules();
      },
      error: (err) => {
        console.error('Error eliminando mantenimiento:', err);
        this.showError('Error al eliminar el mantenimiento');
      }
    });
  }

  // Grilla semanal (Lunes-Viernes) de personal en teletrabajo, capacitación, vacaciones, licencias y trámites médicos
  teleworkMatrixColumns: TeleworkMatrixColumn[] = [];
  teleworkMatrixRows: TeleworkMatrixRow[] = [];

  // Formatea un rango de fecha/hora de asignación para mostrarlo de forma compacta y clara
  formatAssignmentPeriod(startDate: Date | undefined, endDate: Date | undefined, status: string): string {
    if (!startDate || !endDate) return '';
    
    // Para oficina no es necesario mostrar el rango ya que es el horario estándar
    if (status === 'office') return '';

    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const isSameDay = startDate.toDateString() === endDate.toDateString();
    
    const pad = (n: number) => String(n).padStart(2, '0');
    const formatTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const formatDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

    if (isSameDay) {
      const dayName = startDate.toLocaleDateString('es-CL', { weekday: 'long' });
      const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      return `${capitalizedDay} ${formatDate(startDate)} (${formatTime(startDate)} a ${formatTime(endDate)})`;
    }

    return `${formatDate(startDate)} ${formatTime(startDate)} al ${formatDate(endDate)} ${formatTime(endDate)}`;
  }

  // Selecciona todo el texto del input al enfocar para facilitar la escritura inmediata
  onInputFocus(event: any): void {
    const input = event.target;
    if (input) {
      setTimeout(() => {
        input.select();
      }, 60); // Retraso de 60ms para evitar que Angular Material descarte la selección en cascada
    }
  }

  printSection(): void {
    // La impresión siempre muestra la semana completa (Lunes a Viernes), independiente de qué días se recortaron
    // en pantalla (ej. si hoy es miércoles, en pantalla se ve desde el miércoles, pero el PDF va completo).
    const printColumns = this.buildWeekdayColumns(true);
    const printRows = this.computeMatrixRows(this.lastMatrixAssignments, this.lastMatrixUsers, printColumns);

    const printWindow = window.open('about:blank', '_blank', 'left=200,top=200,width=1100,height=900');
    if (!printWindow) {
      alert('Por favor, permite las ventanas emergentes en este sitio para poder imprimir el reporte.');
      return;
    }

    const formatDateShort = (d: Date) => {
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return `${d.getDate()} de ${months[d.getMonth()]}`;
    };
    const weekRangeText = `Semana del Lunes ${formatDateShort(this.currentWeekStart)} al Viernes ${formatDateShort(this.currentWeekEnd)} de ${this.currentWeekStart.getFullYear()}`;

    const headerHtml = `
      <div class="print-only-header">
        <div class="print-header-top">
          <span class="print-brand">CDC Netics · Control Interno</span>
          <span class="print-date">Generado el ${this.escapeHtml(this.getTodayDateFormatted())}</span>
        </div>
        <h1>Personal Fuera de la Oficina y Apoyo</h1>
        <p class="print-subtitle"><strong>Programación SOC:</strong> ${weekRangeText}</p>
        <div class="print-header-divider"></div>
      </div>
    `;

    const tableHtml = this.renderPrintMatrixTable(printColumns, printRows);
    const legendHtml = this.renderPrintLegend();

    // Estilos de impresión premium inyectados directamente en el contexto limpio de la nueva ventana.
    // Se carga la fuente de Material Icons (misma fuente que usa la app) para que los íconos de estado se
    // impriman como íconos reales y grandes, en vez de la abreviación de texto usada como respaldo anterior.
    const styles = `
      <html>
        <head>
          <title>Personal Fuera de la Oficina y Apoyo - CDC Netics</title>
          <link rel="preconnect" href="https://fonts.gstatic.com">
          <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
          <style>
            @page {
              size: letter portrait;
              margin: 0 !important; /* Elimina los encabezados y pies de página nativos del navegador */
            }
            body {
              font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 1.2cm 1cm; /* Margen real de la página como padding del body */
              background-color: #ffffff;
              color: #0f172a;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .material-icons {
              font-family: 'Material Icons';
              font-weight: normal;
              font-style: normal;
              display: inline-block;
              line-height: 1;
              text-transform: none;
              letter-spacing: normal;
              word-wrap: normal;
              white-space: nowrap;
              direction: ltr;
              -webkit-font-smoothing: antialiased;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .print-only-header {
              display: block;
              margin-bottom: 15px;
              width: 100%;
            }
            .print-header-top {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 4px;
              border-bottom: 2px solid #cbd5e1;
              padding-bottom: 4px;
            }
            .print-brand {
              font-size: 11px;
              font-weight: 800;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: #1e293b;
            }
            .print-date {
              font-size: 10px;
              color: #64748b;
              font-weight: 500;
            }
            h1 {
              font-size: 21px;
              font-weight: 800;
              color: #0f172a;
              margin: 4px 0 2px 0;
              letter-spacing: -0.02em;
              line-height: 1.1;
            }
            .print-subtitle {
              font-size: 11px;
              color: #475569;
              margin: 0;
              line-height: 1.3;
            }
            .print-header-divider {
              height: 3px;
              background: linear-gradient(90deg, #6366f1 0%, #a855f7 100%);
              margin-top: 8px;
              border-radius: 2px;
            }
            .excel-table-container {
              width: 100%;
              overflow: visible;
              margin-top: 10px;
            }
            .excel-table {
              width: 100%;
              table-layout: fixed;
              border-collapse: collapse;
              border: 1px solid #cbd5e1;
            }
            .excel-table thead {
              display: table-header-group;
            }
            .excel-table th {
              border: 1px solid #cbd5e1;
              background-color: #f8fafc;
              color: #0f172a;
              font-size: 11px;
              font-weight: 700;
              padding: 7px 6px;
              text-align: center;
            }
            .excel-table th.col-name {
              text-align: left;
              width: 26%;
            }
            .day-header-date {
              display: block;
              font-size: 9.5px;
              font-weight: 500;
              color: #64748b;
              margin-top: 2px;
            }

            .excel-table td {
              border: 1px solid #cbd5e1;
              padding: 8px 6px;
              font-size: 11.5px;
              color: #0f172a;
              vertical-align: middle;
              word-wrap: break-word;
              word-break: break-word;
              line-height: 1.35;
            }
            .cell-name {
              text-align: left;
            }
            .cell-name-text {
              font-weight: 700;
              font-size: 12.5px;
              color: #0f172a;
              white-space: normal;
              display: block;
            }
            .cell-name-role {
              display: block;
              font-size: 10px;
              color: #64748b;
              margin-top: 2px;
            }

            /* Celda de día: ícono de estado grande y coloreado; los días "En Oficina" quedan en blanco para no saturar */
            .cell-day {
              text-align: center;
            }
            .print-day-icon {
              font-size: 30px !important;
            }
            .print-day-icon.cell-day--telework { color: #059669; }
            .print-day-icon.cell-day--training { color: #b45309; }
            .print-day-icon.cell-day--vacation,
            .print-day-icon.cell-day--medical-leave { color: #dc2626; }
            .print-day-icon.cell-day--medical-appointment { color: #0e7490; }

            /* Etiqueta de texto debajo de cada ícono, para que el significado quede claro sin depender de la leyenda */
            .print-day-label {
              display: block;
              margin-top: 4px;
              font-size: 9.5px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.01em;
              line-height: 1.2;
              white-space: normal;
            }
            .print-day-label.cell-day--telework { color: #047857; }
            .print-day-label.cell-day--training { color: #b45309; }
            .print-day-label.cell-day--vacation,
            .print-day-label.cell-day--medical-leave { color: #b91c1c; }
            .print-day-label.cell-day--medical-appointment { color: #0e7490; }

            .matrix-legend {
              display: flex;
              flex-wrap: wrap;
              gap: 16px;
              margin-top: 14px;
            }
            .matrix-legend .legend-item {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              font-size: 10.5px;
              color: #334155;
            }
            .print-legend-icon {
              font-size: 16px !important;
            }
            .print-legend-icon.cell-day--telework { color: #059669; }
            .print-legend-icon.cell-day--training { color: #b45309; }
            .print-legend-icon.cell-day--vacation,
            .print-legend-icon.cell-day--medical-leave { color: #dc2626; }
            .print-legend-icon.cell-day--medical-appointment { color: #0e7490; }

            /* Estilo del disclaimer al pie de la tabla */
            .print-disclaimer {
              margin-top: 20px;
              padding: 8px 12px;
              background-color: #f8fafc;
              border-left: 3px solid #64748b;
              border-radius: 4px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .disclaimer-icon {
              font-size: 14px;
            }
            .disclaimer-text {
              font-size: 9.5px;
              color: #475569;
              font-style: italic;
              line-height: 1.35;
            }

            tr {
              page-break-inside: avoid;
              break-inside: avoid;
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            ${headerHtml}

            <div class="excel-table-container">
              ${tableHtml}
            </div>

            ${legendHtml}

            <div class="print-disclaimer">
              <span class="disclaimer-icon">⚠️</span>
              <span class="disclaimer-text">Nota de control interno: La presente programación es de carácter representativo y está sujeta a cambios y adaptaciones operativas según las necesidades críticas del servicio SOC durante la semana en curso.</span>
            </div>
          </div>
          <script>
            var alreadyPrinted = false;
            function triggerPrint() {
              if (alreadyPrinted) return;
              alreadyPrinted = true;
              window.print();
              window.close();
            }
            // Esperar a que la fuente de íconos termine de cargar para que no se impriman como texto plano;
            // se agrega un respaldo por tiempo en caso de que la promesa de fuentes no resuelva a tiempo.
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(triggerPrint).catch(triggerPrint);
            }
            setTimeout(triggerPrint, 1200);
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(styles);
    printWindow.document.close();
  }

  /**
   * Genera el HTML de la tabla de impresión (siempre semana completa) con íconos reales de Material Icons por estado.
   */
  private renderPrintMatrixTable(columns: TeleworkMatrixColumn[], rows: TeleworkMatrixRow[]): string {
    const headerCells = columns
      .map(col => `<th class="col-day">${this.escapeHtml(col.dayShort)}<span class="day-header-date">${this.escapeHtml(col.dateShort)}</span></th>`)
      .join('');

    const bodyRows = rows.length > 0
      ? rows.map(row => {
          const dayCells = row.days.map(day => {
            const content = day.status === 'office'
              ? ''
              : `<span class="material-icons print-day-icon cell-day--${day.cssClass}">${day.icon}</span><span class="print-day-label cell-day--${day.cssClass}">${this.escapeHtml(this.teleworkStatusMeta[day.status].label)}</span>`;
            return `<td class="cell-day">${content}</td>`;
          }).join('');
          const roleHtml = row.role ? `<small class="cell-name-role">${this.escapeHtml(row.role)}</small>` : '';
          return `<tr class="data-row"><td class="cell-name"><span class="cell-name-text">${this.escapeHtml(row.name)}</span>${roleHtml}</td>${dayCells}</tr>`;
        }).join('')
      : `<tr><td colspan="${1 + columns.length}" style="text-align:center; font-style:italic; color:#64748b; padding:20px;">Sin datos de personal para la semana seleccionada</td></tr>`;

    return `
      <table class="excel-table matrix-table">
        <thead><tr><th class="col-name">Nombre</th>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }

  /**
   * Genera la leyenda de íconos de impresión (se omite "En Oficina" ya que esas celdas quedan en blanco).
   */
  private renderPrintLegend(): string {
    const items: { status: TeleworkDayStatus; label: string }[] = [
      { status: 'telework', label: 'Teletrabajo' },
      { status: 'training', label: 'Charla/Capacitación' },
      { status: 'vacation', label: 'Vacaciones' },
      { status: 'medical-leave', label: 'Licencia Médica' },
      { status: 'medical-appointment', label: 'Trámite Médico' }
    ];

    const itemsHtml = items
      .map(item => {
        const meta = this.teleworkStatusMeta[item.status];
        return `<span class="legend-item"><span class="material-icons print-legend-icon cell-day--${item.status}">${meta.icon}</span>${this.escapeHtml(item.label)}</span>`;
      })
      .join('');

    return `<div class="matrix-legend">${itemsHtml}</div>`;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text ?? '').replace(/[&<>"']/g, (c) => map[c]);
  }

  getTodayDateFormatted(): string {
    const today = new Date();
    const formatted = today.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }
}
