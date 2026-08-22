/**
 * File Purpose: frontend/src/app/pages/main/glpi/glpi-integration.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { environment } from '../../../../environments/environment';
import { CatalogService } from '../../../services/catalog.service';
import { UserService } from '../../../services/user.service';

interface GlpiEntity {
  id: number;
  name: string;
}

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
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip
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

  readonly entryTypeOptions = [
    { value: 'operativa', label: 'Operativa' },
    { value: 'incidente', label: 'Incidente' }
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

  // Importación entrante (GLPI -> Bitácora)
  glpiEntities: GlpiEntity[] = [];
  loadingEntities = false;
  logSources: any[] = [];
  users: any[] = [];
  runningInboundNow = false;
  lastPollAt: string | null = null;
  lastPollSuccess: boolean | null = null;
  lastPollMessage = '';
  lastImportedCount = 0;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private catalogService: CatalogService,
    private userService: UserService
  ) {
    this.form = this.fb.group({
      enabled: [false],
      manualLinkFieldEnabled: [false],
      mode: ['api', Validators.required],
      dispatchMode: ['daily-summary', Validators.required],
      apiBaseUrl: [''],
      apiAppToken: [''],
      apiUserToken: [''],
      apiVerifyTls: [true],
      apiTimeoutMs: [8000, [Validators.required, Validators.min(1000), Validators.max(30000)]],
      emailCollectorAddress: [''],
      emailSubjectTemplate: ['[SOC] Cierre de turno {{date}}'],
      inboundEnabled: [false],
      inboundPollingIntervalMinutes: [5, [Validators.required, Validators.min(1), Validators.max(1440)]],
      inboundImportUserId: [''],
      entityMappings: this.fb.array([])
    });

    this.form.get('mode')?.valueChanges.subscribe(() => {
      this.applyModeValidation();
    });
    this.form.get('enabled')?.valueChanges.subscribe(() => {
      this.applyModeValidation();
    });
  }

  get entityMappingsArray(): FormArray {
    return this.form.get('entityMappings') as FormArray;
  }

  ngOnInit(): void {
    this.loadConfig();
    this.catalogService.getAllLogSources().subscribe({
      next: (response: any) => {
        this.logSources = response.items || response || [];
      },
      error: () => {
        // Error silencioso: el selector de cliente queda vacío
      }
    });
    this.userService.getUsersList().subscribe({
      next: (users) => {
        this.users = users || [];
      },
      error: () => {
        // Error silencioso: el selector de usuario importador queda vacío
      }
    });
  }

  get isApiMode(): boolean {
    return this.form.get('mode')?.value === 'api';
  }

  // Los campos de conexión (Base URL / correo collector) solo son obligatorios cuando
  // "Habilitar GLPI" está activo — así se puede guardar el resto de la configuración
  // (p. ej. el toggle del campo manual de ticket) sin forzar a completar la conexión.
  private applyModeValidation(): void {
    const apiBaseUrlCtrl = this.form.get('apiBaseUrl');
    const emailCollectorCtrl = this.form.get('emailCollectorAddress');
    const enabled = !!this.form.get('enabled')?.value;
    const mode = this.form.get('mode')?.value;

    if (!apiBaseUrlCtrl || !emailCollectorCtrl) {
      return;
    }

    if (enabled && mode === 'api') {
      apiBaseUrlCtrl.setValidators([Validators.required]);
      emailCollectorCtrl.clearValidators();
    } else if (enabled) {
      apiBaseUrlCtrl.clearValidators();
      emailCollectorCtrl.setValidators([Validators.required, Validators.email]);
    } else {
      apiBaseUrlCtrl.clearValidators();
      emailCollectorCtrl.clearValidators();
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
          manualLinkFieldEnabled: config.manualLinkFieldEnabled ?? false,
          mode: config.mode || 'api',
          dispatchMode: config.dispatchMode || 'daily-summary',
          apiBaseUrl: config.api?.baseUrl || '',
          apiAppToken: '',
          apiUserToken: '',
          apiVerifyTls: config.api?.verifyTls ?? true,
          apiTimeoutMs: config.api?.timeoutMs || 8000,
          emailCollectorAddress: config.email?.collectorAddress || '',
          emailSubjectTemplate: config.email?.subjectTemplate || '[SOC] Cierre de turno {{date}}',
          inboundEnabled: config.inbound?.enabled ?? false,
          inboundPollingIntervalMinutes: config.inbound?.pollingIntervalMinutes || 5,
          inboundImportUserId: config.inbound?.importUserId || ''
        });

        this.entityMappingsArray.clear();
        (config.entityMappings || []).forEach((mapping: any) => {
          this.entityMappingsArray.push(this.buildMappingGroup(mapping));
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
        this.lastPollAt = config.inbound?.lastPollAt || null;
        this.lastPollSuccess = config.inbound?.lastPollSuccess ?? null;
        this.lastPollMessage = config.inbound?.lastPollMessage || '';
        this.lastImportedCount = config.inbound?.lastImportedCount || 0;
        this.applyModeValidation();
        this.loading = false;

        // Precarga la lista de entidades para que el mapeo muestre nombres en vez de IDs
        // crudos sin que el admin tenga que apretar "Cargar entidades" en cada visita.
        if (config.enabled && config.mode === 'api' && config.api?.appTokenConfigured && config.api?.userTokenConfigured) {
          this.loadGlpiEntities({ silent: true });
        }
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Error cargando configuración GLPI', 'Cerrar', { duration: 3500 });
      }
    });
  }

  private buildMappingGroup(mapping: any = {}): FormGroup {
    return this.fb.group({
      _id: [mapping._id || null],
      entitiesId: [mapping.entitiesId ?? null, [Validators.required]],
      label: [mapping.label || ''],
      clientId: [mapping.clientId || '', [Validators.required]],
      defaultEntryType: [mapping.defaultEntryType || 'operativa', [Validators.required]],
      enabled: [mapping.enabled ?? true]
    });
  }

  addMappingRow(): void {
    this.entityMappingsArray.push(this.buildMappingGroup());
  }

  removeMappingRow(index: number): void {
    this.entityMappingsArray.removeAt(index);
  }

  loadGlpiEntities(options: { silent?: boolean } = {}): void {
    this.loadingEntities = true;
    this.http.get<{ entities: GlpiEntity[] }>(`${environment.apiUrl}/integrations/glpi/entities`).subscribe({
      next: (response) => {
        this.glpiEntities = response.entities || [];
        this.loadingEntities = false;
        if (this.glpiEntities.length === 0 && !options.silent) {
          this.snackBar.open('GLPI no devolvió entidades', 'Cerrar', { duration: 3000 });
        }
      },
      error: (err) => {
        this.loadingEntities = false;
        if (!options.silent) {
          const msg = err?.error?.message || 'Error obteniendo entidades desde GLPI';
          this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
        }
      }
    });
  }

  onEntitySelected(index: number, entityId: number): void {
    const entity = this.glpiEntities.find((item) => item.id === Number(entityId));
    const group = this.entityMappingsArray.at(index);
    group.patchValue({
      entitiesId: entity ? entity.id : entityId,
      label: entity ? entity.name : group.get('label')?.value || ''
    });
  }

  runInboundNow(): void {
    this.runningInboundNow = true;
    this.http.post<any>(`${environment.apiUrl}/integrations/glpi/inbound/run-now`, {}).subscribe({
      next: (response) => {
        this.runningInboundNow = false;
        this.snackBar.open(response?.message || 'Importación GLPI ejecutada', 'Cerrar', { duration: 3500 });
        this.loadConfig();
      },
      error: (err) => {
        this.runningInboundNow = false;
        const msg = err?.error?.message || 'Error ejecutando importación GLPI';
        this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
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

    if (value.enabled && value.mode === 'api' && !this.apiTokensConfigured && (!apiAppToken || !apiUserToken)) {
      this.snackBar.open('Para guardar en modo API debes ingresar App-Token y User Token', 'Cerrar', { duration: 4000 });
      return;
    }

    if (value.inboundEnabled) {
      if (value.mode !== 'api') {
        this.snackBar.open('La importación entrante requiere el modo "API REST GLPI"', 'Cerrar', { duration: 4000 });
        return;
      }
      if (!value.inboundImportUserId) {
        this.snackBar.open('Selecciona un usuario para registrar las entradas importadas', 'Cerrar', { duration: 4000 });
        return;
      }
      const hasEnabledMapping = (value.entityMappings || []).some((mapping: any) => mapping.enabled && mapping.clientId);
      if (!hasEnabledMapping) {
        this.snackBar.open('Agrega al menos un mapeo de entidad habilitado y con cliente asignado', 'Cerrar', { duration: 4500 });
        return;
      }
    }

    const payload: any = {
      enabled: !!value.enabled,
      manualLinkFieldEnabled: !!value.manualLinkFieldEnabled,
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
      },
      entityMappings: (value.entityMappings || []).map((mapping: any) => ({
        _id: mapping._id || undefined,
        entitiesId: Number(mapping.entitiesId),
        label: (mapping.label || '').trim(),
        clientId: mapping.clientId || null,
        defaultEntryType: mapping.defaultEntryType || 'operativa',
        enabled: !!mapping.enabled
      })),
      inbound: {
        enabled: !!value.inboundEnabled,
        pollingIntervalMinutes: Number(value.inboundPollingIntervalMinutes),
        importUserId: value.inboundImportUserId || null
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
