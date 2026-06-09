/**
 * File Purpose: frontend/src/app/pages/main/backup/backup.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { DatePipe, NgIf } from '@angular/common';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';

@Component({
    selector: 'app-backup',
    templateUrl: './backup.component.html',
    styleUrls: ['./backup.component.scss'],
    imports: [MatIcon, MatButton, NgIf, DatePipe, MatProgressSpinner, MatCheckbox, ReactiveFormsModule, FormsModule, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatIconButton, MatTooltip, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatFormField, MatLabel, MatHint, MatInput, MatOption, MatSelect, MatSlideToggle]
})
export class BackupComponent implements OnInit {
  isExporting = false;
  isImporting = false;
  isPurging = false;
  backupHistory: any[] = [];
  clearBeforeRestore = false;
  purgeConfirmText = '';
  readonly purgeConfirmRequired = 'PURGAR TODO';
  backupConfigForm: FormGroup;
  lastAutoAttemptAt: string | null = null;
  lastAutoRunAt: string | null = null;
  nextAutoRunAt: string | null = null;
  lastAutoRunStatus = 'idle';
  lastAutoRunMessage = '';

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {
    this.backupConfigForm = this.fb.group({
      enabled: [false],
      intervalDays: [7, [Validators.required, Validators.min(1), Validators.max(365)]],
      destinationType: ['local', Validators.required],
      localRetentionDays: [30, [Validators.required, Validators.min(1), Validators.max(365)]],
      destinationPath: ['']
    });

    this.backupConfigForm.get('destinationType')?.valueChanges.subscribe((destinationType) => {
      this.applyDestinationPathValidation(destinationType);
    });
  }

  ngOnInit(): void {
    this.loadBackupConfig();
    this.loadBackupHistory();
  }

  loadBackupConfig(): void {
    this.http.get<any>(`${environment.apiUrl}/backup/config`).subscribe({
      next: (config) => {
        this.backupConfigForm.patchValue({
          enabled: config.enabled || false,
          intervalDays: config.intervalDays || 7,
          destinationType: config.destinationType || 'local',
          localRetentionDays: config.localRetentionDays || 30,
          destinationPath: config.destinationConfig?.basePath || ''
        });
        this.lastAutoAttemptAt = config.lastAutoAttemptAt || null;
        this.lastAutoRunAt = config.lastAutoRunAt || null;
        this.nextAutoRunAt = config.nextAutoRunAt || null;
        this.lastAutoRunStatus = config.lastAutoRunStatus || 'idle';
        this.lastAutoRunMessage = config.lastAutoRunMessage || '';
        this.applyDestinationPathValidation(config.destinationType || 'local');
      },
      error: (err) => console.error('Error cargando Backup Config:', err)
    });
  }

  saveBackupConfig(): void {
    if (this.backupConfigForm.valid) {
      const payload = {
        enabled: this.backupConfigForm.value.enabled,
        intervalDays: Number(this.backupConfigForm.value.intervalDays),
        destinationType: this.backupConfigForm.value.destinationType,
        localRetentionDays: Number(this.backupConfigForm.value.localRetentionDays),
        destinationConfig: {
          basePath: (this.backupConfigForm.value.destinationPath || '').trim()
        }
      };

      this.http.put<any>(`${environment.apiUrl}/backup/config`, payload).subscribe({
        next: () => {
          this.snackBar.open('Configuración de Backup guardada', 'Cerrar', { duration: 2000 });
          this.loadBackupConfig();
        },
        error: () => this.snackBar.open('Error guardando configuración de Backup', 'Cerrar', { duration: 3000 })
      });
    }
  }

  getAutoBackupStatusLabel(): string {
    const labels: Record<string, string> = {
      idle: 'Inactivo',
      scheduled: 'Programado',
      success: 'Última ejecución correcta',
      error: 'Última ejecución con error'
    };

    return labels[this.lastAutoRunStatus] || 'Desconocido';
  }

  private applyDestinationPathValidation(destinationType: string): void {
    const destinationPathControl = this.backupConfigForm.get('destinationPath');
    if (!destinationPathControl) {
      return;
    }

    if (destinationType === 'smb' || destinationType === 'nfs') {
      destinationPathControl.setValidators([Validators.required]);
    } else {
      destinationPathControl.clearValidators();
    }

    destinationPathControl.updateValueAndValidity({ emitEvent: false });
  }

  testAutoBackup(): void {
    this.http.post<any>(`${environment.apiUrl}/backup/test-auto`, {}).subscribe({
      next: (res) => this.snackBar.open(res.message, 'Cerrar', { duration: 3000 }),
      error: () => this.snackBar.open('Error iniciando backup manual', 'Cerrar', { duration: 3000 })
    });
  }

  loadBackupHistory(): void {
    this.http.get<any>(`${environment.apiUrl}/backup/history`).subscribe({
      next: (response) => {
        this.backupHistory = response.backups || [];
      },
      error: () => {
        this.backupHistory = [];
      }
    });
  }

  exportCSV(type: 'entries' | 'checks' | 'all'): void {
    this.isExporting = true;
    
    this.http.get(`${environment.apiUrl}/backup/export/${type}`, { 
      responseType: 'blob' 
    }).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bitacora-soc-${type}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.isExporting = false;
        this.snackBar.open('Exportación completada', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isExporting = false;
        this.snackBar.open(err.error?.message || 'Error exportando', 'Cerrar', { duration: 3000 });
      }
    });
  }

  createBackup(): void {
    if (!confirm('¿Crear backup completo de la base de datos?')) return;

    this.isExporting = true;
    this.http.post<any>(`${environment.apiUrl}/backup/create`, {}).subscribe({
      next: (response) => {
        this.isExporting = false;
        this.snackBar.open('Backup creado: ' + response.filename, 'Cerrar', { duration: 5000 });
        this.loadBackupHistory();
      },
      error: (err) => {
        this.isExporting = false;
        this.snackBar.open(err.error?.message || 'Error creando backup', 'Cerrar', { duration: 3000 });
      }
    });
  }

  restoreBackup(backup: any): void {
    const action = this.clearBeforeRestore ? 'BORRAR TODOS LOS DATOS y restaurar' : 'agregar datos del';
    if (!confirm(`¿Confirmar ${action} backup ${backup.filename}? Esta operación no se puede deshacer.`)) return;

    this.isImporting = true;
    this.http.post<any>(`${environment.apiUrl}/backup/restore`, { 
      filename: backup.filename,
      clearBeforeRestore: this.clearBeforeRestore
    }).subscribe({
      next: (response) => {
        this.isImporting = false;
        this.snackBar.open(`Backup restaurado: ${response.imported} documentos`, 'Cerrar', { duration: 5000 });
      },
      error: (err) => {
        this.isImporting = false;
        this.snackBar.open(err.error?.message || 'Error restaurando', 'Cerrar', { duration: 3000 });
      }
    });
  }

  deleteBackup(backup: any): void {
    if (!confirm(`¿Eliminar backup "${backup.filename}"?`)) return;

    this.http.delete(`${environment.apiUrl}/backup/${backup._id}`).subscribe({
      next: () => {
        this.snackBar.open('Backup eliminado', 'Cerrar', { duration: 3000 });
        this.loadBackupHistory();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error eliminando', 'Cerrar', { duration: 3000 });
      }
    });
  }

  importBackup(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.name.endsWith('.json') && !file.name.endsWith('.zip')) {
      this.snackBar.open('Solo se permiten archivos JSON o ZIP', 'Cerrar', { duration: 3000 });
      return;
    }

    if (!confirm('¿Importar este backup? Esto agregará los datos al sistema.')) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('clearBeforeRestore', String(this.clearBeforeRestore));

    this.isImporting = true;
    this.http.post<any>(`${environment.apiUrl}/backup/import`, formData).subscribe({
      next: (response) => {
        this.isImporting = false;
        this.snackBar.open(`Importados ${response.imported} registros`, 'Cerrar', { duration: 5000 });
        input.value = ''; // Limpiar el input
      },
      error: (err) => {
        this.isImporting = false;
        this.snackBar.open(err.error?.message || 'Error importando', 'Cerrar', { duration: 3000 });
        input.value = '';
      }
    });
  }

  purgeAllData(): void {
    if (this.purgeConfirmText.trim() !== this.purgeConfirmRequired) {
      this.snackBar.open(`Escribe exactamente: ${this.purgeConfirmRequired}`, 'Cerrar', { duration: 4000 });
      return;
    }

    if (!confirm('⚠️ Esta acción elimina TODOS los datos del sistema. ¿Deseas continuar?')) return;

    this.isPurging = true;
    this.http.post<any>(`${environment.apiUrl}/backup/purge`, {
      confirmation: this.purgeConfirmText.trim()
    }).subscribe({
      next: (response) => {
        this.isPurging = false;
        this.snackBar.open(response.message || 'Datos purgados', 'Cerrar', { duration: 5000 });
        this.purgeConfirmText = '';
        this.loadBackupHistory();
      },
      error: (err) => {
        this.isPurging = false;
        this.snackBar.open(err.error?.message || 'Error purgando datos', 'Cerrar', { duration: 4000 });
      }
    });
  }

  downloadBackup(backup: any): void {
    this.http.get(`${environment.apiUrl}/backup/download/${backup.filename}`, {
      responseType: 'blob'
    }).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backup.filename;
        a.click();
        window.URL.revokeObjectURL(url);
        this.snackBar.open('Descarga completada', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error descargando', 'Cerrar', { duration: 3000 });
      }
    });
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString('es-CL');
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
