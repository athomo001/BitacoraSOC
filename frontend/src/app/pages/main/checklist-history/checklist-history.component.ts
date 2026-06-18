/**
 * File Purpose: frontend/src/app/pages/main/checklist-history/checklist-history.component.ts
 * Responsibilities: Define el comportamiento de la vista de historial de checklists de turnos,
 *                   incluyendo paginación, eliminación de registros (admin) y correlación de incidentes.
 * QA Notes: Mantener comentarios detallados y lógica de correlación robusta ante búsquedas difusas.
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
        const checks = response.checks || [];
        
        // Ejecutar correlación automática para cada checklist cargado en el historial
        checks.forEach((check: ShiftCheck) => this.correlateServices(check));

        this.checks = checks;
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

  /**
   * Correlaciona dinámicamente servicios marcados en rojo que no cuentan con observaciones,
   * buscando si las palabras clave del servicio se mencionan en las observaciones de otros
   * servicios en rojo del mismo checklist.
   */
  correlateServices(check: ShiftCheck): void {
    if (!check || !Array.isArray(check.services)) return;

    // Obtener los servicios en rojo que sí tienen observaciones registradas
    const servicesWithObservation = check.services.filter(s => s.status === 'rojo' && s.observation);

    check.services.forEach(service => {
      // Si el servicio falló y no tiene comentario, buscar si la causa está descrita en otro ítem
      if (service.status === 'rojo' && !service.observation) {
        let keywords = this.getSearchKeywords(service.serviceTitle);
        
        // Heredar palabras clave del servicio padre para aumentar la precisión de la correlación de sub-items
        if (service.parentServiceId) {
          const parent = check.services.find(s => s.serviceId === service.parentServiceId);
          if (parent) {
            const parentKeywords = this.getSearchKeywords(parent.serviceTitle);
            keywords = Array.from(new Set([...keywords, ...parentKeywords]));
          }
        }

        if (keywords.length === 0) return;

        // Buscar si otro servicio en rojo menciona al menos una de las palabras clave significativas de este servicio
        const matchedSource = servicesWithObservation.find(other => {
          if (other.serviceTitle === service.serviceTitle) return false;
          
          const observationNormalized = this.normalizeText(other.observation || '');
          // Coincide si al menos una de las palabras clave está en la observación
          return keywords.some(keyword => observationNormalized.includes(keyword));
        });

        if (matchedSource) {
          // Asignar causa relacionada virtual
          (service as any).correlatedFrom = {
            serviceTitle: matchedSource.serviceTitle,
            observation: matchedSource.observation
          };
        }
      }
    });
  }

  /**
   * Extrae los términos técnicos clave de un título de servicio (por ejemplo "qradar" de "QRadar (Todos los Tenants)").
   * Remueve paréntesis, diacríticos y stop-words comunes en español.
   */
  private getSearchKeywords(title: string): string[] {
    const cleanTitle = String(title || '')
      .replace(/\(.*?\)/g, '') // Quitar paréntesis y su contenido
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remover acentos
      .toLowerCase();

    // Separar en términos de 3 o más letras
    const words = cleanTitle.split(/\s+/).map(w => w.trim()).filter(w => w.length > 2);
    
    // Lista de stop-words comunes que no representan marcas o tecnologías técnicas
    const stopWords = new Set([
      'todos', 'los', 'conectar', 'actualizar', 'revision', 'general', 'salud', 
      'delitos', 'turno', 'anterior', 'del', 'con', 'para', 'una', 'uno', 'las', 
      'por', 'sus', 'componentes', 'alerta', 'alertas', 'plataforma', 'graves', 'criticos'
    ]);

    return words.filter(w => !stopWords.has(w));
  }

  /**
   * Normaliza textos a minúsculas, removiendo espacios adicionales y diacríticos (acentos)
   * para realizar búsquedas difusas libres de diferencias tipográficas.
   */
  private normalizeText(text: string): string {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
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
