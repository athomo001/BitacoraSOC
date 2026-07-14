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
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogLogSource } from '../../../models/catalog.model';
import { ClientAlertRule, EscalationFlowConfig } from '../../../models/escalation.model';
import { EscalationFlowPreviewComponent } from '../shared/escalation-flow-preview.component';

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
      maintenanceTitle: ['', [Validators.required, Validators.maxLength(200)]],
      alertMessage: ['', Validators.maxLength(500)],
      validFrom: [null],
      validTo: [null],
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

  /**
   * Carga dinámicamente al personal de teletrabajo, vacaciones (activas y futuras) y oficina en el periodo semanal seleccionado.
   */
  /**
   * Carga dinámicamente al personal de teletrabajo, capacitación, trámites médicos y vacaciones en el periodo semanal seleccionado.
   * Resuelve el bug de ocultamiento de asignaciones agrupando por usuario y aplicando priorización y ordenación cronológica adaptada al día de hoy.
   */
  loadTeleworkStaff(): void {
    const assignments$ = this.escalationService.getAssignments(undefined, this.currentWeekStart.toISOString(), this.currentWeekEnd.toISOString());
    const futureVacations$ = this.escalationService.getAssignments('VACATION', this.currentWeekStart.toISOString(), undefined, 100);
    const futureMedicalLeaves$ = this.escalationService.getAssignments('MEDICAL_LEAVE', this.currentWeekStart.toISOString(), undefined, 100);
    const futureMedicalAppointments$ = this.escalationService.getAssignments('MEDICAL_APPOINTMENT', this.currentWeekStart.toISOString(), undefined, 100);
    const users$ = this.escalationService.getUsers();

    forkJoin([assignments$, futureVacations$, futureMedicalLeaves$, futureMedicalAppointments$, users$]).subscribe({
      next: ([assignments, futureVacations, futureMedicalLeaves, futureMedicalAppointments, users]) => {
        const now = new Date();
        
        // Parámetros de tiempo del día de hoy en hora local
        const today = new Date();
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        const weekStart = this.currentWeekStart;
        const weekEnd = this.currentWeekEnd;

        // Ausencias futuras: próximas 2 semanas (14 días de límite)
        const referenceEnd = new Date(this.currentWeekEnd);
        const futureLimit = new Date(referenceEnd);
        futureLimit.setDate(futureLimit.getDate() + 14);

        // Agrupación de todas las asignaciones detectadas en una sola lista base
        const allAsgs = [
          ...assignments,
          ...futureVacations,
          ...futureMedicalLeaves,
          ...futureMedicalAppointments
        ];

        // Diccionario para agrupar asignaciones por analista único
        const userGroups = new Map<string, {
          key: string;
          name: string;
          email: string;
          phone: string;
          role: string;
          isExternal: boolean;
          assignments: any[];
        }>();

        // 1. Inicializar el mapa con todos los usuarios internos del sistema
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
              isExternal: false,
              assignments: []
            });
          });
        }

        // 2. Clasificar y asociar cada asignación con su usuario correspondiente
        allAsgs.forEach(asg => {
          if (!asg) return;
          const userIdStr = asg.userId?._id ? String(asg.userId._id) : (typeof asg.userId === 'string' ? asg.userId : null);
          const extIdStr = asg.externalPersonId?._id ? String(asg.externalPersonId._id) : (typeof asg.externalPersonId === 'string' ? asg.externalPersonId : null);
          
          const key = userIdStr || extIdStr;
          if (!key) return;

          if (!userGroups.has(key)) {
            // Incorporación dinámica de personas externas no listadas en la base de usuarios interna
            const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';
            const personPhone = asg.userId?.phone || asg.externalPersonId?.phone || '-';
            const personEmail = asg.userId?.email || asg.externalPersonId?.email || '-';
            const roleName = asg.userId?.cargoLabel || asg.externalPersonId?.position || this.getRoleLabelTranslated(asg.roleCode);

            userGroups.set(key, {
              key,
              name: personName,
              phone: personPhone,
              email: personEmail,
              role: roleName,
              isExternal: !!extIdStr,
              assignments: []
            });
          }

          const group = userGroups.get(key)!;
          // Evitar registrar la misma asignación si aparece en múltiples consultas de la API
          const alreadyHas = group.assignments.some(a => String(a._id) === String(asg._id));
          if (!alreadyHas) {
            group.assignments.push(asg);
          }
        });

        // 3. Determinar la validez de una asignación (filtrando registros caducados en tiempo real para la semana actual)
        const isValidAssignment = (asg: any): boolean => {
          const start = new Date(asg?.weekStartDate);
          const end = new Date(asg?.weekEndDate);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
          
          const isCurrentWeek = now >= weekStart && now <= weekEnd;
          // Si estamos visualizando la semana en curso y la asignación ya finalizó, se oculta para no generar ruido
          if (isCurrentWeek && end < now) return false;
          return true;
        };

        // 4. Asignación de nivel de prioridad para seleccionar el estado óptimo del analista
        const getAssignmentPriority = (asg: any): number => {
          const start = new Date(asg.weekStartDate);
          const end = new Date(asg.weekEndDate);
          
          const isActiveToday = start <= todayEnd && end >= todayStart;
          const isActiveInWeek = start <= weekEnd && end >= weekStart;
          const isFuture = start > referenceEnd && start <= futureLimit;
          const role = asg.roleCode;

          // Prioridades (a menor valor, mayor importancia de visualización)
          if (isActiveToday && (role === 'VACATION' || role === 'MEDICAL_LEAVE')) return 1; // Ausencia severa hoy
          if (isActiveToday && role === 'MEDICAL_APPOINTMENT') return 2; // Trámite médico hoy
          if (isActiveToday && role === 'OL') return 3; // Capacitación hoy (Prioridad mayor que teletrabajo)
          if (isActiveToday && role === 'TELEWORK') return 4; // Teletrabajo hoy
          
          if (isActiveInWeek && (role === 'VACATION' || role === 'MEDICAL_LEAVE')) return 5; // Ausencia en la semana
          if (isActiveInWeek && role === 'MEDICAL_APPOINTMENT') return 6; // Trámite médico en la semana
          if (isActiveInWeek && role === 'OL') return 7; // Capacitación en la semana (Prioridad mayor que teletrabajo)
          if (isActiveInWeek && role === 'TELEWORK') return 8; // Teletrabajo en la semana
          
          if (isFuture && (role === 'VACATION' || role === 'MEDICAL_LEAVE' || role === 'MEDICAL_APPOINTMENT')) return 9; // Ausencia futura
          
          // Guardias de soporte técnico en oficina
          if (isActiveInWeek && role !== 'VACATION' && role !== 'MEDICAL_LEAVE' && role !== 'MEDICAL_APPOINTMENT' && role !== 'TELEWORK' && role !== 'OL') {
            return 10;
          }
          return 99;
        };

        // 5. Procesar cada grupo para decidir qué estado final mostrar en la tabla
        const list: any[] = [];
        userGroups.forEach(group => {
          // Filtrar asignaciones válidas (descartando nulas o ya expiradas)
          const validAsgs = group.assignments.filter(isValidAssignment);

          if (validAsgs.length === 0) {
            // El analista no cuenta con asignaciones operativas en el periodo: estado "En Oficina" por defecto
            list.push({
              name: group.name,
              phone: group.phone,
              email: group.email,
              role: group.role,
              status: 'office',
              statusLabel: 'En Oficina',
              startDate: null,
              endDate: null,
              isToday: false,
              isTodayHighlighted: false,
              section: 'office'
            });
            return;
          }

          // Seleccionar la asignación con el menor puntaje de prioridad (mayor relevancia)
          validAsgs.sort((a, b) => getAssignmentPriority(a) - getAssignmentPriority(b));
          const bestAsg = validAsgs[0];
          const priority = getAssignmentPriority(bestAsg);

          if (priority >= 10) {
            // Si la asignación con más prioridad es una guardia estándar, se mapea a "En Oficina"
            list.push({
              name: group.name,
              phone: group.phone,
              email: group.email,
              role: group.role,
              status: 'office',
              statusLabel: 'En Oficina',
              startDate: new Date(bestAsg.weekStartDate),
              endDate: new Date(bestAsg.weekEndDate),
              isToday: false,
              isTodayHighlighted: false,
              section: 'office'
            });
          } else {
            const start = new Date(bestAsg.weekStartDate);
            const end = new Date(bestAsg.weekEndDate);
            const isActiveToday = start <= todayEnd && end >= todayStart;
            
            const role = bestAsg.roleCode;
            const isMedicalLeave = role === 'MEDICAL_LEAVE';
            const isMedicalAppointment = role === 'MEDICAL_APPOINTMENT';
            const isFuture = start > referenceEnd && start <= futureLimit;

            let status = 'office';
            let statusLabel = 'En Oficina';

            if (role === 'VACATION' || isMedicalLeave) {
              status = isFuture ? 'upcoming-vacation' : 'vacation';
              statusLabel = isFuture 
                ? (isMedicalLeave ? 'Pronto Licencia médica' : 'Pronto Vacaciones')
                : (isMedicalLeave ? 'LICENCIA MÉDICA' : 'VACACIONES');
            } else if (isMedicalAppointment) {
              status = isFuture ? 'upcoming-medical-appointment' : 'medical-appointment';
              statusLabel = isFuture ? 'Pronto Trámite Médico' : 'TRÁMITE MÉDICO';
            } else if (role === 'TELEWORK') {
              status = 'telework';
              statusLabel = 'En Teletrabajo';
            } else if (role === 'OL') {
              status = 'training';
              statusLabel = 'En Charla/Capacitación (Fuera de oficina)';
            }

            // Destaque visual tipo neon suave para situaciones del día de hoy
            // Las vacaciones y licencias médicas no llevan el destaque neon según la especificación del usuario
            const isTodayHighlighted = isActiveToday && (status === 'telework' || status === 'training' || status === 'medical-appointment');

            let section = 'week';
            if (isActiveToday && status !== 'office' && !status.startsWith('upcoming-')) {
              section = 'today';
            } else if (status.startsWith('upcoming-')) {
              section = 'future';
            } else if (status === 'office') {
              section = 'office';
            }

            list.push({
              name: group.name,
              phone: group.phone,
              email: group.email,
              role: group.role,
              status,
              statusLabel,
              isMedicalLeave,
              isMedicalAppointment,
              startDate: start,
              endDate: end,
              isToday: isActiveToday,
              isTodayHighlighted,
              section
            });
          }
        });

        // 6. Ordenamiento adaptado: Priorizar HOY -> Cronológico de la semana -> Ausencias futuras -> Alfabético oficina
        const getSortScore = (item: any): number => {
          if (item.section === 'today') return 1;
          if (item.section === 'week') return 2;
          if (item.section === 'future') return 3;
          return 4; // 'office'
        };

        this.teleworkStaff = list.sort((a, b) => {
          const scoreA = getSortScore(a);
          const scoreB = getSortScore(b);

          if (scoreA !== scoreB) {
            return scoreA - scoreB;
          }

          // Para la misma sección 'week' o 'future', ordenamos cronológicamente
          if ((a.section === 'week' || a.section === 'future') && a.startDate && b.startDate) {
            return a.startDate.getTime() - b.startDate.getTime();
          }

          // Para 'today', ordenamos por tipo (vacaciones > trámite > capacitación > teletrabajo)
          if (a.section === 'today') {
            const todayOrder: { [key: string]: number } = {
              'vacation': 1,
              'medical-appointment': 2,
              'training': 3,
              'telework': 4
            };
            const typeA = todayOrder[a.status] ?? 5;
            const typeB = todayOrder[b.status] ?? 5;
            if (typeA !== typeB) return typeA - typeB;
          }

          // Criterio de ordenación secundario alfabético
          return a.name.localeCompare(b.name);
        });

        this.todayCount = this.teleworkStaff.filter(s => s.section === 'today').length;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading telework/absence staff:', err);
      }
    });
  }

  /**
   * Genera dinámicamente la etiqueta textual de cabecera para cada sección.
   */
  getSectionLabel(section: string): string {
    if (section === 'today') {
      const todayStr = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: '2-digit' });
      const capitalized = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);
      return `Hoy (${capitalized})`;
    }
    if (section === 'week') return 'Próximas asignaciones en la semana';
    if (section === 'future') return 'Ausencias planificadas a futuro';
    if (section === 'office') return 'En Oficina / Sin asignaciones especiales';
    return '';
  }

  /**
   * Traduce el código de rol para la presentación del listado.
   */
  getRoleLabelTranslated(roleCode: string): string {
    if (roleCode === 'N1_NO_HABIL') return 'N1 - No Hábil';
    if (roleCode === 'N2') return 'N2 - Soporte Técnico';
    if (roleCode === 'TI') return 'TI - Infraestructura';
    if (roleCode === 'TELEWORK') return 'Teletrabajo';
    if (roleCode === 'OL') return 'Charla/Capacitación (OL)';
    if (roleCode === 'VACATION') return 'Vacaciones';
    if (roleCode === 'MEDICAL_LEAVE') return 'Licencia médica';
    if (roleCode === 'MEDICAL_APPOINTMENT') return 'Trámite Médico';
    return roleCode;
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

  openMaintenanceForm(rule: ClientAlertRule | null): void {
    this.editingMaintenance = rule;
    this.maintenanceFormOpen = true;

    if (rule) {
      const toLocal = (iso: any) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      this.maintenanceForm.patchValue({
        maintenanceTitle: rule.maintenanceTitle || rule.name || '',
        alertMessage: rule.alertMessage || '',
        validFrom: toLocal(rule.validFrom),
        validTo: toLocal(rule.validTo),
        blocking: rule.blocking === true,
        enabled: rule.enabled !== false
      });
    } else {
      this.maintenanceForm.reset({ blocking: false, enabled: true, maintenanceTitle: '', alertMessage: '', validFrom: '', validTo: '' });
    }

    this.cdr.detectChanges();
  }

  cancelMaintenanceForm(): void {
    this.maintenanceFormOpen = false;
    this.editingMaintenance = null;
    this.maintenanceForm.reset({ blocking: false, enabled: true });
  }

  saveMaintenance(): void {
    if (this.maintenanceForm.invalid) return;
    this.savingMaintenance = true;

    const v = this.maintenanceForm.value;
    const payload: Partial<ClientAlertRule> = {
      maintenanceTitle: (v.maintenanceTitle || '').trim(),
      name: (v.maintenanceTitle || '').trim(),
      alertMessage: (v.alertMessage || '').trim(),
      validFrom: v.validFrom ? new Date(v.validFrom) as any : null,
      validTo: v.validTo ? new Date(v.validTo) as any : null,
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
        this.showError('Error al guardar el mantenimiento');
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

  // Personal de apoyo en teletrabajo, oficina y vacaciones según distribución de turnos
  teleworkStaff: any[] = [];
  todayCount: number = 0;

  /**
   * Retorna la fecha del día de hoy en un formato abreviado (ej: mar 14/07).
   */
  getTodayDateShort(): string {
    const today = new Date();
    const dateStr = today.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit' });
    return dateStr.replace(/\./g, '');
  }

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
}
