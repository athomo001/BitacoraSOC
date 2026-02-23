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
    <h2 mat-dialog-title>
      <mat-icon color="warn">warning</mat-icon>
      Alerta especial de escalamiento
    </h2>

    <mat-dialog-content>
      <p class="meta">
        <strong>Cliente:</strong> {{ data.clientName }}
      </p>
      <p class="meta">
        <strong>Contexto:</strong> {{ data.contextLabel }} |
        <strong>Zona horaria:</strong> {{ data.timezone }}
      </p>
      <p class="meta">
        <strong>Hora evaluada:</strong> {{ data.localDate }} {{ data.localTime }}
      </p>

      <div class="alert-box">
        {{ data.message }}
      </div>

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
      <button mat-stroked-button (click)="close(false)">
        Más tarde
      </button>
      <button mat-raised-button color="warn" (click)="close(true)">
        Confirmar lectura
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .meta {
      margin: 4px 0;
      color: rgba(0, 0, 0, 0.77);
    }

    .alert-box {
      margin-top: 12px;
      padding: 12px;
      border-left: 4px solid #d32f2f;
      background: #fff3f3;
      white-space: pre-wrap;
      font-weight: 600;
      color: #8b1f1f;
    }

    .channels {
      margin-top: 16px;
    }

    .channels h3 {
      margin: 0 0 8px;
      font-size: 14px;
    }

    .channels ul {
      margin: 0;
      padding-left: 18px;
    }

    .channels li {
      margin-bottom: 4px;
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
