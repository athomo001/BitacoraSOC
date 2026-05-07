/**
 * File Purpose: frontend/src/app/pages/main/tags/tags.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TagService } from '../../../services/tag.service';
import { TagStats } from '../../../models/report.model';
import { NgIf } from '@angular/common';

import { MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatChip } from '@angular/material/chips';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-tags',
    templateUrl: './tags.component.html',
    styleUrls: ['./tags.component.scss'],
    imports: [NgIf, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatChip, MatIconButton, MatTooltip, MatIcon, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow]
})
export class TagsComponent implements OnInit {
  tags: Array<TagStats & { name?: string }> = [];
  isLoading = false;
  displayedColumns: string[] = ['name', 'count', 'actions'];

  constructor(
    private tagService: TagService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadTags();
  }

  loadTags(): void {
    this.isLoading = true;
    this.tagService.getAll().subscribe({
      next: (response) => {
        this.tags = response.tags || [];
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error cargando tags:', err);
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error cargando tags', 'Cerrar', { duration: 3000 });
      }
    });
  }

  deleteTag(tag: TagStats & { name?: string }): void {
    const tagName = (tag.tag || tag.name || '').toLowerCase();
    if (!confirm(`Eliminar el tag "${tagName}" de todas las entradas?`)) return;

    this.tagService.delete(tagName).subscribe({
      next: () => {
        this.snackBar.open('Tag eliminado', 'Cerrar', { duration: 3000 });
        this.loadTags();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error eliminando tag', 'Cerrar', { duration: 3000 });
      }
    });
  }

  normalizeTag(tag: TagStats & { name?: string }): void {
    const currentName = tag.tag || tag.name || '';
    const newName = prompt('Nuevo nombre para el tag:', currentName);
    if (!newName || newName === currentName) return;

    this.tagService.rename(currentName, newName.toLowerCase().trim()).subscribe({
      next: () => {
        this.snackBar.open('Tag actualizado', 'Cerrar', { duration: 3000 });
        this.loadTags();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error actualizando tag', 'Cerrar', { duration: 3000 });
      }
    });
  }

  viewEntriesByTag(tag: TagStats & { name?: string }): void {
    const tagName = tag.tag || tag.name || '';
    this.router.navigate(['/main/all-entries'], {
      queryParams: { tag: tagName }
    });
  }
}
