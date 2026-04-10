import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ClientAlertChannel } from '../../../models/escalation.model';

export interface ClientAlertDialogData {
  clientName: string;
  contextLabel: string;
  message: string;
  channels: ClientAlertChannel[];
  timezone: string;
  localDate: string;
  localTime: string;
  /** ESC-MAINT-042: true = mantenimiento bloqueante, oculta "Más tarde" */
  blocking?: boolean;
  maintenanceTitle?: string;
}

@Component({
  selector: 'app-client-alert-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title [class.maintenance-title]="data.blocking">
      <mat-icon [color]="data.blocking ? '' : 'warn'">
        {{ data.blocking ? 'engineering' : 'warning' }}
      </mat-icon>
      {{ data.blocking ? 'Mantenimiento programado activo' : 'Alerta especial de escalamiento' }}
    </h2>

    <mat-dialog-content>
      <p class="meta">
        <strong>Cliente:</strong> {{ data.clientName }}
      </p>
      <p class="meta" *ngIf="data.maintenanceTitle">
        <strong>Mantenimiento:</strong> {{ data.maintenanceTitle }}
      </p>
      <p class="meta">
        <strong>Contexto:</strong> {{ data.contextLabel }} |
        <strong>Zona horaria:</strong> {{ data.timezone }}
      </p>
      <p class="meta">
        <strong>Hora evaluada:</strong> {{ data.localDate }} {{ data.localTime }}
      </p>

      <div class="alert-box" [class.maintenance-box]="data.blocking">
        {{ data.message }}
      </div>

      <p class="blocking-notice" *ngIf="data.blocking">
        <mat-icon>lock</mat-icon>
        Debes confirmar lectura para continuar. No es posible generar reportes durante un mantenimiento bloqueante.
      </p>

      <div class="channels" *ngIf="data.channels.length > 0">
        <h3>Canales / destinatarios sugeridos</h3>
        <ul>
          <li *ngFor="let channel of data.channels">
            <strong>{{ channel.type }}:</strong>
            {{ channel.target || 'sin destino' }}
            <span *ngIf="channel.notes">({{ channel.notes }})</span>
          </li>
        </ul>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button *ngIf="!data.blocking" (click)="close(false)">
        Más tarde
      </button>
      <button mat-raised-button [color]="data.blocking ? 'primary' : 'warn'" (click)="close(true)">
        <mat-icon>{{ data.blocking ? 'check_circle' : 'fact_check' }}</mat-icon>
        Confirmar lectura
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      color: var(--text-primary);
    }

    [mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-primary);
    }

    [mat-dialog-title].maintenance-title mat-icon {
      color: #e65100;
    }

    mat-dialog-content {
      color: var(--text-primary);
    }

    .meta {
      margin: 4px 0;
      color: var(--text-secondary);
    }

    .alert-box {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--state-warning);
      border-left: 4px solid var(--state-warning);
      border-radius: 6px;
      background: var(--state-warning-bg);
      white-space: pre-wrap;
      font-weight: 600;
      color: var(--state-warning);
    }

    .alert-box.maintenance-box {
      border-color: #e65100;
      background: rgba(230, 81, 0, 0.07);
      color: #e65100;
    }

    .blocking-notice {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      padding: 8px 12px;
      background: rgba(230, 81, 0, 0.06);
      border-radius: 6px;
      font-size: 13px;
      color: #b84d00;
    }

    .blocking-notice mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .channels {
      margin-top: 16px;
      color: var(--text-primary);
    }

    .channels h3 {
      margin: 0 0 8px;
      font-size: 14px;
      color: var(--text-primary);
    }

    .channels ul {
      margin: 0;
      padding-left: 18px;
    }

    .channels li {
      margin-bottom: 4px;
      color: var(--text-secondary);
    }
  `]
})
export class ClientAlertDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ClientAlertDialogData,
    private readonly dialogRef: MatDialogRef<ClientAlertDialogComponent, boolean>
  ) {}

  close(acknowledged: boolean): void {
    this.dialogRef.close(acknowledged);
  }
}
