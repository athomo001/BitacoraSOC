/**
 * Propósito del Archivo: frontend/src/app/pages/main/audit-logs/audit-log-detail-dialog.component.ts
 * Responsabilidad: Definir la vista del diálogo de detalles de un log de auditoría.
 * Notas: Permite visualizar la información extendida y copiar los metadatos JSON al portapapeles.
 */

import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuditLog } from '../../../models/audit-log.model';

export interface AuditLogDetailData {
  log: AuditLog;
  formattedDate: string;
  reasonText: string;
  categoryLabel: string;
  actionType: string;
}

@Component({
  selector: 'app-audit-log-detail-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule
  ],
  templateUrl: './audit-log-detail-dialog.component.html',
  styleUrls: ['./audit-log-detail-dialog.component.scss']
})
export class AuditLogDetailDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: AuditLogDetailData,
    private snackBar: MatSnackBar
  ) {}

  /**
   * Obtiene la clase de color según el nivel de severidad del log de auditoría
   */
  getLevelColor(level: string): string {
    switch (level) {
      case 'error':
        return 'warn';
      case 'warn':
        return 'accent';
      case 'info':
      default:
        return 'primary';
    }
  }

  /**
   * Obtiene la representación de cadena formateada en formato JSON bonito para metadatos
   */
  getFormattedMetadata(): string {
    const rawMetadata: Record<string, any> = {};
    
    if (this.data.log.metadata) {
      rawMetadata['metadata'] = this.data.log.metadata;
    }
    if (this.data.log.result) {
      rawMetadata['result'] = this.data.log.result;
    }
    if (this.data.log.request) {
      rawMetadata['request'] = this.data.log.request;
    }

    if (Object.keys(rawMetadata).length === 0) {
      return '';
    }

    return JSON.stringify(rawMetadata, null, 2);
  }

  /**
   * Copia el bloque de JSON de metadatos al portapapeles del sistema
   */
  copyMetadataToClipboard(): void {
    const content = this.getFormattedMetadata();
    if (!content) return;

    navigator.clipboard.writeText(content).then(
      () => {
        this.snackBar.open('Metadatos copiados al portapapeles.', 'Cerrar', {
          duration: 3000,
          horizontalPosition: 'right',
          verticalPosition: 'bottom'
        });
      },
      (err) => {
        console.error('Error al copiar al portapapeles:', err);
        this.snackBar.open('No se pudo copiar. Inténtalo seleccionando el texto.', 'Cerrar', {
          duration: 4000
        });
      }
    );
  }
}
