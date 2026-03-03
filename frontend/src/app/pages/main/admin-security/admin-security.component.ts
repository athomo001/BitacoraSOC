import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { NgIf } from '@angular/common';
import { ConfigService } from '../../../services/config.service';
import { SecurityConfig, UpdateConfigRequest } from '../../../models/config.model';

@Component({
  selector: 'app-admin-security',
  templateUrl: './admin-security.component.html',
  styleUrls: ['./admin-security.component.scss'],
  imports: [
    ReactiveFormsModule,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatInput,
    MatButton,
    MatHint,
    MatProgressSpinner,
    NgIf
  ]
})
export class AdminSecurityComponent implements OnInit {
  securityForm: FormGroup;
  isSaving = false;
  certFile: File | null = null;
  keyFile: File | null = null;
  caFile: File | null = null;
  certStatus = '';
  keyStatus = '';
  caStatus = '';

  constructor(
    private fb: FormBuilder,
    private configService: ConfigService,
    private snackBar: MatSnackBar
  ) {
    this.securityForm = this.fb.group({
      httpsEnabled: [false],
      forceHttps: [false],
      httpsPort: [3443, [Validators.required, Validators.min(1), Validators.max(65535)]],
      tlsCertPath: [''],
      tlsKeyPath: [''],
      tlsCaPath: ['']
    });
  }

  ngOnInit(): void {
    this.loadConfig();
  }

  loadConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        const security: SecurityConfig = {
          httpsEnabled: config.security?.httpsEnabled ?? false,
          forceHttps: config.security?.forceHttps ?? false,
          httpsPort: config.security?.httpsPort
        };

        this.securityForm.patchValue(security);
        this.certStatus = config.security?.certFileName ? `Certificado cargado: ${config.security.certFileName}` : 'Sin certificado cargado';
        this.keyStatus = config.security?.keyFileName ? `Llave cargada: ${config.security.keyFileName}` : 'Sin llave cargada';
        this.caStatus = config.security?.caFileName ? `CA cargada: ${config.security.caFileName}` : 'Sin CA cargada';
      },
      error: () => {
        this.snackBar.open('Error cargando configuración HTTPS', 'Cerrar', { duration: 3000 });
      }
    });
  }

  save(): void {
    if (this.securityForm.invalid) {
      this.securityForm.markAllAsTouched();
      return;
    }

    const payload: UpdateConfigRequest = {
      security: {
        httpsEnabled: !!this.securityForm.value.httpsEnabled,
        forceHttps: !!this.securityForm.value.forceHttps,
        httpsPort: this.securityForm.value.httpsPort ? Number(this.securityForm.value.httpsPort) : undefined
      }
    };

    this.isSaving = true;
    this.configService.updateConfig(payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.snackBar.open('Configuración HTTPS guardada', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isSaving = false;
        this.snackBar.open(err?.error?.message || 'Error guardando configuración HTTPS', 'Cerrar', { duration: 4000 });
      }
    });
  }

  onCertSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.certFile = input.files?.[0] || null;
  }

  onKeySelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.keyFile = input.files?.[0] || null;
  }

  onCaSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.caFile = input.files?.[0] || null;
  }

  uploadCertificates(): void {
    if (!this.certFile && !this.keyFile && !this.caFile) {
      this.snackBar.open('Selecciona al menos un archivo', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isSaving = true;
    this.configService.uploadTlsCertificates({
      cert: this.certFile || undefined,
      key: this.keyFile || undefined,
      ca: this.caFile || undefined
    }).subscribe({
      next: (response) => {
        this.isSaving = false;
        this.certFile = null;
        this.keyFile = null;
        this.caFile = null;
        this.certStatus = response.security?.certFileName ? `Certificado cargado: ${response.security.certFileName}` : this.certStatus;
        this.keyStatus = response.security?.keyFileName ? `Llave cargada: ${response.security.keyFileName}` : this.keyStatus;
        this.caStatus = response.security?.caFileName ? `CA cargada: ${response.security.caFileName}` : this.caStatus;
        this.snackBar.open('Certificados TLS actualizados', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isSaving = false;
        this.snackBar.open(err?.error?.message || 'Error subiendo certificados TLS', 'Cerrar', { duration: 4000 });
      }
    });
  }
}
