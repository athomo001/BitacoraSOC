/**
 * File Purpose: frontend/src/app/pages/main/admin-security/admin-security.component.ts
 * Responsibilities: Definir el comportamiento del módulo de seguridad y mantener contratos claros.
 * QA Notes: Mantener reglas explícitas de negocio, validar casos de borde y preservar trazabilidad.
 */

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { NgIf } from '@angular/common';
import { ConfigService } from '../../../services/config.service';
import { SecurityConfig, UpdateConfigRequest } from '../../../models/config.model';

@Component({
  selector: 'app-admin-security',
  templateUrl: './admin-security.component.html',
  styleUrls: ['./admin-security.component.scss'],
  imports: [
    ReactiveFormsModule,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatInput,
    MatButton,
    MatHint,
    MatProgressSpinner,
    MatIcon,
    NgIf
  ]
})
export class AdminSecurityComponent implements OnInit {
  // Formulario para configuración de TLS/Red
  securityForm: FormGroup;
  // Formulario independiente para configuración de SSO
  ssoForm: FormGroup;
  
  isSaving = false;
  isSavingSso = false;
  countdownMessage = '';
  
  certFile: File | null = null;
  keyFile: File | null = null;
  caFile: File | null = null;
  certStatus = '';
  keyStatus = '';
  caStatus = '';
  
  private certUploaded = false;
  private keyUploaded = false;

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

