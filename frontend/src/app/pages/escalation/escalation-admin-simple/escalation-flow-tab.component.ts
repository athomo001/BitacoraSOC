import { Component, Input, OnInit, ChangeDetectorRef, NgZone, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { EscalationFlowStep } from '../../../models/escalation.model';

@Component({
  selector: 'app-escalation-flow-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatAutocompleteModule,
    MatTooltipModule,
    DragDropModule
  ],
  templateUrl: './escalation-flow-tab.component.html',
  styleUrls: ['./escalation-flow-tab.component.scss']
})
export class EscalationFlowTabComponent implements OnInit {
  @Input() isAdminUser = false;
  @Input() directoryContacts: DirectoryContact[] = [];
  
  @Output() directoryChange = new EventEmitter<void>();
  @Output() clientsRefresh = new EventEmitter<void>();

  clients: any[] = [];
  flowClientSearch = '';
  selectedFlowClientId: string | null = null;
  flowSteps: any[] = [];
  flowLegend = '';
  
  loadingFlow = false;
  savingFlow = false;
  loadingClients = false;

  // Quick Client Form
  showQuickClientForm = false;
  quickClientName = '';
  quickClientDescription = '';
  savingQuickClient = false;

  // Search/Autocomplete helpers
  directorySuggestions: Record<string, DirectoryContact[]> = {};
  private directorySearchTimers: Record<string, any> = {};

  constructor(
    private escalationService: EscalationService,
    private catalogService: CatalogService,
    private directoryService: DirectoryService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.loadClients();
  }

  loadClients(): void {
    this.loadingClients = true;
    this.catalogService.getAllLogSources().subscribe({
      next: (response: any) => {
        const items = response?.items || response || [];
        this.clients = [...items].filter((client: any) => client.enabled !== false);
        this.loadingClients = false;
        this.cdr.detectChanges();
      },
      error: () => this.loadingClients = false
    });
  }

  get filteredClientsForFlow(): any[] {
    const term = this.flowClientSearch.trim().toLowerCase();
    if (!term) return this.clients;
    return this.clients.filter((client) => String(client?.name || '').toLowerCase().includes(term));
  }

  onFlowClientChange(): void {
    if (this.selectedFlowClientId) {
      this.loadEscalationFlow();
    } else {
      this.flowSteps = [];
      this.flowLegend = '';
    }
  }

  onFlowClientSearchInput(value: string): void {
    this.flowClientSearch = value;
    const match = this.clients.find(c => c.name.toLowerCase() === value.toLowerCase());
    if (match) {
      this.selectedFlowClientId = match._id;
      this.onFlowClientChange();
    } else {
      this.selectedFlowClientId = null;
      this.flowSteps = [];
      this.flowLegend = '';
    }
  }

  onFlowClientSelected(client: any): void {
    if (client) {
      this.selectedFlowClientId = client._id;
      this.flowClientSearch = client.name;
      this.onFlowClientChange();
    }
  }

  loadEscalationFlow(): void {
    if (!this.selectedFlowClientId) return;
    this.loadingFlow = true;
    this.escalationService.getEscalationFlow(this.selectedFlowClientId).subscribe({
      next: (config: any) => {
        this.flowSteps = config?.flow || [];
        this.flowLegend = config?.legend || '';
        this.loadingFlow = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.flowSteps = [];
        this.flowLegend = '';
        this.loadingFlow = false;
      }
    });
  }

  saveEscalationFlow(): void {
    if (!this.selectedFlowClientId || this.savingFlow) return;
    this.savingFlow = true;
    this.escalationService.saveEscalationFlow(this.selectedFlowClientId, {
      flow: this.flowSteps,
      legend: this.flowLegend
    }).subscribe({
      next: () => {
        this.showSuccess('Flujo de escalación guardado correctamente');
        this.savingFlow = false;
      },
      error: () => {
        this.showError('Error al guardar flujo');
        this.savingFlow = false;
      }
    });
  }

  addFlowStep(type: 'unique' | 'pool' = 'unique'): void {
    const newStep: any = {
      title: type === 'unique' ? 'Nuevo Paso' : 'Nuevo Pool',
      type: type,
      contactName: '',
      contactTel: '',
      callAt: null,
      contacts: type === 'pool' ? [] : undefined
    };
    this.flowSteps.push(newStep);
  }

  deleteFlowStep(index: number): void {
    this.flowSteps.splice(index, 1);
  }

