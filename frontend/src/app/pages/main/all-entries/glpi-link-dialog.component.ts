/**
 * File Purpose: frontend/src/app/pages/main/all-entries/glpi-link-dialog.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, inject, Inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

export interface GlpiLinkDialogData {
  entryId: string;
  currentTicketId?: string | null;
}

@Component({
  selector: 'app-glpi-link-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>🎫 Vincular a ticket GLPI</h2>

    <mat-dialog-content>
      <p class="hint">
        El contenido de esta entrada se enviará como seguimiento (followup) del ticket
        indicado. Si la entrada ya está vinculada, esto reemplaza el ticket de destino.
      </p>

      <form [formGroup]="linkForm">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>ID o número del ticket GLPI</mat-label>
          <input matInput formControlName="ticketId" placeholder="Ej: 1024" />
          <mat-icon matPrefix>confirmation_number</mat-icon>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        <mat-icon>close</mat-icon>
        Cancelar
      </button>
      <button mat-raised-button color="primary" [disabled]="linkForm.invalid" (click)="onConfirm()">
        <mat-icon>link</mat-icon>
        Vincular y enviar
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 420px;
      padding: 20px;
    }

    .hint {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0 0 16px 0;
    }

    .full-width {
      width: 100%;
    }

    mat-dialog-actions {
      padding: 16px;
      gap: 8px;
    }
  `]
})
export class GlpiLinkDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<GlpiLinkDialogComponent>);

  linkForm: FormGroup;

  constructor(@Inject(MAT_DIALOG_DATA) public data: GlpiLinkDialogData) {
    this.linkForm = this.fb.group({
      ticketId: [data.currentTicketId || '', [Validators.required, Validators.pattern(/^\d+$/)]]
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onConfirm(): void {
    if (this.linkForm.invalid) {
      return;
    }
    this.dialogRef.close(String(this.linkForm.value.ticketId).trim());
  }
}
