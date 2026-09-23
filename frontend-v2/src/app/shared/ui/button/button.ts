import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { NgTemplateOutlet } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'critical' | 'text';

/**
 * Envoltorio de Angular Material sobre botones (spec/06-frontend-arquitectura-y-ui.md
 * sección 7: "Angular Material como base, nunca crudo en componentes de
 * feature"). Ningún feature importa MatButtonModule directo — todos pasan
 * por acá, así que un cambio de variante/tokens se hace en un solo lugar.
 * Área de clic mínima 36px de altura (Ley de Fitts, sección 2.2).
 */
@Component({
  selector: 'app-button',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      Proyección única: Angular proyecta el contenido en UNA sola ranura
      <ng-content>; con una por rama del @switch, solo la última (default)
      recibía el texto y primary/critical/text quedaban con el ícono solo
      (bug real de la Fase 3, encontrado en la Fase 5 con navegador real).
    -->
    <ng-template #label><ng-content /></ng-template>
    @switch (variant()) {
      @case ('primary') {
        <button
          type="button"
          mat-flat-button
          class="app-button app-button--primary"
          [disabled]="disabled()"
          (click)="pressed.emit()"
        >
          @if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <ng-container [ngTemplateOutlet]="label" />
        </button>
      }
      @case ('critical') {
        <button
          type="button"
          mat-flat-button
          class="app-button app-button--critical"
          [disabled]="disabled()"
          (click)="pressed.emit()"
        >
          @if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <ng-container [ngTemplateOutlet]="label" />
        </button>
      }
      @case ('text') {
        <button
          type="button"
          mat-button
          class="app-button app-button--text"
          [disabled]="disabled()"
          (click)="pressed.emit()"
        >
          @if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <ng-container [ngTemplateOutlet]="label" />
        </button>
      }
      @default {
        <button
          type="button"
          mat-stroked-button
          class="app-button app-button--secondary"
          [disabled]="disabled()"
          (click)="pressed.emit()"
        >
          @if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <ng-container [ngTemplateOutlet]="label" />
        </button>
      }
    }
  `,
  styleUrl: './button.css',
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly icon = input<string | undefined>(undefined);
  readonly disabled = input(false);
  readonly pressed = output<void>();
}
