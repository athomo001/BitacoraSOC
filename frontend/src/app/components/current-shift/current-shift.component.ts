/**
 * File Purpose: frontend/src/app/components/current-shift/current-shift.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { WorkShiftService } from '../../../services/work-shift.service';
import { WorkShift, CurrentShiftResponse } from '../../../models/work-shift.model';

/**
 * Componente para mostrar el turno actual
 * Visible para todos los usuarios (admin, user, guest)
 */
@Component({
  selector: 'app-current-shift',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule
  ],
  template: `
    <section class="current-shift-card current-shift-panel">
      <header class="current-shift-panel__header">
        <h2 class="current-shift-panel__title">
          <mat-icon>schedule</mat-icon>
          Turno Actual
        </h2>
      </header>
      <div class="current-shift-panel__body">
        <div *ngIf="loading" class="loading">
          <mat-spinner diameter="40"></mat-spinner>
        </div>

        <div *ngIf="!loading && currentShift" class="shift-info">
          <div class="shift-header">
            <h2 [style.color]="currentShift.color || '#1976d2'">
              {{ currentShift.name }}
            </h2>
            <mat-chip [class]="getTypeBadgeClass(currentShift.type)">
              {{ getTypeLabel(currentShift.type) }}
            </mat-chip>
          </div>

          <div class="shift-details">
            <div class="detail-item">
              <mat-icon>access_time</mat-icon>
              <span>{{ formatTimeRange(currentShift) }}</span>
            </div>

            <div class="detail-item" *ngIf="currentShift.assignedUserId">
              <mat-icon>person</mat-icon>
              <span>{{ currentShift.assignedUserName || 'Usuario asignado' }}</span>
            </div>

            <div class="detail-item" *ngIf="!currentShift.assignedUserId">
              <mat-icon>person_off</mat-icon>
              <span class="unassigned">Sin usuario asignado</span>
            </div>

            <div class="detail-item" *ngIf="currentShift.description">
              <mat-icon>info</mat-icon>
              <span>{{ currentShift.description }}</span>
            </div>
          </div>

          <div class="current-time">
            <mat-icon>watch_later</mat-icon>
            Hora actual: <strong>{{ currentTime }}</strong>
          </div>
        </div>

        <div *ngIf="!loading && !currentShift" class="no-shift">
          <mat-icon>info</mat-icon>
          <p>{{ errorMessage || 'No hay turnos configurados' }}</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .current-shift-card {
      max-width: 600px;
      margin: 20px auto;
    }

    .current-shift-panel {
      background: var(--surface-card);
      border: 1px solid var(--outline-subtle);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .current-shift-panel__header {
      padding: var(--space-4);
      border-bottom: 1px solid var(--outline-subtle);
    }

    .current-shift-panel__title {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .current-shift-panel__body {
      padding: var(--space-4);
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 40px;
    }

    .shift-info {
      padding: 16px 0;

      .shift-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;

        h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 500;
        }
      }

      .shift-details {
        .detail-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 0;
          border-bottom: 1px solid var(--outline-subtle);

          mat-icon {
            color: var(--text-secondary);
          }

          span {
            font-size: 15px;
          }

          .unassigned {
            color: var(--text-muted, var(--text-secondary));
            font-style: italic;
          }
        }
      }

      .current-time {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 24px;
        padding: 16px;
        background: var(--surface-muted);
        border-radius: var(--radius-md);
        font-size: 15px;

        mat-icon {
          color: var(--primary-color);
        }
      }
    }

    .no-shift {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);

      mat-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        opacity: 0.3;
        margin-bottom: 16px;
      }

      p {
        font-size: 16px;
      }
    }

    mat-chip {
      &.badge-regular {
        background-color: #4caf50 !important;
        color: white !important;
      }

      &.badge-emergency {
        background-color: #f44336 !important;
        color: white !important;
      }
    }
  `]
})
export class CurrentShiftComponent implements OnInit {
  loading = true;
  currentShift: WorkShift | null = null;
  currentTime = '';
  errorMessage = '';

  constructor(private workShiftService: WorkShiftService) {}

  ngOnInit(): void {
    this.loadCurrentShift();
    
    // Actualizar cada minuto
    setInterval(() => {
      this.loadCurrentShift();
    }, 60000);
  }

  loadCurrentShift(): void {
    this.loading = true;
    this.workShiftService.getCurrentShift().subscribe({
      next: (response: CurrentShiftResponse) => {
        this.currentShift = response.shift;
        this.currentTime = response.currentTime;
        this.errorMessage = response.message || '';
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading current shift:', error);
        this.errorMessage = 'Error al cargar turno actual';
        this.loading = false;
      }
    });
  }

  getTypeLabel(type: string): string {
    return type === 'regular' ? 'Regular' : 'Emergencia';
  }

  getTypeBadgeClass(type: string): string {
    return type === 'regular' ? 'badge-regular' : 'badge-emergency';
  }

  formatTimeRange(shift: WorkShift): string {
    return this.workShiftService.formatTimeRange(shift.startTime, shift.endTime);
  }
}
