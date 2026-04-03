import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';
import { EntryService } from '../../../services/entry.service';
import { CatalogService } from '../../../services/catalog.service';
import { Entry } from '../../../models/entry.model';

@Component({
  selector: 'app-entry-edit-dialog',
  template: `
    <div class="edit-dialog">
      <h2 mat-dialog-title>Editar Entrada</h2>
      
      <mat-dialog-content>
        <form [formGroup]="editForm">
          <!-- Contenido -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Contenido</mat-label>
            <textarea matInput formControlName="content" rows="10"
                      maxlength="50000"
                      (input)="enforceContentMaxLength()"
                      placeholder="Escribe el contenido de la entrada"></textarea>
            <mat-hint align="end">{{ editForm.get('content')?.value?.length || 0 }}/50000</mat-hint>
            <mat-hint *ngIf="(editForm.get('content')?.value?.length || 0) >= 50000" class="max-length-warning">Máximo 50000 caracteres alcanzado</mat-hint>
          </mat-form-field>

          <!-- Tipo de Entrada -->
          <div class="entry-type-section">
            <label>Tipo de Entrada</label>
            <mat-radio-group formControlName="entryType" class="entry-type-group">
              <mat-radio-button value="operativa" color="primary">
                ✅ Operativa
              </mat-radio-button>
              <mat-radio-button value="ofensa" color="accent">
                🔔 Ofensa
              </mat-radio-button>
              <mat-radio-button value="incidente" color="warn">
                ❗ Incidente
              </mat-radio-button>
            </mat-radio-group>
          </div>

          <!-- Fecha y Hora -->
          <div class="datetime-row">
            <mat-form-field appearance="outline" class="date-field">
              <mat-label>Fecha</mat-label>
              <input matInput type="date" formControlName="entryDate">
            </mat-form-field>

            <mat-form-field appearance="outline" class="time-field">
              <mat-label>Hora</mat-label>
              <input matInput type="time" formControlName="entryTime" placeholder="HH:MM">
            </mat-form-field>
          </div>

          <!-- Cliente / Log Source -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Cliente / Log Source</mat-label>
            <mat-select formControlName="clientId">
              <mat-option [value]="null">-- Por defecto (configurado por admin) --</mat-option>
              <mat-option *ngFor="let source of logSources" [value]="source._id">
                {{ source.name }}
              </mat-option>
            </mat-select>
            <mat-hint>Origen de esta entrada</mat-hint>
          </mat-form-field>
        </form>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()">Cancelar</button>
        <button mat-raised-button color="primary" (click)="onSave()" 
                [disabled]="editForm.invalid || isSubmitting">
          <mat-icon *ngIf="!isSubmitting">save</mat-icon>
          <mat-progress-spinner *ngIf="isSubmitting" diameter="20" mode="indeterminate"></mat-progress-spinner>
          {{ isSubmitting ? 'Guardando...' : 'Guardar' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .edit-dialog {
      min-width: 400px;
    }

    .full-width {
      width: 100%;
      margin-bottom: 20px;
    }

    .entry-type-section {
      margin: 20px 0;
    }

    .entry-type-group {
      display: flex;
      gap: 20px;
      margin-top: 10px;
    }

    .datetime-row {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
    }

    .date-field, .time-field {
      flex: 1;
    }

    mat-dialog-actions {
      padding: 20px 0 0 0;
      margin: 20px 0 0 0;
      border-top: 1px solid #e0e0e0;
    }

    button {
      margin-left: 8px;
    }

    mat-progress-spinner {
      display: inline-block;
      margin-right: 8px;
    }
  `],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    MatSelectModule
  ]
})
export class EntryEditDialogComponent implements OnInit {
  private readonly contentMaxLength = 50000;
  editForm: FormGroup;
  isSubmitting = false;
  logSources: any[] = [];

  constructor(
    private fb: FormBuilder,
    private entryService: EntryService,
    private catalogService: CatalogService,
    public dialogRef: MatDialogRef<EntryEditDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { entry: Entry }
  ) {
    const entry = data.entry;
    
    // Convertir entryDate de ISO string a YYYY-MM-DD para input type="date"
    const dateString = typeof entry.entryDate === 'string'
      ? entry.entryDate.split('T')[0]
      : new Date(entry.entryDate).toISOString().split('T')[0];

    this.editForm = this.fb.group({
      content: [entry.content, [Validators.required, Validators.maxLength(50000)]],
      entryType: [entry.entryType, Validators.required],
      entryDate: [dateString, Validators.required],
      entryTime: [entry.entryTime, [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      clientId: [entry.clientId || null]
    });
  }

  ngOnInit(): void {
    this.loadLogSources();
  }

  loadLogSources(): void {
    this.catalogService.getAllLogSources().subscribe({
      next: (response: any) => {
        const sources = response.items || response;
        this.logSources = sources.filter((s: any) => s.enabled);
      },
      error: (err: any) => {
        console.error('Error loading log sources:', err);
      }
    });
  }

  onSave(): void {
    if (this.editForm.invalid || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    const formValue = this.editForm.value;

    // Convertir fecha de YYYY-MM-DD a ISO Date
    const entryDate = new Date(formValue.entryDate + 'T00:00:00').toISOString();

    const updateData = {
      content: formValue.content,
      entryType: formValue.entryType,
      entryDate: entryDate,
      entryTime: formValue.entryTime,
      clientId: formValue.clientId
    };

    this.entryService.updateEntry(this.data.entry._id, updateData).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.dialogRef.close(true);
      },
      error: (err) => {
        console.error('Error actualizando entrada:', err);
        this.isSubmitting = false;
      }
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  enforceContentMaxLength(): void {
    const contentControl = this.editForm.get('content');
    if (!contentControl) {
      return;
    }

    const currentValue = String(contentControl.value || '');
    if (currentValue.length <= this.contentMaxLength) {
      return;
    }

    contentControl.setValue(currentValue.slice(0, this.contentMaxLength), { emitEvent: false });
  }
}
