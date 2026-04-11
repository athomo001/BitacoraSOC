import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigService } from '../../../services/config.service';

@Component({
  selector: 'app-admin-appearance',
  templateUrl: './admin-appearance.component.html',
  styleUrls: ['./admin-appearance.component.scss'],
  imports: [
    NgIf,
    FormsModule,
    MatRadioModule,
    MatButton,
    MatProgressSpinner
  ]
})
export class AdminAppearanceComponent implements OnInit {
  loginTheme: 'crt' | 'infoflow' = 'crt';
  isSaving = false;

  constructor(
    private configService: ConfigService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadConfig();
  }

  loadConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.loginTheme = config.loginTheme || 'crt';
      },
      error: () => {
        this.snackBar.open('Error cargando configuración de apariencia', 'Cerrar', { duration: 3000 });
      }
    });
  }

  save(): void {
    this.isSaving = true;
    this.configService.updateConfig({ loginTheme: this.loginTheme }).subscribe({
      next: () => {
        this.isSaving = false;
        this.snackBar.open('Tema de login actualizado correctamente', 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.isSaving = false;
        this.snackBar.open(err?.error?.message || 'Error guardando tema de login', 'Cerrar', { duration: 4000 });
      }
    });
  }
}
