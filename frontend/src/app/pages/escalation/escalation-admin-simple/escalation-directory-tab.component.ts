import { Component, Input, OnInit, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';

@Component({
  selector: 'app-escalation-directory-tab',
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
    MatCheckboxModule,
    MatTooltipModule
  ],
  templateUrl: './escalation-directory-tab.component.html',
  styleUrls: ['./escalation-directory-tab.component.scss']
})
export class EscalationDirectoryTabComponent implements OnInit {
  @Input() isAdminUser = false;
  @Input() canDirectoryWrite = false;
  @Input() canDirectoryDelete = false;
  @Input() directoryContacts: DirectoryContact[] = [];
  @Input() loadingDirectoryContacts = false;
  
  @Output() directoryRefresh = new EventEmitter<void>();

  directorySearch = '';
  directoryTypeFilter: '' | 'Internal' | 'External' | 'List' = '';
  directoryCompanyFilter = '';
  directoryPageSize: 50 | 100 | 'all' = 50;
  directoryPageIndex = 0;

  rebuildingDirectory = false;
  mergingDirectoryDuplicates = false;
  showDirectoryForm = false;
  savingDirectoryContact = false;
  editingDirectoryContactId: string | null = null;

  directoryFormModel = {
    name: '',
    email: '',
    phone: '',
    company: '',
    position: '',
    type: 'External' as 'Internal' | 'External' | 'List',
    scope: 'External' as 'Internal' | 'External',
    isFavorite: false
  };

