/**
 * File Purpose: Sub-component for the RACI tab, extracted from escalation-admin-simple.
 * Responsibilities: RACI matrix CRUD, directory integration, reusable templates/people.
 */

import { Component, OnInit, ChangeDetectorRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { CatalogLogSource } from '../../../models/catalog.model';

@Component({
  selector: 'app-escalation-raci-tab',
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
    MatAutocompleteModule
  ],
  templateUrl: './escalation-raci-tab.component.html',
  styleUrl: './escalation-raci-tab.component.scss'
})
export class EscalationRaciTabComponent implements OnInit {
  @Input() directoryContacts: DirectoryContact[] = [];

  raciClients: CatalogLogSource[] = [];
  loadingRaciClients = false;
  raciEntries: any[] = [];
  loadingRaci = false;
  showRaciForm = false;
  raciForm!: FormGroup;
  editingRaciId: string | null = null;
  selectedRaciClientId: string | null = null;
  selectedRaciTopic = '';
  raciClientSearch = '';
  reusableRaciTemplates: any[] = [];
  reusableRaciPeople: Array<{ name: string; email: string; phone: string }> = [];
  raciDirectorySuggestions: Record<string, DirectoryContact[]> = {};
  private raciSearchTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

  // Directory quick picker state (self-contained for RACI)
  directoryQuickPickerVisible = false;
  directoryQuickPickerQuery = '';
  directoryQuickPickerSuggestions: DirectoryContact[] = [];
  directoryQuickPickerTarget: 'raci:responsible' | 'raci:accountable' | 'raci:consulted' | 'raci:informed' | null = null;
  private directoryQuickPickerTimer?: ReturnType<typeof setTimeout>;

  readonly displayDirectoryContact = (value: DirectoryContact | string | null): string =>
    typeof value === 'string' ? value : (value?.name || '');

  constructor(
    private fb: FormBuilder,
    private escalationService: EscalationService,
    private catalogService: CatalogService,
    private directoryService: DirectoryService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadRaciClients();
  }

  private initForm(): void {
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
  }

  get filteredClientsForRaci(): CatalogLogSource[] {
    const term = this.raciClientSearch.trim().toLowerCase();
    if (!term) return this.raciClients;
    return this.raciClients.filter((client) => String(client?.name || '').toLowerCase().includes(term));
  }

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
    if (!templateId) return;
    const template = this.reusableRaciTemplates.find((entry: any) => entry._id === templateId);
    if (!template) return;

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
    if (!person) return;
    this.raciForm.get(role)?.patchValue({
      name: person.name || '',
      email: person.email || '',
      phone: person.phone || ''
    });
  }

  formatReusablePerson(person: { name: string; email: string; phone: string }): string {
    if (!person) return '';
    const segments = [person.name || 'Sin nombre'];
    if (person.email) segments.push(person.email);
    if (person.phone) segments.push(person.phone);
    return segments.join(' · ');
  }

  formatRaciTemplateLabel(template: any): string {
    if (!template) return '';
    const topic = template.topic || template.serviceId?.name || 'Sin tópico';
    const activity = template.activity || 'Sin actividad';
    return `${topic} — ${activity}`;
  }

  private extractReusablePeople(entries: any[]): Array<{ name: string; email: string; phone: string }> {
    const roles: Array<'responsible' | 'accountable' | 'consulted' | 'informed'> = [
      'responsible', 'accountable', 'consulted', 'informed'
    ];
    const unique = new Map<string, { name: string; email: string; phone: string }>();

    for (const entry of entries || []) {
      for (const role of roles) {
        const person = entry?.[role] || {};
        const name = String(person.name || '').trim();
        const email = String(person.email || '').trim();
        const phone = String(person.phone || '').trim();

        if (!name && !email && !phone) continue;

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

  // ============ DIRECTORY INTEGRATION ============
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
          this.raciDirectorySuggestions[role] = (items || []).filter((item) => this.belongsToSelectedClient(item));
        },
        error: () => { this.raciDirectorySuggestions[role] = []; }
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

  private getActiveRaciClientName(): string {
    const selectedClientId = String(this.raciForm?.get('clientId')?.value || this.selectedRaciClientId || '').trim();
    if (!selectedClientId) return '';
    const client = this.raciClients.find((item) => String(item?._id || '') === selectedClientId);
    return String(client?.name || '').trim();
  }

  private belongsToSelectedClient(contact: DirectoryContact): boolean {
    if (contact?.source === 'User' || contact?.type === 'Internal') {
      return false;
    }

    const clientName = this.getActiveRaciClientName();
    if (!clientName) return true;

    const normalizedClient = clientName.toLowerCase();
    const normalizedCompany = String(contact?.company || '').trim().toLowerCase();
    if (!normalizedCompany) return false;

    return normalizedCompany.includes(normalizedClient) || normalizedClient.includes(normalizedCompany);
  }

  onRaciDirectorySelected(role: 'responsible' | 'accountable' | 'consulted' | 'informed', contact: DirectoryContact): void {
    this.raciForm.get(role)?.patchValue({
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || ''
    });
    this.raciDirectorySuggestions[role] = [];
  }

  // Directory quick picker
  openDirectoryQuickPicker(
    target: 'raci:responsible' | 'raci:accountable' | 'raci:consulted' | 'raci:informed',
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
          this.directoryQuickPickerSuggestions = (items || []).filter((item) => this.belongsToSelectedClient(item));
        },
        error: () => { this.directoryQuickPickerSuggestions = []; }
      });
    }, 250);
  }

  useDirectoryQuickPick(contact: DirectoryContact): void {
    if (!contact || !this.directoryQuickPickerTarget) return;
    const role = this.directoryQuickPickerTarget.replace('raci:', '') as 'responsible' | 'accountable' | 'consulted' | 'informed';
    this.onRaciDirectorySelected(role, contact);
    this.closeDirectoryQuickPicker();
  }

  private getLocalDirectoryMatches(term: string): DirectoryContact[] {
    const normalized = String(term || '').trim().toLowerCase();
    const source = (this.directoryContacts || []).filter((contact) => this.belongsToSelectedClient(contact));
    if (!normalized) return source.slice(0, 8);
    return source
      .filter((contact) => [contact.name, contact.email, contact.phone, contact.company]
        .some((value) => String(value || '').toLowerCase().includes(normalized)))
      .slice(0, 8);
  }

  private syncRaciPeopleToDirectory(payload: any): void {
    const roles: Array<'responsible' | 'accountable' | 'consulted' | 'informed'> = [
      'responsible', 'accountable', 'consulted', 'informed'
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

    if (people.length === 0) return;

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

  // ============ UTILITIES ============
  private showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }
}
