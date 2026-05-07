import { Component, Input, OnInit, ChangeDetectorRef, NgZone, Output, EventEmitter } from '@angular/core';
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-escalation-contacts-tab',
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
    MatTableModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatAutocompleteModule,
    MatTooltipModule
  ],
  templateUrl: './escalation-contacts-tab.component.html',
  styleUrls: ['./escalation-contacts-tab.component.scss']
})
export class EscalationContactsTabComponent implements OnInit {
  @Input() isAdminUser = false;
  @Input() directoryContacts: DirectoryContact[] = [];
  
  @Output() directoryChange = new EventEmitter<void>();

  clients: any[] = [];
  services: any[] = [];
  contacts: any[] = [];
  
  loadingClients = false;
  loadingServices = false;
  loadingContacts = false;
  
  // Servicios Form
  showServiceForm = false;
  serviceForm!: FormGroup;
  editingServiceId: string | null = null;
  serviceClientSearch = '';

  // Contactos Form
  showContactForm = false;
  contactForm!: FormGroup;
  editingContactId: string | null = null;
  contactDirectorySuggestions: DirectoryContact[] = [];
  private contactNameSearchTimer?: any;
  private selectedContactDirectoryId = '';
  filteredOrgSuggestions: string[] = [];

  // Agenda Preventiva Filters
  preventiveSearch = '';
  preventiveCompanyFilter = '';
  preventiveFavoritesOnly = false;
  preventiveTypeFilter: '' | 'personal' | 'list' = '';
  
  importingPreventiveCsv = false;
  exportingPreventiveCsv = false;

  // Directory Quick Picker
  directoryQuickPickerVisible = false;
  directoryQuickPickerQuery = '';
  directoryQuickPickerSuggestions: DirectoryContact[] = [];
  directoryQuickPickerTarget: 'contact' | null = null;
  private directoryQuickPickerTimer?: any;

  constructor(
    private fb: FormBuilder,
    private escalationService: EscalationService,
    private catalogService: CatalogService,
    private directoryService: DirectoryService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.initForms();
    this.loadAllData();
  }

  private initForms(): void {
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
  }

