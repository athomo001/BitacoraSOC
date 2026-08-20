import { Component, Input, OnInit, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
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
    MatAutocompleteModule,
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
  directoryTypeFilter: '' | 'External' | 'List' = '';
  directoryScopeFilter: '' | 'Internal' | 'External' = '';
  directoryCompanyFilter = '';
  readonly noCompanyFilterValue = '__NO_COMPANY__';
  directoryPageSize: 50 | 100 | 'all' = 50;
  directoryPageIndex = 0;

  rebuildingDirectory = false;
  mergingDirectoryDuplicates = false;
  showDirectoryForm = false;
  savingDirectoryContact = false;
  editingDirectoryContactId: string | null = null;
  isEditingInternalContact = false;
  // Indicador de estado para la carga del archivo CSV
  importingCsv = false;

  directoryFormModel = {
    name: '',
    email: '',
    phone: '',
    company: '',
    position: '',
    type: 'External' as 'External' | 'List',
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

  get filteredDirectoryCompanyOptions(): string[] {
    const term = String(this.directoryFormModel.company || '').trim().toLowerCase();
    const options = this.directoryCompanyOptions;
    if (!term) return options;
    return options.filter((company) => company.toLowerCase().includes(term));
  }

  get filteredDirectoryContacts(): DirectoryContact[] {
    const term = this.directorySearch.trim().toLowerCase();
    return (this.directoryContacts || []).filter((c) => {
      const matchesTerm = !term || [c.name, c.email, c.phone, c.company, c.position]
        .some((v) => String(v || '').toLowerCase().includes(term));
      const matchesType = !this.directoryTypeFilter || c.type === this.directoryTypeFilter;
      const matchesScope = !this.directoryScopeFilter || c.scope === this.directoryScopeFilter;
      const matchesCompany = !this.directoryCompanyFilter
        || (this.directoryCompanyFilter === this.noCompanyFilterValue
          ? !String(c.company || '').trim()
          : c.company === this.directoryCompanyFilter);
      return matchesTerm && matchesType && matchesScope && matchesCompany;
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
    this.isEditingInternalContact = false;
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

    if (this.editingDirectoryContactId === contact._id && this.showDirectoryForm) {
      this.cancelDirectoryForm();
      return;
    }

    this.isEditingInternalContact = this.isDirectoryInternal(contact);
    this.editingDirectoryContactId = contact._id;
    this.directoryFormModel = {
      name: String(contact.name || ''),
      email: String(contact.email || ''),
      phone: String(contact.phone || ''),
      company: String(contact.company || ''),
      position: String(contact.position || ''),
      type: this.normalizeDirectoryType(contact.type),
      scope: (contact.scope as any) || (contact.type === 'Internal' ? 'Internal' : 'External'),
      isFavorite: !!contact.isFavorite
    };
    this.showDirectoryForm = true;
  }

  isEditingDirectoryContact(contact: DirectoryContact): boolean {
    return this.showDirectoryForm && !!contact?._id && this.editingDirectoryContactId === contact._id;
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

    this.mergingDirectoryDuplicates = true;

    const runMergeAndUserSync = () => this.directoryService.mergeDuplicates().subscribe({
      next: () => {
        this.directoryService.syncUsersFromDirectory().subscribe({
          next: (syncFromResult: any) => {
            this.directoryService.syncUsersToDirectory().subscribe({
              next: (syncToResult: any) => {
                this.mergingDirectoryDuplicates = false;
                const retroactive = Number(syncFromResult?.updatedUsers || 0);
                const synced = Number(syncToResult?.syncedCount || 0);
                this.showSuccess(`Duplicados consolidados (${retroactive} retroactivos, ${synced} al directorio)`);
                this.directoryRefresh.emit();
              },
              error: () => {
                this.mergingDirectoryDuplicates = false;
                this.showError('Sincronización retroactiva OK, pero falló la de usuarios al directorio');
                this.directoryRefresh.emit();
              }
            });
          },
          error: () => {
            this.mergingDirectoryDuplicates = false;
            this.showError('Consolidado OK, pero falló la sincronización retroactiva de usuarios');
            this.directoryRefresh.emit();
          }
        });
      },
      error: (err: any) => {
        this.mergingDirectoryDuplicates = false;
        this.showError(err?.error?.message || 'Error al consolidar');
        this.directoryRefresh.emit();
      }
    });

    // If directory is empty, allow admin to rebuild first to avoid no-op sync/merge.
    if ((this.directoryContacts || []).length === 0 && this.isAdminUser) {
      this.directoryService.rebuildFromEscalation().subscribe({
        next: () => runMergeAndUserSync(),
        error: (err: any) => {
          this.mergingDirectoryDuplicates = false;
          this.showError(err?.error?.message || 'Error al reconstruir directorio desde escalación');
        }
      });
      return;
    }

    runMergeAndUserSync();
  }

  cancelDirectoryForm(): void {
    this.showDirectoryForm = false;
    this.editingDirectoryContactId = null;
    this.isEditingInternalContact = false;
  }

  // Helpers
  getDirectoryTypeLabel(type?: string): string {
    switch (type) {
      case 'Internal': return 'Personal';
      case 'External': return 'Personal';
      case 'List': return 'Lista';
      default: return type || 'N/A';
    }
  }

  private normalizeDirectoryType(type?: string): 'External' | 'List' {
    return type === 'List' ? 'List' : 'External';
  }

  getDirectoryScopeLabel(scope?: string): string {
    return scope === 'Internal' ? 'Interno' : 'Externo';
  }

  isDirectoryInternal(contact: DirectoryContact): boolean {
    return contact?.source === 'User';
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

  /**
   * Captura el evento de selección del archivo CSV e invoca al servicio para su importación masiva.
   * @param event - Evento nativo de selección de archivos.
   */
  onCsvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    
    // Limpiar el valor para permitir re-seleccionar el mismo archivo
    input.value = '';

    this.importingCsv = true;
    this.directoryService.importCsv(file).subscribe({
      next: (res) => {
        this.importingCsv = false;
        let message = `Importación completada: ${res.created} nuevos, ${res.updated} actualizados.`;
        if (res.errorCount > 0) {
          message += ` Con ${res.errorCount} observaciones no importadas.`;
        }
        this.showSuccess(message);

        // Si se encontraron errores de parseo en filas individuales, detallar el primero en pantalla
        if (res.errors && res.errors.length > 0) {
          const firstErr = res.errors[0];
          console.warn('[CSV Import] Observaciones encontradas:', res.errors);
          this.snackBar.open(`Observación en fila ${firstErr.row}: ${firstErr.message}`, 'Cerrar', { duration: 6000 });
        }

        this.directoryRefresh.emit();
      },
      error: (err) => {
        this.importingCsv = false;
        this.showError(err?.error?.error || err?.error?.message || 'Error al procesar el archivo de importación CSV');
      }
    });
  }

  /**
   * Genera y descarga un archivo CSV de plantilla para la importación de contactos.
   */
  downloadCsvTemplate(): void {
    const headers = ['Nombre', 'Correo', 'Teléfono', 'Empresa', 'Cargo', 'Tipo', 'Ámbito', 'Favorito'];
    const exampleRow = ['Juan Pérez', 'juan.perez@empresa.cl', '+56912345678', 'Empresa Ejemplo', 'Analista SOC', 'External', 'External', 'false'];
    
    // Contenido del CSV delimitado por comas con BOM para que Excel detecte correctamente UTF-8
    const csvContent = '\uFEFF' + [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'plantilla_contactos_directorio.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