  dropFlowStep(event: CdkDragDrop<any[]>): void {
    moveItemInArray(this.flowSteps, event.previousIndex, event.currentIndex);
  }

  addPoolContact(stepIndex: number): void {
    if (!this.flowSteps[stepIndex].contacts) {
      this.flowSteps[stepIndex].contacts = [];
    }
    this.flowSteps[stepIndex].contacts.push({ name: '', tel: '' });
  }

  removePoolContact(stepIndex: number, contactIndex: number): void {
    this.flowSteps[stepIndex].contacts.splice(contactIndex, 1);
  }

  // Quick Client Logic
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
    if (this.savingQuickClient) return;

    this.savingQuickClient = true;
    this.catalogService.createLogSource({
      name,
      description: this.quickClientDescription.trim(),
      enabled: true
    } as any).subscribe({
      next: (created: any) => {
        this.showSuccess('Cliente creado en el listado central');
        this.showQuickClientForm = false;
        this.loadClients();
        this.clientsRefresh.emit(); // Notify parent or other tabs
        if (created?._id) {
          this.selectedFlowClientId = created._id;
          this.flowClientSearch = created.name;
          this.onFlowClientChange();
        }
        this.savingQuickClient = false;
      },
      error: (err: any) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'No se pudo crear el cliente');
        this.savingQuickClient = false;
      }
    });
  }

  // Autocomplete logic for steps
  onFlowNameFocus(stepIndex: number, contactIndex?: number): void {
    const key = this.getStepKey(stepIndex, contactIndex);
    const currentValue = contactIndex !== undefined
      ? this.flowSteps[stepIndex].contacts[contactIndex].name
      : this.flowSteps[stepIndex].contactName;
    this.directorySuggestions[key] = this.getLocalDirectoryMatches(currentValue);
  }

  onFlowNameInput(stepIndex: number, value: any, contactIndex?: number): void {
    const query = typeof value === 'string' ? value.trim() : (value?.name || '');
    const key = this.getStepKey(stepIndex, contactIndex);

    if (this.directorySearchTimers[key]) clearTimeout(this.directorySearchTimers[key]);

    if (query.length < 2) {
      this.directorySuggestions[key] = this.getLocalDirectoryMatches(query);
      return;
    }

    this.directorySearchTimers[key] = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items: DirectoryContact[]) => {
          this.directorySuggestions[key] = items || [];
          this.cdr.detectChanges();
        },
        error: () => this.directorySuggestions[key] = []
      });
    }, 250);
  }

  onFlowDirectoryContactSelected(stepIndex: number, contact: DirectoryContact, contactIndex?: number): void {
    if (contactIndex !== undefined) {
      this.flowSteps[stepIndex].contacts[contactIndex].name = contact.name || '';
      this.flowSteps[stepIndex].contacts[contactIndex].tel = contact.phone || '';
    } else {
      this.flowSteps[stepIndex].contactName = contact.name || '';
      this.flowSteps[stepIndex].contactTel = contact.phone || '';
    }
    const key = this.getStepKey(stepIndex, contactIndex);
    this.directorySuggestions[key] = [];
  }

  getDirectoryOptions(stepIndex: number, contactIndex?: number): DirectoryContact[] {
    const key = this.getStepKey(stepIndex, contactIndex);
    return this.directorySuggestions[key] || [];
  }

  private getStepKey(stepIndex: number, contactIndex?: number): string {
    return contactIndex !== undefined ? `step-${stepIndex}-contact-${contactIndex}` : `step-${stepIndex}`;
  }

  private getLocalDirectoryMatches(term: string): DirectoryContact[] {
    const normalized = String(term || '').trim().toLowerCase();
    const source = this.directoryContacts || [];
    if (!normalized) return source.slice(0, 8);
    return source.filter((c) => 
      [c.name, c.email, c.phone, c.company].some(v => String(v || '').toLowerCase().includes(normalized))
    ).slice(0, 8);
  }

  displayDirectoryContact(value: DirectoryContact | string | null): string {
    return typeof value === 'string' ? value : (value?.name || '');
  }

  isStepConfigured(step: EscalationFlowStep): boolean {
    if (!step.title || !step.title.trim()) {
      return false;
    }
    if (step.type === 'unique') {
      return !!(step.contactName && step.contactName.trim() && step.contactTel && step.contactTel.trim());
    } else if (step.type === 'pool') {
      if (!step.contacts || step.contacts.length === 0) {
        return false;
      }
      return step.contacts.every(c => c.name && c.name.trim() && c.tel && c.tel.trim());
    }
    return false;
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }
}
