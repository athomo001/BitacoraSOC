import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="confirm-dialog__title">
      <mat-icon class="confirm-dialog__icon" [class.confirm-dialog__icon--danger]="data.isDestructive">
        {{ data.isDestructive ? 'warning' : 'help_outline' }}
      </mat-icon>
      <span>{{ data.title }}</span>
    </h2>
    <mat-dialog-content class="confirm-dialog__content">
      <p class="confirm-dialog__message" [innerHTML]="data.message"></p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="confirm-dialog__actions">
      <button mat-stroked-button (click)="onCancel()">{{ data.cancelText || 'Cancelar' }}</button>
      <button mat-raised-button 
              [color]="data.isDestructive ? 'warn' : 'primary'" 
              (click)="onConfirm()">
        {{ data.confirmText || 'Confirmar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .confirm-dialog__title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
    }

    .confirm-dialog__icon {
      color: #1565c0;
    }

    .confirm-dialog__icon--danger {
      color: #d32f2f;
    }

    .confirm-dialog__content {
      min-width: 320px;
      max-width: 460px;
      padding-top: 4px;
    }

    .confirm-dialog__message {
      margin: 0;
      line-height: 1.55;
      color: rgba(0, 0, 0, 0.76);
    }

    .confirm-dialog__actions {
      padding-top: 8px;
      gap: 10px;
    }
  `]
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
