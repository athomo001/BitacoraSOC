/**
 * File Purpose: frontend/src/app/pages/main/glpi/glpi-integration.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-glpi-integration',
  templateUrl: './glpi-integration.component.html',
  styleUrls: ['./glpi-integration.component.scss'],
  imports: [
    ReactiveFormsModule,
    NgIf,
    NgFor,
    DatePipe,
    MatFormField,
    MatLabel,
    MatInput,
    MatHint,
    MatCheckbox,
    MatSelect,
    MatOption,
    MatButton
  ]
})
export class GlpiIntegrationComponent implements OnInit {
  readonly modeOptions = [
    { value: 'api', label: 'API REST GLPI' },
    { value: 'email', label: 'Correo (collector)' }
  ];

  readonly dispatchOptions = [
    { value: 'daily-summary', label: 'Resumen diario' },
    { value: 'immediate', label: 'Evento inmediato' }
  ];

  form: FormGroup;
  loading = false;
  saving = false;
  testing = false;
  apiTokensConfigured = false;
  lastTestDate: string | null = null;
  lastTestMessage = '';
  lastTestSuccess: boolean | null = null;
  lastDispatchDate: string | null = null;
  lastDispatchMessage = '';
  lastDispatchSuccess: boolean | null = null;
  lastDispatchMode = 'unknown';
  lastDispatchEvent = '';
  lastDispatchChannel = 'none';
  lastGlpiError: { code: string; probableCause: string; suggestedAction: string; rawMessage?: string } | null = null;
  glpiRetryCount = 0;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {
    this.form = this.fb.group({
      enabled: [false],
      mode: ['api', Validators.required],
      dispatchMode: ['daily-summary', Validators.required],
      apiBaseUrl: [''],
      apiAppToken: [''],
      apiUserToken: [''],
      apiVerifyTls: [true],
      apiTimeoutMs: [8000, [Validators.required, Validators.min(1000), Validators.max(30000)]],
      emailCollectorAddress: [''],
      emailSubjectTemplate: ['[SOC] Cierre de turno {{date}}']
    });

    this.form.get('mode')?.valueChanges.subscribe((mode) => {
      this.applyModeValidation(mode);
    });
  }

  ngOnInit(): void {
    this.loadConfig();
  }

  get isApiMode(): boolean {
    return this.form.get('mode')?.value === 'api';
  }

  private applyModeValidation(mode: string): void {
    const apiBaseUrlCtrl = this.form.get('apiBaseUrl');
    const emailCollectorCtrl = this.form.get('emailCollectorAddress');

    if (!apiBaseUrlCtrl || !emailCollectorCtrl) {
      return;
    }

    if (mode === 'api') {
      apiBaseUrlCtrl.setValidators([Validators.required]);
      emailCollectorCtrl.clearValidators();
    } else {
      apiBaseUrlCtrl.clearValidators();
      emailCollectorCtrl.setValidators([Validators.required, Validators.email]);
    }

    apiBaseUrlCtrl.updateValueAndValidity({ emitEvent: false });
    emailCollectorCtrl.updateValueAndValidity({ emitEvent: false });
  }

  loadConfig(): void {
    this.loading = true;
    this.http.get<any>(`${environment.apiUrl}/integrations/glpi`).subscribe({
      next: (config) => {
        this.form.patchValue({
          enabled: config.enabled ?? false,
          mode: config.mode || 'api',
          dispatchMode: config.dispatchMode || 'daily-summary',
          apiBaseUrl: config.api?.baseUrl || '',
          apiAppToken: '',
          apiUserToken: '',
          apiVerifyTls: config.api?.verifyTls ?? true,
          apiTimeoutMs: config.api?.timeoutMs || 8000,
          emailCollectorAddress: config.email?.collectorAddress || '',
          emailSubjectTemplate: config.email?.subjectTemplate || '[SOC] Cierre de turno {{date}}'
        });

        this.apiTokensConfigured = Boolean(config.api?.appTokenConfigured) && Boolean(config.api?.userTokenConfigured);
        this.lastTestDate = config.lastTestDate || null;
        this.lastTestMessage = config.lastTestMessage || '';
        this.lastTestSuccess = config.lastTestSuccess ?? null;
        this.lastDispatchDate = config.lastDispatchDate || null;
        this.lastDispatchMessage = config.lastDispatchMessage || '';
        this.lastDispatchSuccess = config.lastDispatchSuccess ?? null;
        this.lastDispatchMode = config.lastDispatchMode || 'unknown';
        this.lastDispatchEvent = config.lastDispatchEvent || '';
        this.lastDispatchChannel = config.lastDispatchChannel || 'none';
        this.applyModeValidation(config.mode || 'api');
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Error cargando configuración GLPI', 'Cerrar', { duration: 3500 });
      }
    });
  }

  saveConfig(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.value;
    const apiAppToken = (value.apiAppToken || '').trim();
    const apiUserToken = (value.apiUserToken || '').trim();

    if (value.mode === 'api' && !this.apiTokensConfigured && (!apiAppToken || !apiUserToken)) {
      this.snackBar.open('Para guardar en modo API debes ingresar App-Token y User Token', 'Cerrar', { duration: 4000 });
      return;
    }

    const payload: any = {
      enabled: !!value.enabled,
      mode: value.mode,
      dispatchMode: value.dispatchMode,
      api: {
        baseUrl: (value.apiBaseUrl || '').trim(),
        verifyTls: !!value.apiVerifyTls,
        timeoutMs: Number(value.apiTimeoutMs)
      },
      email: {
        collectorAddress: (value.emailCollectorAddress || '').trim(),
        subjectTemplate: (value.emailSubjectTemplate || '').trim()
      }
    };

    if (apiAppToken) {
      payload.api.appToken = apiAppToken;
    }
    if (apiUserToken) {
      payload.api.userToken = apiUserToken;
    }

    this.saving = true;
    this.http.put<any>(`${environment.apiUrl}/integrations/glpi`, payload).subscribe({
      next: () => {
        this.saving = false;
        this.snackBar.open('Configuración GLPI guardada', 'Cerrar', { duration: 2500 });
        this.loadConfig();
      },
      error: (err) => {
        this.saving = false;
        const message = err?.error?.error || err?.error?.message || 'Error guardando configuración GLPI';
        this.snackBar.open(message, 'Cerrar', { duration: 4000 });
      }
    });
  }

  testConnection(): void {
    this.runConnectionTest(false);
  }

  private runConnectionTest(isRetry: boolean): void {
    if (!this.form.value.enabled) {
      this.snackBar.open('Habilita GLPI antes de probar conexión', 'Cerrar', { duration: 3000 });
      return;
    }

    if (isRetry) {
      this.glpiRetryCount += 1;
    } else {
      this.glpiRetryCount = 0;
    }

    const payload = isRetry
      ? { retryAttempt: true, retryCount: this.glpiRetryCount }
      : {};

    this.testing = true;
    this.http.post<any>(`${environment.apiUrl}/integrations/glpi/test`, payload).subscribe({
      next: (response) => {
        this.testing = false;
        this.lastGlpiError = null;
        this.glpiRetryCount = 0;
        this.snackBar.open(response?.message || 'Prueba GLPI OK', 'Cerrar', { duration: 3000 });
        this.loadConfig();
      },
      error: (err) => {
        this.testing = false;
        this.lastGlpiError = this.buildGlpiDiagnostic(err);
        const message = err?.error?.error || err?.error?.message || 'Prueba GLPI fallida';
        this.snackBar.open(
          `${message}. ${this.lastGlpiError.suggestedAction}`,
          'Cerrar',
          { duration: 6500 }
        );
        this.loadConfig();
      }
    });
  }

  retryGlpiTest(): void {
    this.runConnectionTest(true);
  }

  private buildGlpiDiagnostic(err: any): { code: string; probableCause: string; suggestedAction: string; rawMessage?: string } {
    const rawMessage = String(err?.error?.error || err?.error?.message || err?.message || 'error desconocido');
    const lowered = rawMessage.toLowerCase();

    if (lowered.includes('401') || lowered.includes('403') || lowered.includes('token') || lowered.includes('auth')) {
      return {
        code: 'GLPI_AUTH',
        probableCause: 'App-Token/User Token inválidos o sin permisos',
        suggestedAction: 'Verifica tokens GLPI y vuelve a probar.',
        rawMessage
      };
    }
    if (lowered.includes('timeout') || lowered.includes('etimedout')) {
      return {
        code: 'GLPI_TIMEOUT',
        probableCause: 'Timeout al conectar con GLPI',
        suggestedAction: 'Revisa conectividad o incrementa timeout.',
        rawMessage
      };
    }
    if (lowered.includes('certificate') || lowered.includes('self signed') || lowered.includes('tls')) {
      return {
        code: 'GLPI_TLS',
        probableCause: 'Problema TLS/certificado con GLPI',
        suggestedAction: 'Revisa verificación TLS y certificados.',
        rawMessage
      };
    }
    if (lowered.includes('enotfound') || lowered.includes('econnrefused') || lowered.includes('invalid url')) {
      return {
        code: 'GLPI_ENDPOINT',
        probableCause: 'URL base GLPI inválida o no alcanzable',
        suggestedAction: 'Confirma la URL y acceso desde backend.',
        rawMessage
      };
    }

    return {
      code: 'GLPI_UNKNOWN',
      probableCause: 'Fallo no categorizado en integración GLPI',
      suggestedAction: 'Reintenta y revisa auditoría de integraciones.',
      rawMessage
    };
  }
}
