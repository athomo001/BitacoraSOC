import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { EntryService } from '../../../services/entry.service';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogLogSource } from '../../../models/catalog.model';
import { Entry } from '../../../models/entry.model';
import { AuthService } from '../../../services/auth.service';
import { EntryDetailDialogComponent } from './entry-detail-dialog.component';
import { AdminEditDialogComponent } from './admin-edit-dialog.component';

@Component({
    selector: 'app-all-entries',
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatSelectModule,
        MatTableModule,
        MatPaginatorModule,
        MatIconModule,
        MatChipsModule,
        MatSnackBarModule,
        MatDialogModule,
        MatCheckboxModule,
        MatTooltipModule
    ],
    templateUrl: './all-entries.component.html',
    styleUrl: './all-entries.component.scss'
})
export class AllEntriesComponent implements OnInit {
  searchForm: FormGroup;
  entries: Entry[] = [];
  totalEntries = 0;
  pageSize = 20;
  currentPage = 1;
  isGuest = false;
  isAdmin = false;
  logSources: CatalogLogSource[] = [];
  
  // Selección masiva
  selectedEntries: Set<string> = new Set();
  allSelected = false;

  displayedColumns: string[] = ['entryDate', 'entryTime', 'entryType', 'content', 'tags', 'clientId', 'author', 'actions'];

  entryTypeOptions: { value: string; label: string }[] = [
    { value: '', label: 'Todos' },
    { value: 'operativa', label: 'Operativa' },
    { value: 'ofensa', label: 'Ofensa' },
    { value: 'incidente', label: 'Incidente' },
    { value: 'checklist', label: 'Checklist' }
  ];

  constructor(
    private fb: FormBuilder,
    private entryService: EntryService,
    private catalogService: CatalogService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private route: ActivatedRoute
  ) {
    this.searchForm = this.fb.group({
      search: [''],
      entryType: [''],
      clientId: [''],
      startDate: [''],
      endDate: [''],
      tags: ['']
    });
  }

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    this.isGuest = user?.role === 'guest';
    this.isAdmin = user?.role === 'admin';
    
    // Admin ve columna de selección, guest no ve acciones
    if (this.isAdmin) {
      this.displayedColumns = ['select', ...this.displayedColumns];
    }
    if (this.isGuest) {
      this.displayedColumns = this.displayedColumns.filter(col => col !== 'actions');
    }

    // Cargar clientes disponibles
    this.catalogService.searchLogSources('').subscribe(
      (result) => {
        this.logSources = result.items || [];
      },
      () => {
        // Error silencioso
      }
    );

