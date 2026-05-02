/**
 * File Purpose: frontend/src/app/pages/main/checklist-history/checklist-history.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { ChecklistService } from '../../../services/checklist.service';
import { AuthService } from '../../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ShiftCheck, ServiceCheck } from '../../../models/checklist.model';
import { NgIf, NgFor, UpperCasePipe, DatePipe } from '@angular/common';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatExpansionPanelDescription } from '@angular/material/expansion';
import { MatDivider } from '@angular/material/divider';
import { MatPaginator } from '@angular/material/paginator';
import { MatIconButton } from '@angular/material/button';

@Component({
    selector: 'app-checklist-history',
    templateUrl: './checklist-history.component.html',
    styleUrls: ['./checklist-history.component.scss'],
    imports: [NgIf, MatProgressSpinner, MatIcon, MatAccordion, NgFor, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatExpansionPanelDescription, MatDivider, MatPaginator, MatIconButton, UpperCasePipe, DatePipe]
})
export class ChecklistHistoryComponent implements OnInit {
  checks: ShiftCheck[] = [];
  isLoading = false;
  currentPage = 1;
  totalPages = 1;
  totalChecks = 0;
  limit = 20;
  currentUser: any;
  isAdmin = false;

  expandedCheckId: string | null = null;

  constructor(
    private checklistService: ChecklistService,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.isAdmin = this.currentUser?.role === 'admin';
    this.loadHistory();
  }

  loadHistory(): void {
    this.isLoading = true;
    this.checklistService.getCheckHistory(this.currentPage, this.limit).subscribe({
      next: (response) => {
        this.checks = response.checks;
        this.totalChecks = response.pagination.total;
        this.totalPages = response.pagination.totalPages;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error cargando historial:', error);
        this.snackBar.open('Error cargando historial de checklists', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'verde': 'status-ok',
      'amarillo': 'status-warning',
      'rojo': 'status-error'
    };
    return colors[status] || 'status-unknown';
  }

  getCheckTypeLabel(type: string): string {
    return type === 'inicio' ? 'Inicio de Turno' : 'Cierre de Turno';
  }

  toggleExpand(checkId: string): void {
    this.expandedCheckId = this.expandedCheckId === checkId ? null : checkId;
  }

  isExpanded(checkId: string): boolean {
    return this.expandedCheckId === checkId;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.loadHistory();
    }
  }

  getUserDisplay(check: ShiftCheck): string {
    if (check.userId?.fullName) {
      return check.userId.fullName;
    }
    return check.username || 'Usuario desconocido';
  }

  getServicesWithIssues(check: ShiftCheck): number {
    return check.services.filter(s => s.status === 'rojo').length;
  }

  deleteCheck(check: ShiftCheck): void {
    const checkId = String((check as any)._id || (check as any).id || '');
    if (!checkId) return;
    if (!confirm(`Eliminar checklist de ${this.getCheckTypeLabel(check.type)} (${this.getUserDisplay(check)})?`)) return;

    this.checklistService.deleteCheck(checkId).subscribe({
      next: () => {
        this.snackBar.open('Checklist eliminado', 'Cerrar', { duration: 3000 });
        this.checks = this.checks.filter(c => String((c as any)._id || (c as any).id) !== checkId);
        this.totalChecks = Math.max(0, this.totalChecks - 1);
        if (this.checks.length === 0 && this.currentPage > 1) {
          this.currentPage -= 1;
        }
        this.loadHistory();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error eliminando checklist', 'Cerrar', { duration: 3000 });
      }
    });
  }
}
