import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
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
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
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
    this.http.get<any>(`${environment.apiUrl}/glpi/config`).subscribe({
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
    this.http.put<any>(`${environment.apiUrl}/glpi/config`, payload).subscribe({
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
    if (!this.form.value.enabled) {
      this.snackBar.open('Habilita GLPI antes de probar conexión', 'Cerrar', { duration: 3000 });
      return;
    }

    this.testing = true;
    this.http.post<any>(`${environment.apiUrl}/glpi/test`, {}).subscribe({
      next: (response) => {
        this.testing = false;
        this.snackBar.open(response?.message || 'Prueba GLPI OK', 'Cerrar', { duration: 3000 });
        this.loadConfig();
      },
      error: (err) => {
        this.testing = false;
        const message = err?.error?.error || err?.error?.message || 'Prueba GLPI fallida';
        this.snackBar.open(message, 'Cerrar', { duration: 4500 });
        this.loadConfig();
      }
    });
  }
}
