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
import { MatButton, MatIconButton } from '@angular/material/button';

@Component({
    selector: 'app-checklist-history',
    templateUrl: './checklist-history.component.html',
    styleUrls: ['./checklist-history.component.scss'],
    imports: [NgIf, MatProgressSpinner, MatIcon, MatAccordion, NgFor, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatExpansionPanelDescription, MatDivider, MatPaginator, MatButton, MatIconButton, UpperCasePipe, DatePipe]
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
  // Habilidad de exportar a PDF: reservada a admin y auditor (mismo criterio que la Consola Admin)
  canExport = false;
  isExporting = false;

  expandedCheckId: string | null = null;

  constructor(
    private checklistService: ChecklistService,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.isAdmin = this.currentUser?.role === 'admin';
    this.canExport = this.currentUser?.role === 'admin' || this.currentUser?.role === 'auditor';
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

  correlateServices(check: ShiftCheck): void {
    if (!check || !Array.isArray(check.services)) return;

    // Obtener los servicios en rojo que sí tienen observaciones registradas
    const servicesWithObservation = check.services.filter(s => s.status === 'rojo' && s.observation);

    check.services.forEach(service => {
      // Si el servicio falló y no tiene comentario, buscar si la causa está descrita en otro ítem
      if (service.status === 'rojo' && !service.observation) {
        let matchedSource: any = null;

        // 1. Relación Jerárquica Directa: Intentar correlacionar por pertenencia directa de árbol.
        const currentServiceIdStr = service.serviceId ? service.serviceId.toString() : '';

        // Caso A: El servicio actual es padre de otros servicios.
        // Buscamos si algún hijo directo está en rojo con observación.
        if (currentServiceIdStr) {
          matchedSource = servicesWithObservation.find(other => 
            other.parentServiceId && other.parentServiceId.toString() === currentServiceIdStr
          );
        }

        // Caso B: El servicio actual es hijo de otro servicio.
        // Buscamos si el padre directo está en rojo con observación, o si algún hermano directo la tiene.
        if (!matchedSource && service.parentServiceId) {
          const parentIdStr = service.parentServiceId.toString();

          // Probar con el padre
          matchedSource = servicesWithObservation.find(other => 
            other.serviceId && other.serviceId.toString() === parentIdStr
          );

          // Probar con hermanos directos (hijos del mismo padre)
          if (!matchedSource) {
            matchedSource = servicesWithObservation.find(other => 
              other.parentServiceId && other.parentServiceId.toString() === parentIdStr &&
              other.serviceId?.toString() !== service.serviceId?.toString()
            );
          }
        }

        // 2. Correlación Heurística por palabras clave si no se halló enlace por jerarquía.
        if (!matchedSource) {
          let keywords = this.getSearchKeywords(service.serviceTitle);
          
          // Heredar palabras clave del servicio padre
          if (service.parentServiceId) {
            const parent = check.services.find(s => s.serviceId === service.parentServiceId);
            if (parent) {
              const parentKeywords = this.getSearchKeywords(parent.serviceTitle);
              keywords = Array.from(new Set([...keywords, ...parentKeywords]));
            }
          }

          if (keywords.length > 0) {
            matchedSource = servicesWithObservation.find(other => {
              if (other.serviceTitle === service.serviceTitle) return false;
              
              const observationNormalized = this.normalizeText(other.observation || '');
              return keywords.some(keyword => observationNormalized.includes(keyword));
            });
          }
        }

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

  /**
   * Exporta un unico checklist a un PDF optimizado para hoja carta, usando el dialogo
   * nativo de impresion del navegador ("Guardar como PDF"). Disponible solo para admin/auditor.
   */
  exportCheckToPdf(check: ShiftCheck, event?: Event): void {
    event?.stopPropagation();
    const title = `Checklist de ${this.getCheckTypeLabel(check.type)} - ${this.getUserDisplay(check)}`;
    const html = this.buildChecklistsPdfHtml([check], title);
    this.openPrintWindow(html);
  }

  /**
   * Exporta el historial completo (todas las paginas) a un unico PDF optimizado para hoja carta.
   * Se solicita el total de registros en una sola llamada ya que /check/history no impone limite.
   */
  exportAllToPdf(): void {
    if (this.isExporting) return;
    this.isExporting = true;

    const total = Math.max(this.totalChecks, 1);
    this.checklistService.getCheckHistory(1, total).subscribe({
      next: (response) => {
        const checks = response.checks || [];
        checks.forEach((check: ShiftCheck) => this.correlateServices(check));

        const html = this.buildChecklistsPdfHtml(checks, 'Historial Completo de Checklists');
        this.openPrintWindow(html);
        this.isExporting = false;
      },
      error: (error) => {
        console.error('Error exportando historial completo a PDF:', error);
        this.snackBar.open('Error generando el PDF del historial', 'Cerrar', { duration: 3000 });
        this.isExporting = false;
      }
    });
  }

  private openPrintWindow(html: string): void {
    const printWindow = window.open('about:blank', '_blank', 'left=200,top=200,width=1000,height=900');
    if (!printWindow) {
      this.snackBar.open('Habilita las ventanas emergentes en este sitio para exportar a PDF', 'Cerrar', { duration: 4000 });
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
  }

  private escapeHtml(text: unknown): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text ?? '').replace(/[&<>"']/g, (c) => map[c]);
  }

  private formatPdfDate(date: Date | string | undefined): string {
    const value = date ? new Date(date) : new Date();
    return value.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private renderChecklistCardHtml(check: ShiftCheck): string {
    const hasIssues = check.hasRedServices;
    const statusLabel = hasIssues ? 'CON PROBLEMAS' : 'OK';
    const statusClass = hasIssues ? 'status-error' : 'status-ok';
    const issuesCount = (check.services || []).filter(s => s.status === 'rojo').length;

    const rows = (check.services || []).map(service => {
      const isChild = !!service.parentServiceId;
      const isRed = service.status === 'rojo';
      const badgeClass = isRed ? 'status-error' : 'status-ok';
      const badgeLabel = isRed ? 'ROJO' : 'VERDE';
      const titlePrefix = isChild ? '<span class="child-arrow">&#9492;&#9472;</span> ' : '';

      let note = '&mdash;';
      if (service.observation) {
        note = this.escapeHtml(service.observation);
      } else if (service.correlatedFrom) {
        note = `<em>Causa relacionada en "${this.escapeHtml(service.correlatedFrom.serviceTitle)}": "${this.escapeHtml(service.correlatedFrom.observation)}"</em>`;
      }

      return `
        <tr>
          <td class="col-service${isChild ? ' row-child' : ''}">${titlePrefix}${this.escapeHtml(service.serviceTitle)}</td>
          <td class="col-status"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
          <td class="col-note">${note}</td>
        </tr>
      `;
    }).join('');

    return `
      <section class="check-card">
        <div class="check-card-header">
          <div class="check-card-title">
            <span class="check-type-badge">${this.escapeHtml(this.getCheckTypeLabel(check.type))}</span>
            <span class="check-card-status ${statusClass}">${statusLabel}</span>
          </div>
          <div class="check-card-meta">
            <span><strong>Fecha:</strong> ${this.formatPdfDate(check.createdAt)}</span>
            <span><strong>Responsable:</strong> ${this.escapeHtml(this.getUserDisplay(check))}</span>
            <span><strong>Checklist:</strong> ${this.escapeHtml(check.checklistName || 'Checklist')}</span>
            <span><strong>Servicios evaluados:</strong> ${check.services?.length || 0}${issuesCount > 0 ? ` (${issuesCount} con problemas)` : ''}</span>
          </div>
        </div>
        <table class="check-table">
          <thead>
            <tr>
              <th class="col-service">Servicio</th>
              <th class="col-status">Estado</th>
              <th class="col-note">Observacion</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>
    `;
  }

  private buildChecklistsPdfHtml(checks: ShiftCheck[], title: string): string {
    const generatedBy = this.currentUser?.fullName || this.currentUser?.username || 'N/A';
    const generatedAt = this.formatPdfDate(new Date());
    const cardsHtml = checks.map(check => this.renderChecklistCardHtml(check)).join('');
    const countLabel = `${checks.length} checklist${checks.length === 1 ? '' : 's'} incluido${checks.length === 1 ? '' : 's'} en este documento`;

    return `
      <html>
        <head>
          <title>${this.escapeHtml(title)}</title>
          <style>
            @page {
              size: letter portrait;
              margin: 0 !important;
            }
            * { box-sizing: border-box; }
            body {
              font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 1.2cm 1.3cm;
              background-color: #ffffff;
              color: #212121;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .doc-header {
              margin-bottom: 14px;
              border-bottom: 2px solid #1565c0;
              padding-bottom: 8px;
            }
            .doc-header-top {
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              font-size: 10px;
              color: #757575;
            }
            .doc-header h1 {
              margin: 4px 0 2px;
              font-size: 18px;
              color: #212121;
            }
            .doc-header .doc-subtitle {
              font-size: 11px;
              color: #757575;
            }
            .check-card {
              border: 1px solid #e0e0e0;
              border-radius: 6px;
              padding: 10px 12px;
              margin-bottom: 12px;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .check-card-header { margin-bottom: 8px; }
            .check-card-title {
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 4px;
            }
            .check-type-badge { font-weight: 700; font-size: 13px; }
            .check-card-status {
              font-size: 10px;
              font-weight: 700;
              padding: 2px 8px;
              border-radius: 10px;
            }
            .check-card-status.status-ok { color: #2e7d32; background: #e8f5e9; }
            .check-card-status.status-error { color: #c62828; background: #ffebee; }
            .check-card-meta {
              display: flex;
              flex-wrap: wrap;
              gap: 4px 16px;
              font-size: 10px;
              color: #424242;
            }
            .check-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 10px;
            }
            .check-table th {
              text-align: left;
              background: #f5f7fb;
              padding: 5px 6px;
              border: 1px solid #e0e0e0;
              font-size: 9.5px;
              text-transform: uppercase;
              letter-spacing: 0.03em;
              color: #757575;
            }
            .check-table td {
              padding: 5px 6px;
              border: 1px solid #e0e0e0;
              vertical-align: top;
            }
            .check-table tr { page-break-inside: avoid; break-inside: avoid; }
            .col-service { width: 34%; }
            .col-status { width: 12%; }
            .col-note { width: 54%; }
            .row-child { color: #424242; padding-left: 18px; }
            .child-arrow { color: #9e9e9e; }
            .badge {
              display: inline-block;
              padding: 2px 8px;
              border-radius: 10px;
              font-size: 9px;
              font-weight: 700;
            }
            .badge.status-ok { color: #2e7d32; background: #e8f5e9; }
            .badge.status-error { color: #c62828; background: #ffebee; }
          </style>
        </head>
        <body>
          <div class="doc-header">
            <div class="doc-header-top">
              <span>BitacoraSOC &middot; Historial de Checklists</span>
              <span>Generado el ${generatedAt} por ${this.escapeHtml(generatedBy)}</span>
            </div>
            <h1>${this.escapeHtml(title)}</h1>
            <div class="doc-subtitle">${countLabel}</div>
          </div>
          ${cardsHtml}
          <script>
            var alreadyPrinted = false;
            function triggerPrint() {
              if (alreadyPrinted) return;
              alreadyPrinted = true;
              window.print();
              window.close();
            }
            setTimeout(triggerPrint, 400);
          </script>
        </body>
      </html>
    `;
  }
}
