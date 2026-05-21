/**
 * File Purpose: frontend/src/app/pages/main/integrations/integrations.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { NgFor, NgIf } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { GlpiIntegrationComponent } from '../glpi/glpi-integration.component';

@Component({
  selector: 'app-integrations',
  templateUrl: './integrations.component.html',
  styleUrls: ['./integrations.component.scss'],
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatInput,
    MatHint,
    MatCheckbox,
    MatSelect,
    MatOption,
    MatButton,
    NgIf,
    NgFor,
    MatTabsModule,
    GlpiIntegrationComponent
  ]
})
export class IntegrationsComponent implements OnInit, OnDestroy {
  readonly transportOptions = [
    { value: 'udp', label: 'Syslog UDP' },
    { value: 'tcp', label: 'Syslog TCP' },
    { value: 'tls', label: 'Syslog TLS' },
    { value: 'http', label: 'Webhook API (HTTP/HTTPS)' }
  ];

  readonly formatOptions = [
    { value: 'json', label: 'JSON' },
    { value: 'rfc5424', label: 'RFC5424' }
  ];

  readonly levelOptions = [
    { value: 'audit-only', label: 'Solo auditoría' },
    { value: 'info', label: 'Info+' },
    { value: 'warn', label: 'Warn+' },
    { value: 'error', label: 'Error' }
  ];

  integrationForm: FormGroup;
  integrations: any[] = [];
  selectedIntegrationId: string | null = null;
  creatingNew = false;
  loading = false;
  testing = false;
  saving = false;
  deleting = false;
  selectedTabIndex = 0;
  private _querySub?: Subscription;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.integrationForm = this.fb.group({
      name: ['Integración SIEM/SOAR/NDR', Validators.required],
      enabled: [false],
      transport: ['udp', Validators.required],
      host: ['localhost'],
      port: [514, [Validators.required, Validators.min(1), Validators.max(65535)]],
      format: ['json', Validators.required],
      forwardLevel: ['audit-only', Validators.required],
      tlsRejectUnauthorized: [true],
      retryEnabled: [true],
      retryMaxRetries: [3, [Validators.required, Validators.min(0), Validators.max(10)]],
      retryBackoffMs: [1000, [Validators.required, Validators.min(100), Validators.max(60000)]],
      httpUrl: [''],
      httpMethod: ['POST'],
      httpTimeoutMs: [5000, [Validators.required, Validators.min(500), Validators.max(30000)]]
    });

    this.integrationForm.get('transport')?.valueChanges.subscribe((transport) => {
      this.applyTransportValidation(transport);
    });
  }

  ngOnInit(): void {
    this.loadConfigs();
    this._querySub = this.route.queryParams.subscribe((params) => {
      this.selectedTabIndex = params['type'] === 'glpi' ? 1 : 0;
    });
  }

  ngOnDestroy(): void {
    this._querySub?.unsubscribe();
  }

  onTabChange(index: number): void {
    const type = index === 1 ? 'glpi' : null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: type ? { type } : {},
      replaceUrl: true
    });
  }

  get isHttp(): boolean {
    return this.integrationForm.get('transport')?.value === 'http';
  }

  private applyTransportValidation(transport: string): void {
    const hostCtrl = this.integrationForm.get('host');
    const portCtrl = this.integrationForm.get('port');
    const httpUrlCtrl = this.integrationForm.get('httpUrl');

    if (!hostCtrl || !portCtrl || !httpUrlCtrl) {
      return;
    }

    if (transport === 'http') {
      hostCtrl.clearValidators();
      portCtrl.clearValidators();
      httpUrlCtrl.setValidators([Validators.required]);
    } else {
      hostCtrl.setValidators([Validators.required]);
      portCtrl.setValidators([Validators.required, Validators.min(1), Validators.max(65535)]);
      httpUrlCtrl.clearValidators();
    }

    hostCtrl.updateValueAndValidity({ emitEvent: false });
    portCtrl.updateValueAndValidity({ emitEvent: false });
    httpUrlCtrl.updateValueAndValidity({ emitEvent: false });
  }

  get canTestOrDelete(): boolean {
    return !!this.selectedIntegrationId && !this.creatingNew;
  }

  loadConfigs(): void {
    this.loading = true;
    this.http.get<any[]>(`${environment.apiUrl}/logging/configs`).subscribe({
      next: (configs) => {
        this.integrations = Array.isArray(configs) ? configs : [];

        if (this.integrations.length === 0) {
          this.startNewIntegration();
        } else {
          const targetId = this.selectedIntegrationId || this.integrations[0]._id;
          this.selectIntegration(targetId);
        }

        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Error cargando configuración de integraciones', 'Cerrar', { duration: 3000 });
      }
    });
  }

  selectIntegration(integrationId: string): void {
    const config = this.integrations.find((item) => item._id === integrationId);
    if (!config) {
      return;
    }

    this.creatingNew = false;
    this.selectedIntegrationId = config._id;
    this.patchFormFromConfig(config);
  }

  startNewIntegration(): void {
    this.creatingNew = true;
    this.selectedIntegrationId = null;
    this.patchFormFromConfig({
      name: `Integración ${this.integrations.length + 1}`,
      enabled: false,
      transport: 'udp',
      host: 'localhost',
      port: 514,
      format: 'json',
      forwardLevel: 'audit-only',
      tls: { rejectUnauthorized: true },
      retry: { enabled: true, maxRetries: 3, backoffMs: 1000 },
      http: { url: '', method: 'POST', timeoutMs: 5000 }
    });
  }

  private patchFormFromConfig(config: any): void {
    const transport = config.transport || (config.mode === 'plain' ? 'tcp' : 'tls');
    this.integrationForm.patchValue({
      name: config.name || 'Integración SIEM/SOAR/NDR',
      enabled: config.enabled ?? false,
      transport,
      host: config.host || 'localhost',
      port: config.port || 514,
      format: config.format || 'json',
      forwardLevel: config.forwardLevel || 'audit-only',
      tlsRejectUnauthorized: config.tls?.rejectUnauthorized ?? true,
      retryEnabled: config.retry?.enabled ?? true,
      retryMaxRetries: config.retry?.maxRetries ?? 3,
      retryBackoffMs: config.retry?.backoffMs ?? 1000,
      httpUrl: config.http?.url || '',
      httpMethod: config.http?.method || 'POST',
      httpTimeoutMs: config.http?.timeoutMs || 5000
    });
    this.applyTransportValidation(transport);
  }

  saveConfig(): void {
    if (this.integrationForm.invalid) {
      this.integrationForm.markAllAsTouched();
      return;
    }

    const value = this.integrationForm.value;
    const payload = {
      name: (value.name || '').trim() || 'Integración SIEM/SOAR/NDR',
      enabled: value.enabled,
      transport: value.transport,
      mode: value.transport === 'tcp' ? 'plain' : 'tls',
      host: value.host,
      port: Number(value.port),
      format: value.format,
      forwardLevel: value.forwardLevel,
      tls: {
        rejectUnauthorized: !!value.tlsRejectUnauthorized
      },
      retry: {
        enabled: !!value.retryEnabled,
        maxRetries: Number(value.retryMaxRetries),
        backoffMs: Number(value.retryBackoffMs)
      },
      http: {
        url: (value.httpUrl || '').trim(),
        method: value.httpMethod || 'POST',
        timeoutMs: Number(value.httpTimeoutMs)
      }
    };

    this.saving = true;
    const request$ = this.creatingNew
      ? this.http.post<any>(`${environment.apiUrl}/logging/configs`, payload)
      : this.http.put<any>(`${environment.apiUrl}/logging/configs/${this.selectedIntegrationId}`, payload);

    request$.subscribe({
      next: () => {
        this.saving = false;
        this.snackBar.open('Integración guardada', 'Cerrar', { duration: 2500 });
        this.loadConfigs();
      },
      error: (err) => {
        this.saving = false;
        const message = err?.error?.error || 'Error guardando integración';
        this.snackBar.open(message, 'Cerrar', { duration: 3500 });
      }
    });
  }

  testConnection(): void {
    if (!this.selectedIntegrationId || this.creatingNew) {
      this.snackBar.open('Guarda la integración antes de probar conexión', 'Cerrar', { duration: 3000 });
      return;
    }

    this.testing = true;
    this.http.post<any>(`${environment.apiUrl}/logging/configs/${this.selectedIntegrationId}/test`, {}).subscribe({
      next: (response) => {
        this.testing = false;
        this.snackBar.open(response?.message || 'Prueba de conexión OK', 'Cerrar', { duration: 3000 });
        this.loadConfigs();
      },
      error: (err) => {
        this.testing = false;
        this.snackBar.open(err?.error?.error || 'Prueba de conexión fallida', 'Cerrar', { duration: 4000 });
      }
    });
  }

  deleteIntegration(): void {
    if (!this.selectedIntegrationId || this.creatingNew) {
      return;
    }

    this.deleting = true;
    this.http.delete<any>(`${environment.apiUrl}/logging/configs/${this.selectedIntegrationId}`).subscribe({
      next: () => {
        this.deleting = false;
        this.snackBar.open('Integración eliminada', 'Cerrar', { duration: 2500 });
        this.loadConfigs();
      },
      error: (err) => {
        this.deleting = false;
        this.snackBar.open(err?.error?.error || 'Error eliminando integración', 'Cerrar', { duration: 3500 });
      }
    });
  }
}
