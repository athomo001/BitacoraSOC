/**
 * File Purpose: frontend/src/app/pages/escalation/escalation-admin/escalation-admin.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EscalationService } from '../../../services/escalation.service';
import {
  Client,
  Service,
  Contact,
  EscalationRule,
  ShiftRotationCycle,
  ShiftAssignment,
  ShiftOverride
} from '../../../models/escalation.model';

@Component({
  selector: 'app-escalation-admin',
  templateUrl: './escalation-admin.component.html',
  styleUrls: ['./escalation-admin.component.scss']
})
export class EscalationAdminComponent implements OnInit {
  // Tab seleccionado
  selectedTab = 0;

  // Datos
  clients: Client[] = [];
  services: Service[] = [];
  contacts: Contact[] = [];
  rules: EscalationRule[] = [];
  cycles: ShiftRotationCycle[] = [];
  assignments: ShiftAssignment[] = [];
  overrides: ShiftOverride[] = [];

  // Loading states
  loadingClients = false;
  loadingServices = false;
  loadingContacts = false;
  loadingRules = false;
  loadingCycles = false;
  loadingAssignments = false;
  loadingOverrides = false;

  // Columnas de tablas
  clientColumns = ['name', 'active', 'actions'];
  serviceColumns = ['name', 'clientName', 'active', 'actions'];
  contactColumns = ['name', 'email', 'phone', 'organization', 'active', 'actions'];
  ruleColumns = ['primaryName', 'recipientsTo', 'recipientsCC', 'emergencyPhone', 'actions'];
  cycleColumns = ['roleCode', 'startDayOfWeek', 'startTimeUTC', 'durationDays', 'timezone', 'actions'];
  assignmentColumns = ['roleCode', 'userName', 'weekStartDate', 'weekEndDate', 'actions'];
  overrideColumns = ['roleCode', 'replacementUserName', 'startDate', 'endDate', 'reason', 'active', 'actions'];

  // Formularios y estados de edición
  showClientForm = false;
  clientForm!: FormGroup;
  editingClientId: string | null = null;

  showServiceForm = false;
  serviceForm!: FormGroup;
  editingServiceId: string | null = null;

  showContactForm = false;
  contactForm!: FormGroup;
  editingContactId: string | null = null;

  showOverrideForm = false;
  overrideForm!: FormGroup;
  editingOverrideId: string | null = null;
  savingOverride = false;

  // Listas auxiliares
  users: any[] = []; // Usuarios del sistema
  shiftRoles: { code: string, name: string }[] = [
    { code: 'N2', name: 'N2 - Nivel 2' },
    { code: 'TI', name: 'TI - Tecnología' },
    { code: 'N1_NO_HABIL', name: 'N1 No Hábil' }
  ];

  constructor(
    private escalationService: EscalationService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private fb: FormBuilder
  ) {}

  ngOnInit(): void {
    this.initForms();
    this.loadAllData();
  }

  initForms(): void {
    // Formulario de Clientes
    this.clientForm = this.fb.group({
      name: ['', Validators.required],
      active: [true]
    });

    // Formulario de Servicios
    this.serviceForm = this.fb.group({
      name: ['', Validators.required],
      clientId: ['', Validators.required],
      active: [true]
    });

    // Formulario de Contactos
    this.contactForm = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      organization: [''],
      active: [true]
    });

    // Formulario de Overrides
    this.overrideForm = this.fb.group({
      roleCode: ['', Validators.required],
      replacementUserId: ['', Validators.required],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      reason: ['', Validators.required],
      active: [true]
    });
  }

  loadAllData(): void {
    this.loadClients();
    this.loadServices();
    this.loadContacts();
    this.loadRules();
    this.loadCycles();
    this.loadAssignments();
    this.loadOverrides();
    this.loadUsers();
  }

  loadUsers(): void {
    // Cargar usuarios del sistema para los dropdowns
    this.escalationService.getUsers().subscribe({
      next: (data) => {
        this.users = data;
      },
      error: (err) => {
        console.error('Error loading users:', err);
      }
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CLIENTES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadClients(): void {
    this.loadingClients = true;
    this.escalationService.getAllClients().subscribe({
      next: (data) => {
        this.clients = [...data]; // Crear nuevo array para forzar detección de cambios
        this.loadingClients = false;
      },
      error: (err) => {
        console.error('Error loading clients:', err);
        this.showError('Error al cargar clientes');
        this.loadingClients = false;
      }
    });
  }

  deleteClient(id: string): void {
    if (confirm('¿Está seguro de eliminar este cliente?')) {
      this.escalationService.deleteClient(id).subscribe({
        next: () => {
          this.showSuccess('Cliente eliminado');
          this.loadClients();
        },
        error: (err) => {
          console.error('Error deleting client:', err);
          this.showError('Error al eliminar cliente');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SERVICIOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadServices(): void {
    this.loadingServices = true;
    this.escalationService.getAllServices().subscribe({
      next: (data) => {
        this.services = data;
        this.loadingServices = false;
      },
      error: (err) => {
        console.error('Error loading services:', err);
        this.showError('Error al cargar servicios');
        this.loadingServices = false;
      }
    });
  }

  deleteService(id: string): void {
    if (confirm('¿Está seguro de eliminar este servicio?')) {
      this.escalationService.deleteService(id).subscribe({
        next: () => {
          this.showSuccess('Servicio eliminado');
          this.loadServices();
        },
        error: (err) => {
          console.error('Error deleting service:', err);
          this.showError('Error al eliminar servicio');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONTACTOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadContacts(): void {
    this.loadingContacts = true;
    this.escalationService.getAllContacts().subscribe({
      next: (data) => {
        this.contacts = data;
        this.loadingContacts = false;
      },
      error: (err) => {
        console.error('Error loading contacts:', err);
        this.showError('Error al cargar contactos');
        this.loadingContacts = false;
      }
    });
  }

  deleteContact(id: string): void {
    if (confirm('¿Está seguro de eliminar este contacto?')) {
      this.escalationService.deleteContact(id).subscribe({
        next: () => {
          this.showSuccess('Contacto eliminado');
          this.loadContacts();
        },
        error: (err) => {
          console.error('Error deleting contact:', err);
          this.showError('Error al eliminar contacto');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // REGLAS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadRules(): void {
    this.loadingRules = true;
    this.escalationService.getRules().subscribe({
      next: (data) => {
        this.rules = data;
        this.loadingRules = false;
      },
      error: (err) => {
        console.error('Error loading rules:', err);
        this.showError('Error al cargar reglas');
        this.loadingRules = false;
      }
    });
  }

  deleteRule(id: string): void {
    if (confirm('¿Está seguro de eliminar esta regla?')) {
      this.escalationService.deleteRule(id).subscribe({
        next: () => {
          this.showSuccess('Regla eliminada');
          this.loadRules();
        },
        error: (err) => {
          console.error('Error deleting rule:', err);
          this.showError('Error al eliminar regla');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CICLOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadCycles(): void {
    this.loadingCycles = true;
    this.escalationService.getCycles().subscribe({
      next: (data) => {
        this.cycles = data;
        this.loadingCycles = false;
      },
      error: (err) => {
        console.error('Error loading cycles:', err);
        this.showError('Error al cargar ciclos');
        this.loadingCycles = false;
      }
    });
  }

  deleteCycle(id: string): void {
    if (confirm('¿Está seguro de eliminar este ciclo?')) {
      this.escalationService.deleteCycle(id).subscribe({
        next: () => {
          this.showSuccess('Ciclo eliminado');
          this.loadCycles();
        },
        error: (err) => {
          console.error('Error deleting cycle:', err);
          this.showError('Error al eliminar ciclo');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ASIGNACIONES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadAssignments(): void {
    this.loadingAssignments = true;
    this.escalationService.getAssignments().subscribe({
      next: (data) => {
        this.assignments = data;
        this.loadingAssignments = false;
      },
      error: (err) => {
        console.error('Error loading assignments:', err);
        this.showError('Error al cargar asignaciones');
        this.loadingAssignments = false;
      }
    });
  }

  deleteAssignment(id: string): void {
    if (confirm('¿Está seguro de eliminar esta asignación?')) {
      this.escalationService.deleteAssignment(id).subscribe({
        next: () => {
          this.showSuccess('Asignación eliminada');
          this.loadAssignments();
        },
        error: (err) => {
          console.error('Error deleting assignment:', err);
          this.showError('Error al eliminar asignación');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // OVERRIDES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadOverrides(): void {
    this.loadingOverrides = true;
    this.escalationService.getOverrides().subscribe({
      next: (data) => {
        this.overrides = data;
        this.loadingOverrides = false;
      },
      error: (err) => {
        console.error('Error loading overrides:', err);
        this.showError('Error al cargar overrides');
        this.loadingOverrides = false;
      }
    });
  }

  deleteOverride(id: string): void {
    if (confirm('¿Está seguro de eliminar este override?')) {
      this.escalationService.deleteOverride(id).subscribe({
        next: () => {
          this.showSuccess('Override eliminado');
          this.loadOverrides();
        },
        error: (err) => {
          console.error('Error deleting override:', err);
          this.showError('Error al eliminar override');
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UTILIDADES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 5000, panelClass: ['error-snackbar'] });
  }

  formatDateTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  getDayName(day: number): string {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[day] || '';
  }

  getServiceName(serviceId: any): string {
    if (typeof serviceId === 'object' && serviceId?.name) {
      return serviceId.name;
    }
    const service = this.services.find(s => s._id === serviceId);
    return service?.name || 'N/A';
  }

  getContactNames(contactIds: any[]): string {
    if (!contactIds || contactIds.length === 0) return 'Ninguno';
    
    return contactIds.map(c => {
      if (typeof c === 'object' && c?.name) return c.name;
      const contact = this.contacts.find(ct => ct._id === c);
      return contact?.name || '?';
    }).join(', ');
  }

  getRecipientEmails(contactIds: any[]): string {
    if (!contactIds || contactIds.length === 0) return '-';

    const values = contactIds
      .map(c => this.extractContactField(c, 'email'))
      .filter(email => !!email);

    return values.length ? values.join(', ') : '-';
  }

  getPrimaryRecipientName(rule: EscalationRule): string {
    if (rule?.recipientsTo?.length) {
      const name = this.extractContactField(rule.recipientsTo[0], 'name');
      if (name) return name;
    }

    return this.getServiceName(rule?.serviceId);
  }

  copyToClipboard(text: string): void {
    if (!text || text === '-') return;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.snackBar.open('Copiado', 'Cerrar', { duration: 1500 });
      }).catch(err => console.error('Error al copiar:', err));
    }
  }

  private extractContactField(contactRef: any, field: 'name' | 'email' | 'phone'): string {
    if (!contactRef) return '';

    if (typeof contactRef === 'object' && contactRef[field]) {
      return contactRef[field] as string;
    }

    const contact = this.contacts.find(ct => ct._id === contactRef);
    return contact ? (contact as any)[field] || '' : '';
  }

  // Placeholder para crear/editar (implementar con dialogs)
  addClient(): void {
    this.editingClientId = null;
    this.clientForm.reset({ name: '', active: true });
    this.showClientForm = true;
  }

  editClient(client: Client): void {
    this.editingClientId = client._id;
    this.clientForm.patchValue({
      name: client.name,
      active: client.active
    });
    this.showClientForm = true;
  }

  saveClient(): void {
    if (this.clientForm.invalid) {
      this.showError('Complete todos los campos requeridos');
      return;
    }

    const clientData = this.clientForm.value;

    if (this.editingClientId) {
      // Actualizar
      this.escalationService.updateClient(this.editingClientId, clientData).subscribe({
        next: () => {
          this.showSuccess('Cliente actualizado correctamente');
          this.cancelClientForm();
          this.loadClients();
        },
        error: (err) => {
          console.error('Error updating client:', err);
          this.showError('Error al actualizar cliente');
        }
      });
    } else {
      // Crear
      this.escalationService.createClient(clientData).subscribe({
        next: () => {
          this.showSuccess('Cliente creado correctamente');
          this.cancelClientForm();
          this.loadClients();
        },
        error: (err) => {
          console.error('Error creating client:', err);
          this.showError('Error al crear cliente');
        }
      });
    }
  }

  cancelClientForm(): void {
    this.showClientForm = false;
    this.editingClientId = null;
    this.clientForm.reset({ name: '', active: true });
  }

  addService(): void {
    this.editingServiceId = null;
    this.serviceForm.reset({ name: '', clientId: '', active: true });
    this.showServiceForm = true;
  }

  editService(service: Service): void {
    this.editingServiceId = service._id;
    this.serviceForm.patchValue({
      name: service.name,
      clientId: typeof service.clientId === 'string' ? service.clientId : service.clientId._id,
      active: service.active
    });
    this.showServiceForm = true;
  }

  saveService(): void {
    if (this.serviceForm.invalid) {
      this.showError('Complete todos los campos requeridos');
      return;
    }

    const serviceData = this.serviceForm.value;

    if (this.editingServiceId) {
      this.escalationService.updateService(this.editingServiceId, serviceData).subscribe({
        next: () => {
          this.showSuccess('Servicio actualizado correctamente');
          this.cancelServiceForm();
          this.loadServices();
        },
        error: (err) => {
          console.error('Error updating service:', err);
          this.showError('Error al actualizar servicio');
        }
      });
    } else {
      this.escalationService.createService(serviceData).subscribe({
        next: () => {
          this.showSuccess('Servicio creado correctamente');
          this.cancelServiceForm();
          this.loadServices();
        },
        error: (err) => {
          console.error('Error creating service:', err);
          this.showError('Error al crear servicio');
        }
      });
    }
  }

  cancelServiceForm(): void {
    this.showServiceForm = false;
    this.editingServiceId = null;
    this.serviceForm.reset({ name: '', clientId: '', active: true });
  }

  addContact(): void {
    this.editingContactId = null;
    this.contactForm.reset({ name: '', email: '', phone: '', organization: '', active: true });
    this.showContactForm = true;
  }

  editContact(contact: Contact): void {
    this.editingContactId = contact._id;
    this.contactForm.patchValue({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      organization: contact.organization,
      active: contact.active
    });
    this.showContactForm = true;
  }

  saveContact(): void {
    if (this.contactForm.invalid) {
      this.showError('Complete todos los campos requeridos');
      return;
    }

    const contactData = this.contactForm.value;

    if (this.editingContactId) {
      this.escalationService.updateContact(this.editingContactId, contactData).subscribe({
        next: () => {
          this.showSuccess('Contacto actualizado correctamente');
          this.cancelContactForm();
          this.loadContacts();
        },
        error: (err) => {
          console.error('Error updating contact:', err);
          this.showError('Error al actualizar contacto');
        }
      });
    } else {
      this.escalationService.createContact(contactData).subscribe({
        next: () => {
          this.showSuccess('Contacto creado correctamente');
          this.cancelContactForm();
          this.loadContacts();
        },
        error: (err) => {
          console.error('Error creating contact:', err);
          this.showError('Error al crear contacto');
        }
      });
    }
  }

  cancelContactForm(): void {
    this.showContactForm = false;
    this.editingContactId = null;
    this.contactForm.reset({ name: '', email: '', phone: '', organization: '', active: true });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // REGLAS, CICLOS, ASIGNACIONES, OVERRIDES (Placeholder)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  addRule(): void {
    this.showError('Funcionalidad de agregar/editar en desarrollo. Use la API directamente por ahora.');
  }

  editRule(rule: EscalationRule): void {
    this.showError('Funcionalidad de agregar/editar en desarrollo. Use la API directamente por ahora.');
  }

  addCycle(): void {
    this.showError('Funcionalidad de agregar/editar en desarrollo. Use la API directamente por ahora.');
  }

  editCycle(cycle: ShiftRotationCycle): void {
    this.showError('Funcionalidad de agregar/editar en desarrollo. Use la API directamente por ahora.');
  }

  addAssignment(): void {
    this.showError('Funcionalidad de agregar/editar en desarrollo. Use la API directamente por ahora.');
  }

  editAssignment(assignment: ShiftAssignment): void {
    this.showError('Funcionalidad de agregar/editar en desarrollo. Use la API directamente por ahora.');
  }

  addOverride(): void {
    this.editingOverrideId = null;
    this.overrideForm.reset({
      roleCode: '',
      replacementUserId: '',
      startDate: '',
      endDate: '',
      reason: '',
      active: true
    });
    this.showOverrideForm = true;
  }

  editOverride(override: ShiftOverride): void {
    this.editingOverrideId = override._id;
    // Convertir ISO dates a formato de input datetime-local
    const startDate = override.startDate ? new Date(override.startDate).toISOString().slice(0, 16) : '';
    const endDate = override.endDate ? new Date(override.endDate).toISOString().slice(0, 16) : '';
    
    // Extraer el ID del usuario si viene como objeto (populado)
    const userId = typeof override.replacementUserId === 'object' && override.replacementUserId !== null
      ? (override.replacementUserId as any)._id
      : override.replacementUserId;
    
    this.overrideForm.patchValue({
      roleCode: override.roleCode,
      replacementUserId: userId,
      startDate: startDate,
      endDate: endDate,
      reason: override.reason,
      active: override.active
    });
    this.showOverrideForm = true;
  }

  saveOverride(): void {
    if (this.overrideForm.invalid) {
      this.showError('Complete todos los campos requeridos');
      return;
    }

    this.savingOverride = true;
    const formData = this.overrideForm.value;
    // Convertir datetime-local a ISO 8601
    const overrideData = {
      ...formData,
      startDate: new Date(formData.startDate).toISOString(),
      endDate: new Date(formData.endDate).toISOString()
    };

    if (this.editingOverrideId) {
      this.escalationService.updateOverride(this.editingOverrideId, overrideData).subscribe({
        next: () => {
          this.showSuccess('Override actualizado correctamente');
          this.cancelOverrideForm();
          this.loadOverrides();
          this.savingOverride = false;
        },
        error: (err) => {
          console.error('Error updating override:', err);
          this.showError('Error al actualizar override');
          this.savingOverride = false;
        }
      });
    } else {
      this.escalationService.createOverride(overrideData).subscribe({
        next: () => {
          this.showSuccess('Override creado correctamente');
          this.cancelOverrideForm();
          this.loadOverrides();
          this.savingOverride = false;
        },
        error: (err) => {
          console.error('Error creating override:', err);
          this.showError('Error al crear override');
          this.savingOverride = false;
        }
      });
    }
  }

  cancelOverrideForm(): void {
    this.showOverrideForm = false;
    this.editingOverrideId = null;
    this.overrideForm.reset({
      roleCode: '',
      replacementUserId: '',
      startDate: '',
      endDate: '',
      reason: '',
      active: true
    });
  }
}
