/**
 * File Purpose: frontend/src/app/pages/main/my-entries/my-entries.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit, ViewChild } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { EntryService } from '../../../services/entry.service';
import { AuthService } from '../../../services/auth.service';
import { Entry } from '../../../models/entry.model';
import { NgIf, NgFor, SlicePipe, DatePipe } from '@angular/common';

import { MatChipSet, MatChip } from '@angular/material/chips';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EntryDetailDialogComponent } from '../all-entries/entry-detail-dialog.component';
import { EntryEditDialogComponent } from './entry-edit-dialog.component';

@Component({
    selector: 'app-my-entries',
    templateUrl: './my-entries.component.html',
    styleUrls: ['./my-entries.component.scss'],
  imports: [NgIf, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatChipSet, NgFor, MatChip, MatIconButton, MatTooltip, MatIcon, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatPaginator, SlicePipe, DatePipe, MatDialogModule]
})
export class MyEntriesComponent implements OnInit {
  displayedColumns: string[] = ['date', 'time', 'type', 'content', 'clientName', 'tags', 'actions'];
  dataSource = new MatTableDataSource<Entry>([]);
  isLoading = false;
  currentUser: any;

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(
    private entryService: EntryService,
    private authService: AuthService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadMyEntries();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }

  loadMyEntries(): void {
    this.isLoading = true;
    // Usar getEntries con filtro por userId (usuario actual)
    this.entryService.getEntries({ userId: this.currentUser?._id }).subscribe({
      next: (response: any) => {
        this.dataSource.data = response.entries || [];
        this.isLoading = false;
      },
      error: (err: any) => {
        console.error('Error cargando mis entradas:', err);
        this.isLoading = false;
      }
    });
  }

  getTypeLabel(type: string): string {
    switch (type) {
      case 'incidente':
        return '❗ Incidente';
      case 'ofensa':
        return '🔔 Ofensa';
      default:
        return '✅ Operativa';
    }
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('es-CL');
  }

  editEntry(entry: Entry): void {
    const dialogRef = this.dialog.open(EntryEditDialogComponent, {
      data: { entry },
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '85vh'
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.loadMyEntries();
        this.snackBar.open('✅ Entrada actualizada exitosamente', 'Cerrar', { duration: 3000 });
      }
    });
  }

  deleteEntry(entry: Entry): void {
    if (confirm('¿Estás seguro de eliminar esta entrada?')) {
      this.entryService.deleteEntry(entry._id).subscribe({
        next: () => {
          this.snackBar.open('✅ Entrada eliminada', 'Cerrar', { duration: 3000 });
          this.loadMyEntries();
        },
        error: (err: any) => {
          console.error('Error eliminando:', err);
          this.snackBar.open('Error al eliminar entrada', 'Cerrar', { duration: 3000 });
        }
      });
    }
  }

  viewEntry(entry: Entry): void {
    const author = entry.createdByUsername || this.currentUser?.username || 'N/A';
    const date = this.formatEntryDate(entry.entryDate);
    const time = entry.entryTime;
    const type = entry.entryType === 'incidente'
      ? 'INCIDENTE'
      : entry.entryType === 'ofensa'
        ? 'OFENSA'
        : 'OPERATIVA';
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
}