    this.ssoForm = this.fb.group({
      googleSsoEnabled: [false],
      googleClientId: [''],
      microsoftSsoEnabled: [false],
      microsoftClientId: [''],
      microsoftTenantId: ['common']
    });
  }

  ngOnInit(): void {
    this.loadConfig();
  }

  /**
   * Obtiene la configuración global y pobla los formularios correspondientes a HTTPS y SSO.
   */
  loadConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        // Cargar sección de Red / HTTPS
        const security: SecurityConfig = {
          httpsEnabled: config.security?.httpsEnabled ?? false,
          forceHttps: config.security?.forceHttps ?? false,
          httpsPort: config.security?.httpsPort ?? 3443
        };
        this.securityForm.patchValue(security);

        // Cargar sección de Autenticación SSO
        this.ssoForm.patchValue({
          googleSsoEnabled: config.googleSsoEnabled || false,
          googleClientId: config.googleClientId || '',
          microsoftSsoEnabled: config.microsoftSsoEnabled || false,
          microsoftClientId: config.microsoftClientId || '',
          microsoftTenantId: config.microsoftTenantId || 'common'
        });

        // Configurar estado de carga de certificados
        this.certStatus = config.security?.certFileName ? `Certificado cargado: ${config.security.certFileName}` : 'Sin certificado cargado';
        this.keyStatus = config.security?.keyFileName ? `Llave cargada: ${config.security.keyFileName}` : 'Sin llave cargada';
        this.caStatus = config.security?.caFileName ? `CA cargada: ${config.security.caFileName}` : 'Sin CA cargada';
        this.certUploaded = !!config.security?.certUploaded;
        this.keyUploaded = !!config.security?.keyUploaded;
      },
      error: () => {
        this.snackBar.open('Error cargando configuración de seguridad', 'Cerrar', { duration: 3000 });
      }
    });
  }

  /**
   * Guarda los parámetros de Red / HTTPS e inicia la cuenta regresiva para reconexión.
   */
  save(): void {
    if (this.securityForm.invalid) {
      this.securityForm.markAllAsTouched();
      return;
    }

    const enableHttps = !!this.securityForm.value.httpsEnabled;
    if (enableHttps && (!this.certUploaded || !this.keyUploaded)) {
      const hasPendingFiles = !!this.certFile || !!this.keyFile;
      const message = hasPendingFiles
        ? 'Primero presiona "Subir SSL y Activar" para subir cert + key, luego guarda HTTPS'
        : 'Para habilitar HTTPS primero debes cargar certificado y llave privada';
      this.snackBar.open(message, 'Cerrar', { duration: 5000 });
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
        this.snackBar.open('Configuración de red guardada. Reiniciando frontend...', 'Espere', { duration: 15000 });

        const isHttps = this.securityForm.value.httpsEnabled && this.certUploaded && this.keyUploaded;
        const protocol = isHttps ? 'https' : 'http';
        const port = window.location.port ? `:${window.location.port}` : '';
        this.startCountdownAndRedirect(`${protocol}://${window.location.hostname}${port}/main/admin/security`);
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

  /**
   * Envía los archivos de certificados SSL y activa el listener correspondiente.
   */
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
        this.certFile = null;
        this.keyFile = null;
        this.caFile = null;
        this.certStatus = response.security?.certFileName ? `Certificado cargado: ${response.security.certFileName}` : this.certStatus;
        this.keyStatus = response.security?.keyFileName ? `Llave cargada: ${response.security.keyFileName}` : this.keyStatus;
        this.caStatus = response.security?.caFileName ? `CA cargada: ${response.security.caFileName}` : this.caStatus;
        this.certUploaded = !!response.security?.certUploaded;
        this.keyUploaded = !!response.security?.keyUploaded;
        if (this.certUploaded && this.keyUploaded) {
          this.securityForm.patchValue({ httpsEnabled: true });
        }

        if (response.security?.httpsEnabled) {
          const port = window.location.port ? `:${window.location.port}` : '';
          this.startCountdownAndRedirect(`https://${window.location.hostname}${port}/main/admin/security`);
        } else {
          this.isSaving = false;
          this.snackBar.open('Certificados cargados parcialmente. Falta llave o certificado.', 'Cerrar', { duration: 4000 });
        }
      },
      error: (err) => {
        this.isSaving = false;
        const errorMessage = err?.status === 404
          ? 'Endpoint TLS no disponible en backend'
          : (err?.error?.message || 'Error subiendo certificados TLS');
        this.snackBar.open(errorMessage, 'Cerrar', { duration: 5000 });
      }
    });
  }

  /**
   * Restaura la configuración de red al protocolo HTTP inseguro por defecto.
   */
  resetHttpsConfiguration(): void {
    const word = window.prompt('Escribe RESET en mayúsculas para confirmar que deseas eliminar toda la configuración TLS y volver a HTTP inseguro:');
    if (word !== 'RESET') {
      return;
    }

    this.isSaving = true;
    this.configService.resetTlsCertificates().subscribe({
      next: (response) => {
        this.certFile = null;
        this.keyFile = null;
        this.caFile = null;
        this.certUploaded = false;
        this.keyUploaded = false;
        this.certStatus = 'Sin certificado cargado';
        this.keyStatus = 'Sin llave cargada';
        this.caStatus = 'Sin CA cargada';

        this.securityForm.patchValue({
          httpsEnabled: false,
          forceHttps: false,
          httpsPort: response.security?.httpsPort ?? 3443,
          tlsCertPath: '',
          tlsKeyPath: '',
          tlsCaPath: ''
        });

        this.snackBar.open('Certificados borrados. Reiniciando frontend...', 'Espere', { duration: 15000 });
        const port = window.location.port ? `:${window.location.port}` : '';
        this.startCountdownAndRedirect(`http://${window.location.hostname}${port}/main/admin/security`);
      },
      error: (err) => {
        this.isSaving = false;
        this.snackBar.open(err?.error?.message || 'Error al restablecer HTTPS/TLS', 'Cerrar', { duration: 5000 });
      }
    });
  }

  /**
   * Guarda los datos de Single Sign-On (SSO) de Google y Microsoft de manera independiente.
   */
  saveSso(): void {
    if (this.ssoForm.invalid) {
      this.ssoForm.markAllAsTouched();
      return;
    }

    const payload: UpdateConfigRequest = {
      googleSsoEnabled: !!this.ssoForm.value.googleSsoEnabled,
      googleClientId: this.ssoForm.value.googleClientId || '',
      microsoftSsoEnabled: !!this.ssoForm.value.microsoftSsoEnabled,
      microsoftClientId: this.ssoForm.value.microsoftClientId || '',
      microsoftTenantId: this.ssoForm.value.microsoftTenantId || 'common'
    };

    this.isSavingSso = true;
    this.configService.updateConfig(payload).subscribe({
      next: () => {
        this.isSavingSso = false;
        this.snackBar.open('Configuración SSO guardada correctamente', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isSavingSso = false;
        this.snackBar.open(err?.error?.message || 'Error guardando configuración SSO', 'Cerrar', { duration: 4000 });
      }
    });
  }

  private startCountdownAndRedirect(targetUrl: string, seconds: number = 15): void {
    this.isSaving = true;
    let remaining = seconds;
    this.countdownMessage = `(espere ${remaining}s)`;

    const interval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        this.countdownMessage = `(espere ${remaining}s)`;
      } else {
        this.countdownMessage = `(Recargando...)`;
        clearInterval(interval);
        window.location.href = targetUrl;
      }
    }, 1000);
  }
}