    this.route.queryParamMap.subscribe(params => {
      const tag = params.get('tag')?.trim();
      if (tag) {
        this.searchForm.patchValue({ tags: tag });
      }
      this.currentPage = 1;
      this.loadEntries();
    });
  }

  loadEntries(): void {
    const filters = this.searchForm.value;
    const params: any = {
      page: this.currentPage,
      limit: this.pageSize
    };

    if (filters.search?.trim()) params.search = filters.search.trim();
    if (filters.entryType) params.entryType = filters.entryType;
    if (filters.clientId) params.clientId = filters.clientId; // Filtro cliente (B2i)
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.tags?.trim()) params.tags = filters.tags.trim();

    this.entryService.getEntries(params).subscribe({
      next: (response) => {
        this.entries = response.entries;
        this.totalEntries = response.pagination?.total || 0;
      },
      error: (err) => {
        const msg = err.error?.message || 'Error cargando entradas';
        this.snackBar.open(msg, 'Cerrar', { duration: 3000 });
      }
    });
  }

  onSearch(): void {
    this.currentPage = 1;
    this.loadEntries();
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadEntries();
  }

  onDelete(entry: Entry): void {
    if (this.isChecklistEntry(entry)) {
      this.snackBar.open('Los checklists se eliminan desde Historial Checklists', 'Cerrar', { duration: 2800 });
      return;
    }

    if (!confirm('¿Eliminar esta entrada?')) return;

    this.entryService.deleteEntry(entry._id).subscribe({
      next: () => {
        this.snackBar.open('✅ Entrada eliminada', 'Cerrar', { duration: 2000 });
        this.loadEntries();
      },
      error: (err) => {
        const msg = err.error?.message || 'Error eliminando entrada';
        this.snackBar.open(msg, 'Cerrar', { duration: 3000 });
      }
    });
  }

  viewEntry(entry: Entry): void {
    const author = entry.createdByUsername || 'N/A';
    const date = this.formatEntryDate(entry.entryDate);
    const time = entry.entryTime;
    const type = this.getEntryTypeLabel(entry).toUpperCase();
    const tags = entry.tags?.join(', ') || 'Sin tags';

    const details = `Fecha: ${date} ${time}
Autor: ${author}
Tags: ${tags}`;

    this.dialog.open(EntryDetailDialogComponent, {
      data: {
        title: `Entrada ${type}`,
        details,
        content: entry.content || ''
      },
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '85vh'
    });
  }

  private formatEntryDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  clearSearch(): void {
    this.searchForm.reset({
      search: '',
      entryType: '',
      clientId: '',
      startDate: '',
      endDate: '',
      tags: ''
    });
    this.currentPage = 1;
    this.loadEntries();
  }

  // Selección masiva
  toggleSelectAll(): void {
    const selectableEntries = this.entries.filter((entry) => !this.isChecklistEntry(entry));

    if (this.allSelected) {
      this.selectedEntries.clear();
      this.allSelected = false;
    } else {
      selectableEntries.forEach(entry => this.selectedEntries.add(entry._id));
      this.allSelected = selectableEntries.length > 0;
    }
  }

  toggleSelectEntry(entryId: string): void {
    const entry = this.entries.find((item) => item._id === entryId);
    if (!entry || this.isChecklistEntry(entry)) {
      return;
    }

    if (this.selectedEntries.has(entryId)) {
      this.selectedEntries.delete(entryId);
      this.allSelected = false;
    } else {
      this.selectedEntries.add(entryId);
      const selectableCount = this.entries.filter((item) => !this.isChecklistEntry(item)).length;
      if (this.selectedEntries.size === selectableCount) {
        this.allSelected = true;
      }
    }
  }

  isEntrySelected(entryId: string): boolean {
    return this.selectedEntries.has(entryId);
  }

  clearSelection(): void {
    this.selectedEntries.clear();
    this.allSelected = false;
  }

  // Edición masiva (admin)
  openAdminEditDialog(): void {
    if (this.selectedEntries.size === 0) {
      this.snackBar.open('⚠️ Selecciona al menos una entrada', 'Cerrar', { duration: 2000 });
      return;
    }

    const entryIds = Array.from(this.selectedEntries);
    
    // Si es edición individual, pre-cargar valores actuales
    const currentValues = entryIds.length === 1
      ? this.entries.find(e => e._id === entryIds[0])
      : undefined;

    const dialogRef = this.dialog.open(AdminEditDialogComponent, {
      data: {
        entryCount: entryIds.length,
        currentValues: currentValues
          ? {
              tags: currentValues.tags,
              clientId: currentValues.clientId,
              entryType: currentValues.entryType
            }
          : undefined
      },
      width: '600px',
      maxWidth: '95vw',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe((updates) => {
      console.log('🔵 [Admin Edit] Dialog closed with updates:', updates);
      if (!updates) return; // Cancelado

      console.log('🟢 [Admin Edit] Calling adminEditEntries with:', { entryIds, updates });
      this.entryService.adminEditEntries(entryIds, updates).subscribe({
        next: (response) => {
          console.log('✅ [Admin Edit] Response:', response);
          this.snackBar.open(
            `✅ ${response.modifiedCount} entrada(s) actualizada(s)`,
            'Cerrar',
            { duration: 3000 }
          );
          this.clearSelection();
          this.loadEntries();
        },
        error: (err) => {
          console.error('❌ [Admin Edit] Error:', err);
          const msg = err.error?.message || 'Error editando entradas';
          this.snackBar.open(`❌ ${msg}`, 'Cerrar', { duration: 4000 });
        }
      });
    });
  }

  isChecklistEntry(entry: Entry): boolean {
    return entry.entryType === 'checklist';
  }

  getEntryTypeLabel(entry: Entry): string {
    if (entry.entryType === 'checklist') return 'Checklist';
    if (entry.entryType === 'incidente') return 'Incidente';
    if (entry.entryType === 'ofensa') return 'Ofensa';
    return 'Operativa';
  }
}
