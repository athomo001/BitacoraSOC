/**
 * File Purpose: frontend/src/app/pages/escalation/escalation-view/escalation-view.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';
import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { Client, Service, EscalationView, EscalationFlowConfig } from '../../../models/escalation.model';

@Component({
  selector: 'app-escalation-view',
  templateUrl: './escalation-view.component.html',
  styleUrls: ['./escalation-view.component.scss']
})
export class EscalationViewComponent implements OnInit {
  // Controles de formulario
  clientControl = new FormControl<Client | null>(null);
  serviceControl = new FormControl<Service | null>(null);

  // Datos
  clients: Client[] = [];
  services: Service[] = [];
  filteredClients: Observable<Client[]>;
  filteredServices: Observable<Service[]>;

  // Vista de escalamiento
  escalationData: EscalationView | null = null;
  escalationFlow: EscalationFlowConfig | null = null;
  loading = false;
  error: string | null = null;
  showQuickClientForm = false;
  quickClientName = '';
  quickClientDescription = '';
  savingQuickClient = false;

  constructor(
    private escalationService: EscalationService,
    private catalogService: CatalogService
  ) {
    // Filtro de clientes (autocomplete)
    this.filteredClients = this.clientControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const name = typeof value === 'string' ? value : value?.name;
        return name ? this._filterClients(name as string) : this.clients.slice();
      })
    );

    // Filtro de servicios (autocomplete)
    this.filteredServices = this.serviceControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const name = typeof value === 'string' ? value : value?.name;
        return name ? this._filterServices(name as string) : this.services.slice();
      })
    );
  }

  ngOnInit(): void {
    this.loadClients();
  }

  loadClients(): void {
    this.escalationService.getActiveClients().subscribe({
      next: (clients) => {
        this.clients = clients;
      },
      error: (err) => {
        console.error('Error loading clients:', err);
        this.error = 'Error al cargar clientes';
      }
    });
  }

  toggleQuickClientForm(): void {
    this.showQuickClientForm = !this.showQuickClientForm;
    if (!this.showQuickClientForm) {
      this.quickClientName = '';
      this.quickClientDescription = '';
    }
  }

  saveQuickClient(): void {
    const name = this.quickClientName.trim();
    if (!name) {
      this.error = 'Ingresa un nombre para el cliente nuevo';
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
      next: () => {
        this.showQuickClientForm = false;
        this.quickClientName = '';
        this.quickClientDescription = '';
        this.loadClients();
        this.error = null;
        this.savingQuickClient = false;
      },
      error: (err) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.error = backendMessage || 'No se pudo crear el cliente';
        this.savingQuickClient = false;
      }
    });
  }

  onClientSelected(client: Client): void {
    if (client && client._id) {
      this.serviceControl.setValue(null);
      this.escalationData = null;
      this.loadEscalationFlow(client._id);
      this.loadServices(client._id);
    }
  }

  loadEscalationFlow(clientId: string): void {
    this.escalationService.getEscalationFlow(clientId).subscribe({
      next: (flow) => {
        this.escalationFlow = flow;
      },
      error: (err) => {
        console.error('Error loading escalation flow:', err);
        this.escalationFlow = { clientId, clientName: '', flow: [], legend: '' };
      }
    });
  }

  loadServices(clientId: string): void {
    this.escalationService.getServices(clientId).subscribe({
      next: (services) => {
        this.services = services;
      },
      error: (err) => {
        console.error('Error loading services:', err);
        this.error = 'Error al cargar servicios';
      }
    });
  }

  onServiceSelected(service: Service): void {
    if (service && service._id) {
      this.loadEscalationData(service._id);
    }
  }

  loadEscalationData(serviceId: string): void {
    this.loading = true;
    this.error = null;
    
    this.escalationService.getEscalationView(serviceId, new Date().toISOString()).subscribe({
      next: (data) => {
        this.escalationData = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading escalation data:', err);
        this.error = 'Error al cargar información de escalamiento';
        this.loading = false;
      }
    });
  }

  refresh(): void {
    const client = this.clientControl.value;
    if (client && typeof client === 'object' && client._id) {
      this.loadEscalationFlow(client._id);
    }
    const service = this.serviceControl.value;
    if (service && typeof service === 'object' && service._id) {
      this.loadEscalationData(service._id);
    }
  }

  displayClientFn(client: Client): string {
    return client && client.name ? client.name : '';
  }

  displayServiceFn(service: Service): string {
    return service && service.name ? service.name : '';
  }

  private _filterClients(name: string): Client[] {
    const filterValue = name.toLowerCase();
    return this.clients.filter(client => 
      client.name.toLowerCase().includes(filterValue) ||
      client.code.toLowerCase().includes(filterValue)
    );
  }

  private _filterServices(name: string): Service[] {
    const filterValue = name.toLowerCase();
    return this.services.filter(service => 
      service.name.toLowerCase().includes(filterValue) ||
      service.code.toLowerCase().includes(filterValue)
    );
  }

  // Formateo de fechas para Chile (UTC-3)
  formatDateTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  getRoleBadgeClass(role: string): string {
    const roleMap: { [key: string]: string } = {
      'N2': 'role-n2',
      'TI': 'role-ti',
      'N1_NO_HABIL': 'role-n1'
    };
    return roleMap[role] || '';
  }
}
