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
  loadTeleworkStaff(): void {
    const assignments$ = this.escalationService.getAssignments(undefined, this.currentWeekStart.toISOString(), this.currentWeekEnd.toISOString());
    const futureVacations$ = this.escalationService.getAssignments('VACATION', this.currentWeekStart.toISOString(), undefined, 100);

    forkJoin([assignments$, futureVacations$]).subscribe({
      next: ([assignments, futureVacations]) => {
        const list: any[] = [];
        const processedUserIds = new Set<string>();
        const processedExtIds = new Set<string>();

        // 1. Procesar primero las vacaciones activas de esta semana (Prioridad máxima)
        assignments.forEach(asg => {
          const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';
          const personPhone = asg.userId?.phone || asg.externalPersonId?.phone || '-';
          const personEmail = asg.userId?.email || asg.externalPersonId?.email || '-';
          const roleName = asg.userId?.cargoLabel || asg.externalPersonId?.position || this.getRoleLabelTranslated(asg.roleCode);
          const userIdStr = asg.userId?._id || asg.userId;
          const extIdStr = asg.externalPersonId?._id || asg.externalPersonId;

          if (asg.roleCode === 'VACATION') {
            list.push({
              name: personName,
              phone: personPhone,
              email: personEmail,
              role: roleName,
              status: 'vacation',
              statusLabel: 'VACACIONES'
            });
            if (userIdStr) processedUserIds.add(String(userIdStr));
            if (extIdStr) processedExtIds.add(String(extIdStr));
          }
        });

        // 2. Procesar vacaciones futuras que inician pronto (dentro de las próximas 2 semanas / 14 días)
        const referenceEnd = new Date(this.currentWeekEnd);
        const futureLimit = new Date(referenceEnd);
        futureLimit.setDate(futureLimit.getDate() + 14);

        futureVacations.forEach(asg => {
          const userIdStr = asg.userId?._id || asg.userId;
          const extIdStr = asg.externalPersonId?._id || asg.externalPersonId;

          // Evitar duplicar si la persona ya está de vacaciones activas
          if (userIdStr && processedUserIds.has(String(userIdStr))) return;
          if (extIdStr && processedExtIds.has(String(extIdStr))) return;

          const vStart = new Date(asg.weekStartDate);
          if (vStart > referenceEnd && vStart <= futureLimit) {
            const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';
            const personPhone = asg.userId?.phone || asg.externalPersonId?.phone || '-';
            const personEmail = asg.userId?.email || asg.externalPersonId?.email || '-';
            const roleName = asg.userId?.cargoLabel || asg.externalPersonId?.position || this.getRoleLabelTranslated(asg.roleCode);

            list.push({
              name: personName,
              phone: personPhone,
              email: personEmail,
              role: roleName,
              status: 'upcoming-vacation',
              statusLabel: 'Pronto Vacaciones'
            });

            if (userIdStr) processedUserIds.add(String(userIdStr));
            if (extIdStr) processedExtIds.add(String(extIdStr));
          }
        });

        // 3. Procesar asignaciones regulares (Teletrabajo y Oficina) de la semana actual
        assignments.forEach(asg => {
          const userIdStr = asg.userId?._id || asg.userId;
          const extIdStr = asg.externalPersonId?._id || asg.externalPersonId;

          // No duplicar si el usuario ya está en vacaciones o pronto vacaciones
          if (userIdStr && processedUserIds.has(String(userIdStr))) return;
          if (extIdStr && processedExtIds.has(String(extIdStr))) return;

          const personName = asg.userId?.fullName || asg.externalPersonId?.name || 'Sin asignar';
          const personPhone = asg.userId?.phone || asg.externalPersonId?.phone || '-';
          const personEmail = asg.userId?.email || asg.externalPersonId?.email || '-';
          const roleName = asg.userId?.cargoLabel || asg.externalPersonId?.position || this.getRoleLabelTranslated(asg.roleCode);

          if (asg.roleCode === 'TELEWORK') {
            list.push({
              name: personName,
              phone: personPhone,
              email: personEmail,
              role: roleName,
              status: 'telework',
              statusLabel: 'En Teletrabajo'
            });
            if (userIdStr) processedUserIds.add(String(userIdStr));
            if (extIdStr) processedExtIds.add(String(extIdStr));
          } else if (asg.roleCode !== 'VACATION') {
            // Analistas regulares en oficina
            list.push({
              name: personName,
              phone: personPhone,
              email: personEmail,
              role: roleName,
              status: 'office',
              statusLabel: 'En Oficina'
            });
            if (userIdStr) processedUserIds.add(String(userIdStr));
            if (extIdStr) processedExtIds.add(String(extIdStr));
          }
        });

        // Orden estricto: Vacaciones (0) -> Pronto Vacaciones (1) -> Teletrabajo (2) -> Oficina (3)
        const order: { [key: string]: number } = {
          'vacation': 0,
          'upcoming-vacation': 1,
          'telework': 2,
          'office': 3
        };
        this.teleworkStaff = list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading telework/vacation staff:', err);
      }
    });
  }

  /**
   * Traduce el código de rol para la presentación del listado.
   */
  getRoleLabelTranslated(roleCode: string): string {
    if (roleCode === 'N1_NO_HABIL') return 'N1 - No Hábil';
    if (roleCode === 'N2') return 'N2 - Soporte Técnico';
    if (roleCode === 'TI') return 'TI - Infraestructura';
    if (roleCode === 'TELEWORK') return 'Teletrabajo';
    if (roleCode === 'VACATION') return 'Vacaciones';
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