  loadAllData(): void {
    this.loadClients();
    this.loadServices();
    this.loadContacts();
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

  loadServices(): void {
    this.loadingServices = true;
    this.escalationService.getAllServices().subscribe({
      next: (data: any[]) => {
        this.services = [...data];
        this.loadingServices = false;
        this.cdr.detectChanges();
      },
      error: () => this.loadingServices = false
    });
  }

  loadContacts(): void {
    this.loadingContacts = true;
    this.escalationService.getAllContacts('all').subscribe({
      next: (data: any[]) => {
        this.contacts = [...data];
        this.loadingContacts = false;
        this.cdr.detectChanges();
      },
      error: () => this.loadingContacts = false
    });
  }

  // Getters for filtered views
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

  get filteredClientsForServiceForm(): any[] {
    const term = this.serviceClientSearch.trim().toLowerCase();
    if (!term) return this.clients;
    return this.clients.filter((client) => String(client?.name || '').toLowerCase().includes(term));
  }

  // Services CRUD
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
      error: () => this.showError('Error al crear servicio')
    });
  }

  deleteService(id: string): void {
    if (confirm('¿Eliminar servicio?')) {
      this.escalationService.deleteService(id).subscribe({
        next: () => {
          this.showSuccess('Servicio eliminado');
          this.loadServices();
        },
        error: () => this.showError('Error al eliminar')
      });
    }
  }

  // Contacts CRUD
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
      error: (err: any) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'Error al guardar contacto');
      }
    });
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

  // CSV Methods
  onPreventiveCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    this.importingPreventiveCsv = true;
    this.escalationService.importContactsCsv(file, 'preventive').subscribe({
      next: (response: any) => {
        const observationText = response.errorCount > 0
          ? ` con ${response.errorCount} observación(es)`
          : '';
        this.showSuccess(`CSV procesado: ${response.created} nuevos, ${response.updated} actualizados${observationText}`);
        this.loadContacts();
      },
      error: (err: any) => {
        const backendMessage = err?.error?.error || err?.error?.message;
        this.showError(backendMessage || 'Error importando CSV');
      },
      complete: () => {
        this.importingPreventiveCsv = false;
        if (input) input.value = '';
      }
    });
  }

  exportPreventiveContacts(): void {
    if (this.exportingPreventiveCsv) return;
    this.exportingPreventiveCsv = true;
    this.escalationService.exportContactsCsv('preventive').subscribe({
      next: (blob: Blob) => {
        this.downloadBlob(blob, 'agenda-preventiva.csv');
        this.exportingPreventiveCsv = false;
      },
      error: () => {
        this.showError('Error al exportar contactos');
        this.exportingPreventiveCsv = false;
      }
    });
  }

  downloadPreventiveTemplate(): void {
    // Generate a simple template CSV with headers
    const headers = 'name,email,organization,phone,favorite,doNotSend,notes,isMailingList';
    const blob = new Blob([headers], { type: 'text/csv' });
    this.downloadBlob(blob, 'plantilla-agenda-preventiva.csv');
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // Directory & Quick Picker Logic
  openDirectoryQuickPicker(target: 'contact', queryHint = ''): void {
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
    if (this.directoryQuickPickerTimer) clearTimeout(this.directoryQuickPickerTimer);
    if (query.length < 2) {
      this.directoryQuickPickerSuggestions = this.getLocalDirectoryMatches(query);
      return;
    }
    this.directoryQuickPickerTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items: DirectoryContact[]) => this.directoryQuickPickerSuggestions = items || [],
        error: () => this.directoryQuickPickerSuggestions = []
      });
    }, 250);
  }

  useDirectoryQuickPick(contact: DirectoryContact): void {
    if (!contact) return;
    this.contactForm.patchValue({
      name: contact.name || '',
      email: contact.email || this.contactForm.get('email')?.value || '',
      phone: contact.phone || this.contactForm.get('phone')?.value || '',
      organization: contact.company || this.contactForm.get('organization')?.value || ''
    }, { emitEvent: false });
    this.closeDirectoryQuickPicker();
  }

  onContactNameInput(rawValue: string): void {
    const query = String(rawValue || '').trim();
    this.selectedContactDirectoryId = '';
    if (this.contactNameSearchTimer) clearTimeout(this.contactNameSearchTimer);

    if (query.length < 2) {
      this.contactDirectorySuggestions = this.getLocalDirectoryMatches(query);
      return;
    }

    this.contactNameSearchTimer = setTimeout(() => {
      this.directoryService.quickSearch(query).subscribe({
        next: (items: DirectoryContact[]) => this.contactDirectorySuggestions = items || [],
        error: () => this.contactDirectorySuggestions = []
      });
    }, 250);
  }

  onContactNameFocus(): void {
    const currentValue = String(this.contactForm.get('name')?.value || '');
    this.contactDirectorySuggestions = this.getLocalDirectoryMatches(currentValue);
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

  private getLocalDirectoryMatches(term: string): DirectoryContact[] {
    const normalized = String(term || '').trim().toLowerCase();
    const source = this.directoryContacts || [];
    if (!normalized) return source.slice(0, 8);
    return source.filter((c) => 
      [c.name, c.email, c.phone, c.company].some(v => String(v || '').toLowerCase().includes(normalized))
    ).slice(0, 8);
  }

  private syncContactFormToDirectory(data: any): void {
    const name = String(data?.name || '').trim();
    if (!name || this.selectedContactDirectoryId) return;

    this.directoryService.quickSearch(name).subscribe({
      next: (matches: DirectoryContact[]) => {
        const email = String(data?.email || '').trim().toLowerCase();
        const phone = String(data?.phone || '').trim();
        const exact = (matches || []).find((item: DirectoryContact) => {
          const sameName = String(item.name || '').trim().toLowerCase() === name.toLowerCase();
          const sameEmail = email && String(item.email || '').trim().toLowerCase() === email;
          const samePhone = phone && String(item.phone || '').trim() === phone;
          return sameName && (sameEmail || samePhone || (!email && !phone));
        });
        if (exact) return;

        this.directoryService.create({
          name,
          email: data?.email || '',
          phone: data?.phone || '',
          company: data?.organization || '',
          type: data?.contactType === 'preventive' ? 'List' : 'External'
        }).subscribe({
          next: () => this.directoryChange.emit(),
          error: () => void 0
        });
      },
      error: () => void 0
    });
  }

  // Helpers
  private updateContactValidators(): void {
    const contactType = this.contactForm?.get('contactType')?.value === 'preventive' ? 'preventive' : 'escalation';
    const serviceControl = this.contactForm?.get('serviceId');
    const organizationControl = this.contactForm?.get('organization');
    const roleControl = this.contactForm?.get('role');

    if (!serviceControl || !organizationControl || !roleControl) return;

    if (contactType === 'preventive') {
      serviceControl.clearValidators();
      roleControl.clearValidators();
      organizationControl.setValidators([Validators.required]);
      if (serviceControl.value) serviceControl.setValue('', { emitEvent: false });
      if (!roleControl.value) roleControl.setValue('PREVENTIVO', { emitEvent: false });
    } else {
      serviceControl.setValidators([Validators.required]);
      roleControl.setValidators([Validators.required]);
      organizationControl.clearValidators();
      if (!roleControl.value || roleControl.value === 'PREVENTIVO') roleControl.setValue('PARA', { emitEvent: false });
    }

    serviceControl.updateValueAndValidity({ emitEvent: false });
    roleControl.updateValueAndValidity({ emitEvent: false });
    organizationControl.updateValueAndValidity({ emitEvent: false });
  }

  filterOrgSuggestions(event: Event): void {
    const term = (event.target as HTMLInputElement).value.trim().toLowerCase();
    this.filteredOrgSuggestions = this.preventiveCompanyOptions
      .filter(org => org.toLowerCase().includes(term));
  }

  displayDirectoryContact(value: DirectoryContact | string | null): string {
    return typeof value === 'string' ? value : (value?.name || '');
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }
}
