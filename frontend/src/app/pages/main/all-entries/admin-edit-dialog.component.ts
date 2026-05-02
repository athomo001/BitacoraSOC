/**
 * File Purpose: frontend/src/app/pages/main/all-entries/admin-edit-dialog.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, inject, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommonModule } from '@angular/common';
import { CatalogService } from '../../../services/catalog.service';

export interface AdminEditDialogData {
  entryCount: number;
  // Para edición individual, podemos pre-cargar valores actuales
  currentValues?: {
    tags?: string[];
    clientId?: string | null;
    entryType?: 'operativa' | 'incidente' | 'ofensa';
  };
}

@Component({
  selector: 'app-admin-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>
      ✏️ Edición Admin {{ data.entryCount > 1 ? 'Masiva' : 'Individual' }}
    </h2>

    <mat-dialog-content>
      <div class="warning-box">
        <mat-icon>warning</mat-icon>
        <span>Se editarán <strong>{{ data.entryCount }}</strong> entrada(s)</span>
      </div>

      <form [formGroup]="editForm">
        <!-- Tags -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tags (separados por coma)</mat-label>
          <input
            matInput
            formControlName="tagsInput"
            placeholder="vulnerabilidad, firewall, incidente"
            matTooltip="Ingrese tags separados por comas. Ej: firewall, cisco, critical"
          />
          <mat-icon matSuffix>label</mat-icon>
          <mat-hint>Opcional: Deja vacío para no modificar</mat-hint>
        </mat-form-field>

        <!-- Cliente/LogSource -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Cliente / LogSource</mat-label>
          <mat-select formControlName="clientId">
            <mat-option [value]="'__no_change__'">-- No modificar --</mat-option>
            <mat-option [value]="null">-- Sin cliente --</mat-option>
            <mat-option *ngFor="let source of logSources" [value]="source._id">
              {{ source.name }}{{ source.parent ? ' (' + source.parent + ')' : '' }}
            </mat-option>
          </mat-select>
          <mat-icon matSuffix>business</mat-icon>
        </mat-form-field>

        <!-- Tipo de Entrada -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tipo de Entrada</mat-label>
          <mat-select formControlName="entryType">
            <mat-option [value]="'__no_change__'">-- No modificar --</mat-option>
            <mat-option value="operativa">✅ Operativa</mat-option>
            <mat-option value="ofensa">🔔 Ofensa</mat-option>
            <mat-option value="incidente">❗ Incidente</mat-option>
          </mat-select>
          <mat-icon matSuffix>category</mat-icon>
        </mat-form-field>
      </form>

      <div class="protected-fields">
        <h4>
          <mat-icon>lock</mat-icon>
          Campos protegidos (no editables por admin)
        </h4>
        <ul>
          <li><strong>Contenido</strong> de la entrada</li>
          <li><strong>Fecha y hora</strong> de creación</li>
          <li><strong>Autor</strong> original</li>
        </ul>
        <p class="info-text">
          <mat-icon>info</mat-icon>
          Solo el autor puede modificar el contenido y timestamp de sus propias entradas
        </p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        <mat-icon>close</mat-icon>
        Cancelar
      </button>
      <button mat-raised-button color="primary" (click)="onSave()">
        <mat-icon>save</mat-icon>
        Guardar Cambios
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 500px;
      padding: 20px;
    }

    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .warning-box {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      margin-bottom: 24px;
      background-color: rgba(255, 152, 0, 0.1);
      border-left: 4px solid #ff9800;
      border-radius: 4px;
      color: var(--text-primary);

      mat-icon {
        color: #ff9800;
      }

      strong {
        color: #ff9800;
      }
    }

    .protected-fields {
      margin-top: 24px;
      padding: 16px;
      background-color: rgba(76, 175, 80, 0.05);
      border-left: 4px solid #4caf50;
      border-radius: 4px;

      h4 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 12px 0;
        color: #4caf50;
        font-weight: 600;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      ul {
        margin: 8px 0;
        padding-left: 24px;

        li {
          margin-bottom: 4px;
          color: var(--text-primary);

          strong {
            color: #4caf50;
          }
        }
      }

      .info-text {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 12px 0 0 0;
        font-size: 13px;
        color: var(--text-secondary);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #4caf50;
        }
      }
    }

    mat-dialog-actions {
      padding: 16px;
      gap: 8px;

      button {
        mat-icon {
          margin-right: 4px;
        }
      }
    }
  `]
})
export class AdminEditDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private catalogService = inject(CatalogService);
  private dialogRef = inject(MatDialogRef<AdminEditDialogComponent>);

  editForm: FormGroup;
  logSources: any[] = [];

  constructor(@Inject(MAT_DIALOG_DATA) public data: AdminEditDialogData) {
    this.editForm = this.fb.group({
      tagsInput: [''],
      clientId: ['__no_change__'],
      entryType: ['__no_change__']
    });
  }

  ngOnInit(): void {
    this.loadLogSources();

    // Pre-cargar valores actuales si es edición individual
    if (this.data.currentValues) {
      if (this.data.currentValues.tags && this.data.currentValues.tags.length > 0) {
        this.editForm.patchValue({
          tagsInput: this.data.currentValues.tags.join(', ')
        });
      }
      if (this.data.currentValues.clientId !== undefined) {
        this.editForm.patchValue({
          clientId: this.data.currentValues.clientId || null
        });
      }
      if (this.data.currentValues.entryType) {
        this.editForm.patchValue({
          entryType: this.data.currentValues.entryType
        });
      }
    }
  }

  loadLogSources(): void {
    this.catalogService.getAllLogSources().subscribe({
      next: (response: any) => {
        this.logSources = response.items || response || [];
      },
      error: (err: any) => {
        console.error('Error cargando log sources:', err);
      }
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    console.log('🔵 [Dialog] onSave called, formValue:', this.editForm.value);
    const formValue = this.editForm.value;
    const updates: any = {};

    // Tags
    if (formValue.tagsInput && formValue.tagsInput.trim()) {
      updates.tags = formValue.tagsInput
        .split(',')
        .map((tag: string) => tag.trim().toLowerCase())
        .filter((tag: string) => tag.length > 0);
    }

    // ClientId
    if (formValue.clientId !== '__no_change__') {
      updates.clientId = formValue.clientId;
    }

    // EntryType
    if (formValue.entryType !== '__no_change__') {
      updates.entryType = formValue.entryType;
    }

    console.log('🟢 [Dialog] Updates object:', updates);
    console.log('🟡 [Dialog] Object.keys(updates).length:', Object.keys(updates).length);

    // Si no hay cambios, cerrar
    if (Object.keys(updates).length === 0) {
      console.log('⚠️ [Dialog] No updates, closing without data');
      this.dialogRef.close();
      return;
    }

    console.log('✅ [Dialog] Closing with updates:', updates);
    this.dialogRef.close(updates);
  }
}