  constructor(
    private directoryService: DirectoryService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {}

  get directoryCompanyOptions(): string[] {
    const values = new Set(
      (this.directoryContacts || [])
        .map((c) => String(c.company || '').trim())
        .filter((v) => v.length > 0)
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }

  get filteredDirectoryContacts(): DirectoryContact[] {
    const term = this.directorySearch.trim().toLowerCase();
    return (this.directoryContacts || []).filter((c) => {
      const matchesTerm = !term || [c.name, c.email, c.phone, c.company, c.position]
        .some((v) => String(v || '').toLowerCase().includes(term));
      const matchesType = !this.directoryTypeFilter || c.type === this.directoryTypeFilter;
      const matchesCompany = !this.directoryCompanyFilter || c.company === this.directoryCompanyFilter;
      return matchesTerm && matchesType && matchesCompany;
    });
  }

  get paginatedDirectoryContacts(): DirectoryContact[] {
    if (this.directoryPageSize === 'all') return this.filteredDirectoryContacts;
    const start = this.directoryPageIndex * (this.directoryPageSize as number);
    return this.filteredDirectoryContacts.slice(start, start + (this.directoryPageSize as number));
  }

  get directoryTotalPages(): number {
    if (this.directoryPageSize === 'all') return 1;
    return Math.ceil(this.filteredDirectoryContacts.length / (this.directoryPageSize as number));
  }

  get directoryStartItem(): number {
    if (this.filteredDirectoryContacts.length === 0) return 0;
    return this.directoryPageIndex * (this.directoryPageSize === 'all' ? this.filteredDirectoryContacts.length : this.directoryPageSize as number) + 1;
  }

  get directoryEndItem(): number {
    const total = this.filteredDirectoryContacts.length;
    if (this.directoryPageSize === 'all') return total;
    const end = (this.directoryPageIndex + 1) * (this.directoryPageSize as number);
    return end > total ? total : end;
  }

  applyDirectoryFilters(): void {
    this.directoryPageIndex = 0;
    this.cdr.detectChanges();
  }

  nextDirectoryPage(): void {
    if (this.directoryPageIndex < this.directoryTotalPages - 1) {
      this.directoryPageIndex++;
    }
  }

  prevDirectoryPage(): void {
    if (this.directoryPageIndex > 0) {
      this.directoryPageIndex--;
    }
  }

  // CRUD
  addDirectoryContact(): void {
    if (!this.canDirectoryWrite) {
      this.showError('No tienes permisos para crear contactos');
      return;
    }
    this.editingDirectoryContactId = null;
    this.directoryFormModel = {
      name: '', email: '', phone: '', company: '', position: '',
      type: 'External', scope: 'External', isFavorite: false
    };
    this.showDirectoryForm = true;
  }

  editDirectoryContact(contact: DirectoryContact): void {
    if (!this.canDirectoryWrite) {
      this.showError('No tienes permisos para editar');
      return;
    }
    if (this.isDirectoryInternal(contact)) {
      this.showError('Los usuarios internos se editan en el módulo de Usuarios');
      return;
    }
    this.editingDirectoryContactId = contact._id;
    this.directoryFormModel = {
      name: String(contact.name || ''),
      email: String(contact.email || ''),
      phone: String(contact.phone || ''),
      company: String(contact.company || ''),
      position: String(contact.position || ''),
      type: (contact.type as any) || 'External',
      scope: (contact.scope as any) || (contact.type === 'Internal' ? 'Internal' : 'External'),
      isFavorite: !!contact.isFavorite
    };
    this.showDirectoryForm = true;
  }

  saveDirectoryContact(): void {
    if (!this.canDirectoryWrite) return;
    if (!this.directoryFormModel.name.trim()) {
      this.showError('El nombre es obligatorio');
      return;
    }
    if (this.savingDirectoryContact) return;

    this.savingDirectoryContact = true;
    const request$ = this.editingDirectoryContactId
      ? this.directoryService.update(this.editingDirectoryContactId, this.directoryFormModel)
      : this.directoryService.create(this.directoryFormModel);

    request$.subscribe({
      next: () => {
        this.showSuccess(this.editingDirectoryContactId ? 'Contacto actualizado' : 'Contacto creado');
        this.showDirectoryForm = false;
        this.savingDirectoryContact = false;
        this.directoryRefresh.emit();
      },
      error: (err: any) => {
        this.showError(err?.error?.message || 'Error al guardar');
        this.savingDirectoryContact = false;
      }
    });
  }

  deleteDirectoryContact(id: string): void {
    if (!this.canDirectoryDelete) return;
    if (!confirm('¿Eliminar este contacto del directorio?')) return;

    this.directoryService.delete(id).subscribe({
      next: () => {
        this.showSuccess('Contacto eliminado');
        this.directoryRefresh.emit();
      },
      error: () => this.showError('Error al eliminar')
    });
  }

  syncAndMergeDirectoryNow(): void {
    if (!this.canDirectoryWrite) return;
    this.rebuildingDirectory = true;
    this.directoryService.rebuildFromEscalation().subscribe({
      next: () => {
        this.rebuildingDirectory = false;
        this.mergingDirectoryDuplicates = true;
        this.directoryService.mergeDuplicates().subscribe({
          next: () => {
            this.mergingDirectoryDuplicates = false;
            this.showSuccess('Directorio sincronizado y consolidado');
            this.directoryRefresh.emit();
          },
          error: () => {
            this.mergingDirectoryDuplicates = false;
            this.directoryRefresh.emit();
          }
        });
      },
      error: () => {
        this.rebuildingDirectory = false;
        this.directoryRefresh.emit();
      }
    });
  }

  cancelDirectoryForm(): void {
    this.showDirectoryForm = false;
    this.editingDirectoryContactId = null;
  }

  // Helpers
  getDirectoryTypeLabel(type?: string): string {
    switch (type) {
      case 'Internal': return 'Interno';
      case 'External': return 'Personal';
      case 'List': return 'Lista';
      default: return type || 'N/A';
    }
  }

  getDirectoryScopeLabel(scope?: string): string {
    return scope === 'Internal' ? 'Interno' : 'Externo';
  }

  isDirectoryInternal(contact: DirectoryContact): boolean {
    return contact?.type === 'Internal' || contact?.scope === 'Internal';
  }

  copyDirectoryValue(value: string, label: string): void {
    if (!value) return;
    navigator.clipboard.writeText(value);
    this.showSuccess(`${label} copiado al portapapeles`);
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }
}
