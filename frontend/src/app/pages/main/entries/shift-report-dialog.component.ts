/**
 * File Purpose: frontend/src/app/pages/main/entries/shift-report-dialog.component.ts
 * Responsibilities: Formulario asistido para armar el texto de Inicio/Cierre de Turno.
 * QA Notes: No crea la Entry directamente; devuelve el texto armado para que el usuario
 *           lo revise/edite en el textarea principal de Nueva Entrada antes de subir.
 */
import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { animate, style, transition, trigger } from '@angular/animations';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { buildShiftReportContent, SHIFT_METRIC_FIELDS, ShiftMetricField, ShiftReportMode } from '../../../utils/shift-report-template.util';

export interface ShiftReportDialogData {
  mode: ShiftReportMode;
}

@Component({
  selector: 'app-shift-report-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './shift-report-dialog.component.html',
  styleUrls: ['./shift-report-dialog.component.scss'],
  animations: [
    trigger('hintBox', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-4px)' }),
        animate('180ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('120ms ease-in', style({ opacity: 0, transform: 'translateY(-4px)' }))
      ])
    ])
  ]
})
export class ShiftReportDialogComponent {
  metricValues: Record<string, string> = {};
  ticketsText = '';
  notesText = '';

  constructor(
    public dialogRef: MatDialogRef<ShiftReportDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ShiftReportDialogData
  ) {}

  get isInicio(): boolean {
    return this.data.mode === 'inicio';
  }

  get dialogTitle(): string {
    return this.isInicio ? 'Inicio de Turno' : 'Cierre de Turno';
  }

  get ticketsSectionLabel(): string {
    return this.isInicio ? 'Incidentes activos / guardia pasiva' : 'Tickets activos / del día';
  }

  get notesSectionLabel(): string {
    return this.isInicio ? 'Novedades / alertas en observación' : 'Observaciones generales';
  }

  get metricFields(): ShiftMetricField[] {
    return SHIFT_METRIC_FIELDS[this.data.mode];
  }

  sanitizeMetricInput(key: string): void {
    const raw = this.metricValues[key] || '';
    // Solo dígitos, enteros, máximo 3 (0-999) — sin comas, puntos ni signos.
    this.metricValues[key] = raw.replace(/\D/g, '').slice(0, 3);
  }

  get ticketsPlaceholder(): string {
    return this.isInicio
      ? '//[Ticket #] ,[Cliente] ,[Severidad] ,[Breve descripción]'
      : '// [Ticket #] , [Cliente] , [Descripción corta]';
  }

  get ticketsAnnotationHint(): string {
    return this.isInicio
      ? '└ Estado: (Ej: Esperando logs del cliente / En escalamiento N2 / Monitoreo post-mitigación)'
      : '└ Situación actual: (Ej: Esperando confirmación de cliente sobre falso positivo)';
  }

  get ticketsAnnotationPrefix(): string {
    return this.isInicio ? '└ Estado: (escribir comentarios)' : '└ Situación actual: (escribir comentarios)';
  }

  insert(): void {
    const metrics = this.metricFields.map((field) => ({
      label: field.label,
      value: this.metricValues[field.key] || ''
    }));

    const content = buildShiftReportContent({
      mode: this.data.mode,
      metrics,
      ticketsText: this.ticketsText,
      notesText: this.notesText
    });
    this.dialogRef.close(content);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
