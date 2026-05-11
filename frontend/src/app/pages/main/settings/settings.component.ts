/**
 * File Purpose: frontend/src/app/pages/main/settings/settings.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfigService } from '../../../services/config.service';
import { SmtpService } from '../../../services/smtp.service';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { UpdateConfigRequest, EmailReportConfig } from '../../../models/config.model';
import { SmtpConfigRequest, SmtpConfig } from '../../../models/smtp.model';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatHint, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatHint,
    MatSuffix,
    MatInput,
    MatButton,
    MatIconButton,
    NgClass,
    MatSelect,
    NgFor,
    MatOption,
    NgIf,
    MatProgressSpinner,
    MatIcon,
  ]
})
export class SettingsComponent implements OnInit {
  private readonly smtpProviderPresets: Record<string, {
    host: string;
    port: number;
    useTLS: boolean;
    authMethod: 'credentials';
    usernamePlaceholder: string;
    senderHint: string;
  }> = {
    office365: {
      host: 'smtp.office365.com',
      port: 587,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'usuario@empresa.com',
      senderHint: 'Usa la casilla corporativa completa de Microsoft 365.'
    },
    'google-mail': {
      host: 'smtp.gmail.com',
      port: 587,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'usuario@gmail.com',
      senderHint: 'Requiere contraseña de aplicación si usas 2FA.'
    },
    'google-workspace': {
      host: 'smtp.gmail.com',
      port: 587,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'usuario@dominio.com',
      senderHint: 'Usa la cuenta Workspace o relay autorizado del dominio.'
    },
    'aws-ses': {
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 587,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'SMTP username de SES',
      senderHint: 'Ajusta la región SES si tu cuenta no usa us-east-1.'
    },
    mailgun: {
      host: 'smtp.mailgun.org',
      port: 587,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'postmaster@tu-dominio.mailgun.org',
      senderHint: 'La cuenta postmaster y clave SMTP vienen desde Mailgun.'
    },
    'elastic-email': {
      host: 'smtp.elasticemail.com',
      port: 2525,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'correo o usuario SMTP',
      senderHint: 'Elastic Email suele operar bien en 2525 o 587.'
    },
    custom: {
      host: '',
      port: 587,
      useTLS: true,
      authMethod: 'credentials',
      usernamePlaceholder: 'usuario@servidor.local',
      senderHint: 'Configura host, puerto y seguridad según tu relay.'
    }
  };

  @ViewChild('smtpGuideCard') smtpGuideCard?: ElementRef<HTMLElement>;
  appConfigForm: FormGroup;
  smtpForm: FormGroup;
  smtpTestPassed = false;
  hasStoredSmtpConfig = false;
  connectionStatus: 'conectado' | 'desconectado' | 'desactivado' | 'sin-config' = 'sin-config';
  testing = false;
  savingSmtp = false;
  smtpLastError: { code: string; probableCause: string; suggestedAction: string; rawMessage?: string } | null = null;
  smtpGuideVisible = false;
  smtpRetryCount = 0;
  showSmtpPassword = false;

  // ─── Paletas predefinidas para el correo de incidentes ──────────────────────
  readonly INCIDENT_PALETTES = [
    {
      key: 'cdc-verde',
      name: 'CDC Verde',
      description: 'Verde oscuro institucional',
      swatches: ['#173831', '#155F50', '#F8FAE1', '#9BCB93', '#C3382B'],
    },
    {
      key: 'noche-azul',
      name: 'Noche Azul',
      description: 'Azul naval oscuro y profesional',
      swatches: ['#0D1B2A', '#1B3A5C', '#EFF4FB', '#7EB2E0', '#C3382B'],
    },
    {
      key: 'slate-pro',
      name: 'Slate Pro',
      description: 'Gris azulado corporativo',
      swatches: ['#1C2333', '#2E3D56', '#F5F6FA', '#8DA5C4', '#C3382B'],
    },
    {
      key: 'carbon',
      name: 'Carbon',
      description: 'Carbón oscuro minimalista',
      swatches: ['#1A1A1A', '#2D2D2D', '#F7F7F7', '#AAAAAA', '#C3382B'],
    },
    {
      key: 'indigo',
      name: 'Índigo',
      description: 'Púrpura profundo y elegante',
      swatches: ['#1A1240', '#2D2080', '#F4F3FF', '#9B93E0', '#C3382B'],
    },
    {
      key: 'bosque',
      name: 'Bosque',
      description: 'Verde naturaleza suave',
      swatches: ['#1B2A1E', '#2D4A33', '#F2F8F3', '#7DBD85', '#C3382B'],
    },
  ];

  selectedPaletteKey = 'cdc-verde';
  isSavingPalette = false;

  readonly criticidadColors = [
    { label: 'Crítica',     color: '#C0392B' },
    { label: 'Alta',        color: '#E85D04' },
    { label: 'Media',       color: '#E67E22' },
    { label: 'Baja',        color: '#27AE60' },
    { label: 'Informativa', color: '#2980B9' },
  ];

  // ─── Colores configurables (boletín / incidente) ──────────────────────────────
  private static readonly DEFAULT_REPORT_COLOR = '#4CAF50';

  reportColorSelection: Record<'incident' | 'bulletin', boolean> = { incident: false, bulletin: true };
  reportColorMode: 'green' | 'sky' | 'light-red' | 'custom' = 'green';
  selectedCustomReportColor = SettingsComponent.DEFAULT_REPORT_COLOR;
  customReportColorInput   = SettingsComponent.DEFAULT_REPORT_COLOR;
  isSavingReportColor = false;
  readonly customColorPalette: string[] = [
    '#4CAF50', '#2E7D32', '#8BC34A', '#2196F3', '#29B6F6', '#03A9F4',
    '#26A69A', '#009688', '#00BCD4', '#FF9800', '#FFC107', '#FFEB3B',
    '#F06292', '#E57373', '#EF5350', '#BA68C8', '#9C27B0', '#7E57C2',
    '#607D8B', '#78909C', '#795548', '#9E9E9E', '#546E7A', '#3F51B5'
  ];
  private currentEmailReportConfig: EmailReportConfig = {
    enabled: false,
    recipients: [],
    includeChecklist: true,
    includeEntries: true,
    subjectTemplate: 'Reporte SOC [fecha] [turno]',
    reportTableColor: SettingsComponent.DEFAULT_REPORT_COLOR,
    reportTableColorByDocumentType: {
      incident: SettingsComponent.DEFAULT_REPORT_COLOR,
      bulletin: SettingsComponent.DEFAULT_REPORT_COLOR
    }
  };

  providers = [
    { value: 'office365', label: 'Office 365' },
    { value: 'aws-ses', label: 'AWS SES' },
    { value: 'elastic-email', label: 'Elastic Email' },
    { value: 'google-mail', label: 'Google Mail' },
    { value: 'google-workspace', label: 'Google Workspace' },
    { value: 'mailgun', label: 'Mailgun' },
    { value: 'custom', label: 'Custom' }
  ];

  constructor(
    private fb: FormBuilder,
    private configService: ConfigService,
    private smtpService: SmtpService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private onboardingService: OnboardingService
  ) {
    this.appConfigForm = this.fb.group({
      guestEnabled: [false]
    });

    this.smtpForm = this.fb.group({
      provider: ['custom', Validators.required],
      host: ['', Validators.required],
      port: [587, [Validators.required, Validators.min(1)]],
      useTLS: [true, Validators.required],
      username: ['', Validators.required],
      password: ['', [Validators.minLength(8)]],
      senderName: ['', Validators.required],
      useUsernameAsSenderEmail: [true],
      senderEmail: ['', [Validators.required, Validators.email]],
      recipientsText: [''], // Opcional para pruebas, obligatorio para guardar
      sendOnlyIfRed: [false],
      isActive: [true]
    });

    this.setSenderEmailLinkState(true);

    this.smtpForm.get('provider')?.valueChanges.subscribe((provider) => {
      this.applyProviderPreset(provider);
    });

    this.smtpForm.get('username')?.valueChanges.subscribe((username) => {
      if (this.smtpForm.get('useUsernameAsSenderEmail')?.value === true) {
        this.smtpForm.patchValue({ senderEmail: String(username || '').trim() }, { emitEvent: false });
      }
    });

    this.smtpForm.get('useUsernameAsSenderEmail')?.valueChanges.subscribe((useLinkedEmail) => {
      this.setSenderEmailLinkState(useLinkedEmail === true);
    });

    this.smtpForm.valueChanges.subscribe(() => {
      this.smtpTestPassed = false;
      this.smtpRetryCount = 0;
    });
  }

  ngOnInit(): void {
    this.loadConfig();
    this.loadSmtpConfig();
    this.loadReportTableColorConfig();
    const username = this.authService.getCurrentUser()?.username;
    this.smtpGuideVisible = this.onboardingService.shouldShow('admin-smtp', username);
  }

  closeSmtpGuide(dontShowAgain = false): void {
    const username = this.authService.getCurrentUser()?.username;
    if (dontShowAgain) {
      this.onboardingService.hide('admin-smtp', username);
    }
    this.smtpGuideVisible = false;
  }

  openSmtpGuide(): void {
    this.smtpGuideVisible = true;
    setTimeout(() => {
      const card = this.smtpGuideCard?.nativeElement;
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  loadConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.appConfigForm.patchValue({
          guestEnabled: config.guestModeEnabled
        });
      },
      error: (err) => console.error('Error cargando config:', err)
    });
  }

  loadSmtpConfig(): void {
    this.smtpService.getConfig().subscribe({
      next: (config) => this.patchSmtpConfig(config),
      error: (err) => console.error('Error cargando SMTP:', err)
    });
  }

  private patchSmtpConfig(config: SmtpConfig | null): void {
    if (!config) {
      this.hasStoredSmtpConfig = false;
      this.connectionStatus = 'sin-config';
      return;
    }

    this.hasStoredSmtpConfig = true;
    this.smtpForm.patchValue({
      provider: config.provider || 'custom',
      host: config.host,
      port: config.port,
      useTLS: config.useTLS,
      username: config.username,
      password: '',
      senderName: config.senderName,
      useUsernameAsSenderEmail: String(config.senderEmail || '').trim().toLowerCase() === String(config.username || '').trim().toLowerCase(),
      senderEmail: config.senderEmail,
      recipientsText: (config.recipients || []).join(', '),
      sendOnlyIfRed: config.sendOnlyIfRed ?? false,
      isActive: config.isActive ?? true
    });

    this.setSenderEmailLinkState(this.smtpForm.get('useUsernameAsSenderEmail')?.value === true);

    this.applyProviderPreset(config.provider || 'custom', true);

    this.smtpTestPassed = !!config.lastTestSuccess;
    this.connectionStatus = config.isActive === false
      ? 'desactivado'
      : (config.lastTestSuccess ? 'conectado' : 'desconectado');
  }

  get selectedProviderPreset() {
    const provider = this.smtpForm.get('provider')?.value || 'custom';
    return this.smtpProviderPresets[provider] || this.smtpProviderPresets['custom'];
  }

  get smtpPasswordInputType(): 'password' | 'text' {
    return this.showSmtpPassword ? 'text' : 'password';
  }

  get smtpPasswordPlaceholder(): string {
    const hasTypedValue = !!String(this.smtpForm.get('password')?.value || '').trim();
    return this.hasStoredSmtpConfig && !hasTypedValue ? '******' : '';
  }

  get canSaveSmtpConfig(): boolean {
    return this.savingSmtp ? false : (this.smtpTestPassed || this.hasStoredSmtpConfig || this.smtpForm.value.isActive === false);
  }

  toggleSmtpPasswordVisibility(): void {
    const shouldShow = !this.showSmtpPassword;

    if (shouldShow) {
      const hasTypedValue = !!String(this.smtpForm.get('password')?.value || '').trim();
      if (!hasTypedValue && this.hasStoredSmtpConfig) {
        this.smtpService.getStoredPassword().subscribe({
          next: (resp) => {
            const password = String(resp?.password || '');
            this.smtpForm.patchValue({ password }, { emitEvent: false });
            this.showSmtpPassword = true;
          },
          error: (err) => {
            this.smtpLastError = this.buildSmtpDiagnostic(err);
            this.snackBar.open(
              'No se pudo revelar la contraseña SMTP guardada. Revisa Logs de Auditoría.',
              'Cerrar',
              { duration: 5000 }
            );
          }
        });
        return;
      }
    }

    this.showSmtpPassword = shouldShow;
  }

  private applyProviderPreset(provider: string, keepExistingHost = false): void {
    const preset = this.smtpProviderPresets[provider] || this.smtpProviderPresets['custom'];
    const currentHost = String(this.smtpForm.get('host')?.value || '').trim();

    this.smtpForm.patchValue({
      host: keepExistingHost && currentHost ? currentHost : preset.host,
      port: preset.port,
      useTLS: preset.useTLS
    }, { emitEvent: false });
  }

  private setSenderEmailLinkState(useLinkedEmail: boolean): void {
    const senderEmailControl = this.smtpForm.get('senderEmail');
    if (!senderEmailControl) return;

    if (useLinkedEmail) {
      const username = String(this.smtpForm.get('username')?.value || '').trim();
      senderEmailControl.setValue(username, { emitEvent: false });
      senderEmailControl.disable({ emitEvent: false });
      return;
    }

    senderEmailControl.enable({ emitEvent: false });
  }

  onSmtpActiveChange(enabled: boolean): void {
    this.smtpForm.patchValue({ isActive: enabled }, { emitEvent: false });

    if (!enabled && this.hasStoredSmtpConfig) {
      this.saveSmtpConfig(true);
    }
  }

  saveAppConfig(): void {
    if (this.appConfigForm.valid) {
      const data: UpdateConfigRequest = {
        guestModeEnabled: this.appConfigForm.value.guestEnabled
      };
      this.configService.updateConfig(data).subscribe({
        next: () => this.snackBar.open('Configuracion guardada', 'Cerrar', { duration: 2000 }),
        error: () => this.snackBar.open('Error guardando configuracion', 'Cerrar', { duration: 3000 })
      });
    }
  }

  saveSmtpConfig(allowInactiveSave = false): void {
    const isActive = this.smtpForm.value.isActive !== false;
    const passwordInput = String(this.smtpForm.get('password')?.value || '').trim();

    if (isActive && this.hasStoredSmtpConfig && !this.smtpTestPassed && !passwordInput) {
      this.snackBar.open(
        'Para reactivar SMTP después de una restauración, ingresa nuevamente la contraseña SMTP y guarda.',
        'Cerrar',
        { duration: 5000 }
      );
      return;
    }

    if (!this.smtpTestPassed && !this.hasStoredSmtpConfig && !(allowInactiveSave && !isActive)) {
      this.snackBar.open('Primero realiza una prueba SMTP exitosa', 'Cerrar', { duration: 3000 });
      return;
    }

    this.savingSmtp = true;
    const payload = this.buildSmtpPayload();
    this.smtpService.saveConfig(payload).subscribe({
      next: (resp) => {
        this.smtpLastError = null;
        this.snackBar.open(resp.message || 'SMTP guardado', 'Cerrar', { duration: 2000 });
        this.patchSmtpConfig(resp.config);
      },
      error: (err) => {
        this.smtpLastError = this.buildSmtpDiagnostic(err);
        this.snackBar.open(
          `No se pudo guardar SMTP. ${this.smtpLastError.suggestedAction}`,
          'Cerrar',
          { duration: 6000 }
        );
      },
      complete: () => this.savingSmtp = false
    });
  }

  testSmtp(): void {
    this.runSmtpTest(false);
  }

  private runSmtpTest(isRetry: boolean): void {
    // Para probar conexión, solo validar campos básicos (sin destinatarios)
    const requiredFields = ['host', 'port', 'username', 'senderName', 'senderEmail'];
    const invalidFields = requiredFields.filter(field => {
      const control = this.smtpForm.get(field);
      return !control?.value || control?.invalid;
    });

    const hasPasswordInput = !!this.smtpForm.get('password')?.value;
    if (!hasPasswordInput && !this.hasStoredSmtpConfig) {
      invalidFields.push('password');
    }

    if (invalidFields.length > 0) {
      this.snackBar.open('Completa los campos obligatorios antes de probar', 'Cerrar', { duration: 3000 });
      return;
    }

    this.testing = true;
    if (isRetry) {
      this.smtpRetryCount += 1;
    } else {
      this.smtpRetryCount = 0;
    }

    const payload = this.buildSmtpPayload() as SmtpConfigRequest & {
      retryAttempt?: boolean;
      retryCount?: number;
    };
    if (isRetry) {
      payload.retryAttempt = true;
      payload.retryCount = this.smtpRetryCount;
    }

    this.smtpService.testConfig(payload).subscribe({
      next: (response) => {
        this.smtpLastError = null;
        this.smtpTestPassed = true;
        this.connectionStatus = 'conectado';
        this.smtpRetryCount = 0;
        this.snackBar.open(response.message, 'Cerrar', { duration: 4000 });
      },
      error: (err) => {
        this.smtpLastError = this.buildSmtpDiagnostic(err);
        const hadKnownGoodConnection = this.smtpTestPassed || this.connectionStatus === 'conectado';
        const transientCodes = new Set(['SMTP_RATE_LIMIT', 'SMTP_THROTTLED', 'SMTP_TIMEOUT']);
        const shouldKeepConnected = hadKnownGoodConnection && transientCodes.has(this.smtpLastError.code);
        this.connectionStatus = shouldKeepConnected ? 'conectado' : 'desconectado';
        this.smtpTestPassed = shouldKeepConnected ? true : false;
        this.snackBar.open(
          `Error en test SMTP: ${this.smtpLastError.probableCause}. ${this.smtpLastError.suggestedAction}`,
          'Cerrar',
          { duration: 7000 }
        );
      },
      complete: () => this.testing = false
    });
  }

  retrySmtpTest(): void {
    this.runSmtpTest(true);
  }

  private buildSmtpDiagnostic(err: any): { code: string; probableCause: string; suggestedAction: string; rawMessage?: string } {
    const firstValidationError = err?.error?.errors?.[0];
    const validationMsg = firstValidationError
      ? `${firstValidationError.field || 'campo'}: ${firstValidationError.msg || 'valor inválido'}`
      : '';

    const rawMessage = String(err?.error?.error || err?.error?.message || err?.message || 'error desconocido');
    const detailedMessage = validationMsg ? `${rawMessage} | ${validationMsg}` : rawMessage;
    const lowered = rawMessage.toLowerCase();
    const statusCode = Number(err?.status || err?.error?.status || 0);

    if (statusCode === 400 && (rawMessage.includes('Errores de validación') || !!firstValidationError)) {
      return {
        code: 'SMTP_VALIDATION',
        probableCause: validationMsg || 'Payload inválido para guardar/probar configuración SMTP',
        suggestedAction: 'Revisa el campo indicado y vuelve a guardar.',
        rawMessage: detailedMessage
      };
    }

    if (rawMessage.includes('No se pudo reutilizar la contraseña SMTP guardada')) {
      return {
        code: 'SMTP_PASSWORD_REENTRY',
        probableCause: 'La contraseña SMTP guardada no pudo reutilizarse en este entorno',
        suggestedAction: 'Ingresa nuevamente la contraseña SMTP, prueba conexión y guarda.',
        rawMessage: detailedMessage
      };
    }

    if (
      statusCode === 429 ||
      lowered.includes('demasiados intentos') ||
      lowered.includes('rate limit') ||
      lowered.includes('too many requests')
    ) {
      return {
        code: 'SMTP_RATE_LIMIT',
        probableCause: 'Se alcanzó el límite temporal de pruebas SMTP',
        suggestedAction: 'Espera unos minutos y vuelve a probar.',
        rawMessage: detailedMessage
      };
    }
    if (
      lowered.includes('invalid login') ||
      lowered.includes('535') ||
      lowered.includes('authentication unsuccessful') ||
      lowered.includes('auth')
    ) {
      if (
        lowered.includes('5.7.139') ||
        lowered.includes('did not meet the criteria') ||
        lowered.includes('contact your administrator')
      ) {
        return {
          code: 'SMTP_AUTH_POLICY',
          probableCause: 'Bloqueo de política de Microsoft 365 (Conditional Access o SMTP AUTH restringido)',
          suggestedAction: 'No es solo clave: valida política SMTP AUTH del usuario, MFA/App Password y restricciones por IP/origen.',
          rawMessage: detailedMessage
        };
      }

      return {
        code: 'SMTP_AUTH',
        probableCause: 'Credenciales SMTP inválidas o bloqueadas',
        suggestedAction: 'Verifica usuario/clave y vuelve a probar.',
        rawMessage: detailedMessage
      };
    }

    if (
      lowered.includes('temporarily') ||
      lowered.includes('try again later') ||
      lowered.includes('throttle') ||
      lowered.includes('4.7.')
    ) {
      return {
        code: 'SMTP_THROTTLED',
        probableCause: 'El proveedor SMTP aplicó bloqueo temporal por seguridad',
        suggestedAction: 'Espera unos minutos y reintenta; si persiste, revisa políticas del proveedor.',
        rawMessage: detailedMessage
      };
    }
    if (lowered.includes('etimedout') || lowered.includes('timeout')) {
      return {
        code: 'SMTP_TIMEOUT',
        probableCause: 'Tiempo de espera agotado hacia el servidor SMTP',
        suggestedAction: 'Revisa conectividad de red/firewall y reintenta.',
        rawMessage: detailedMessage
      };
    }
    if (lowered.includes('econnrefused') || lowered.includes('enotfound')) {
      return {
        code: 'SMTP_HOST',
        probableCause: 'Host o puerto SMTP no alcanzable',
        suggestedAction: 'Confirma host/puerto y DNS interno.',
        rawMessage: detailedMessage
      };
    }
    if (lowered.includes('self signed') || lowered.includes('certificate') || lowered.includes('tls')) {
      return {
        code: 'SMTP_TLS',
        probableCause: 'Problema de certificado o negociación TLS',
        suggestedAction: 'Revisa opción SSL/TLS y política de certificados.',
        rawMessage: detailedMessage
      };
    }

    return {
      code: 'SMTP_UNKNOWN',
      probableCause: 'Fallo no categorizado en la prueba SMTP',
      suggestedAction: 'Reintenta y revisa logs de auditoría para detalle técnico.',
      rawMessage: detailedMessage
    };
  }

  private buildSmtpPayload(): SmtpConfigRequest {
    const value = this.smtpForm.getRawValue();
    const recipients = (value.recipientsText as string || '')
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    const username = String(value.username || '').trim();
    const senderEmail = value.useUsernameAsSenderEmail === true
      ? username
      : String(value.senderEmail || '').trim();

    const payload: SmtpConfigRequest = {
      provider: value.provider,
      authMethod: 'credentials',
      username,
      host: value.host,
      port: Number(value.port),
      useTLS: value.useTLS,
      senderName: value.senderName,
      senderEmail,
      recipients,
      sendOnlyIfRed: value.sendOnlyIfRed,
      isActive: value.isActive
    };

    const password = (value.password || '').trim();
    if (password) {
      payload.password = password;
    }

    return payload;
  }

  // ─── Métodos de paleta de colores de email ────────────────────────────────────

  loadReportTableColorConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.currentEmailReportConfig = {
          ...this.currentEmailReportConfig,
          ...(config.emailReportConfig || {})
        };
        // Cargar paleta seleccionada del correo de incidentes
        if (config.incidentEmailPaletteKey) {
          this.selectedPaletteKey = config.incidentEmailPaletteKey;
        }
        const incidentColor = this.normalizeHexColor(
          this.currentEmailReportConfig.reportTableColorByDocumentType?.incident
        );
        const legacyColor = this.normalizeHexColor(this.currentEmailReportConfig.reportTableColor);
        const reportColor = incidentColor || legacyColor || SettingsComponent.DEFAULT_REPORT_COLOR;
        this.selectedCustomReportColor = reportColor;
        this.customReportColorInput    = reportColor;
        this.reportColorMode = this.resolveReportColorMode(reportColor);
      },
      error: () => {
        this.reportColorMode = 'green';
        this.selectedCustomReportColor = SettingsComponent.DEFAULT_REPORT_COLOR;
        this.customReportColorInput    = SettingsComponent.DEFAULT_REPORT_COLOR;
      }
    });
  }

  selectIncidentPalette(key: string): void {
    this.selectedPaletteKey = key;
  }

  saveIncidentPalette(): void {
    this.isSavingPalette = true;
    this.configService.updateConfig({ incidentEmailPaletteKey: this.selectedPaletteKey }).subscribe({
      next: () => {
        this.isSavingPalette = false;
        this.snackBar.open('Paleta guardada correctamente', 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.isSavingPalette = false;
        this.snackBar.open('Error al guardar la paleta', 'OK', { duration: 4000 });
        console.error('[settings] Error guardando paleta:', err);
      }
    });
  }

  onReportColorModeChange(): void {
    if (this.reportColorMode !== 'custom') {
      this.selectedCustomReportColor = this.getColorForMode(this.reportColorMode);
    }
  }

  selectCustomReportColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized) return;
    this.selectedCustomReportColor = normalized;
    this.customReportColorInput    = normalized;
    this.reportColorMode = 'custom';
  }

  onCustomColorInputChange(input: string): void {
    this.customReportColorInput = (input || '').toUpperCase();
    const normalized = this.normalizeHexColor(input);
    if (!normalized) return;
    this.selectedCustomReportColor = normalized;
    this.reportColorMode = 'custom';
  }

  getCurrentReportColor(): string {
    if (this.reportColorMode === 'custom') {
      return this.normalizeHexColor(this.selectedCustomReportColor) || SettingsComponent.DEFAULT_REPORT_COLOR;
    }
    return this.getColorForMode(this.reportColorMode);
  }

  getModeOptionLabel(mode: 'green' | 'sky' | 'light-red' | 'custom'): string {
    const labels: Record<string, string> = { green: 'Verde', sky: 'Celeste', 'light-red': 'Rojo claro', custom: 'Custom' };
    const active = this.isReportColorModeActive(mode) ? ' (actual)' : '';
    return (labels[mode] ?? mode) + active;
  }

  isReportColorModeActive(mode: 'green' | 'sky' | 'light-red' | 'custom'): boolean {
    if (mode === 'custom') return this.reportColorMode === 'custom';
    return this.getCurrentReportColor() === this.getColorForMode(mode);
  }

  saveReportTableColorConfig(): void {
    const selectedTypes = (['incident', 'bulletin'] as const).filter(t => this.reportColorSelection[t]);
    if (selectedTypes.length === 0) {
      this.snackBar.open('Selecciona al menos un tipo de documento', 'Cerrar', { duration: 3000 });
      return;
    }

    const resolvedColor = this.reportColorMode === 'custom'
      ? (this.normalizeHexColor(this.selectedCustomReportColor) || SettingsComponent.DEFAULT_REPORT_COLOR)
      : this.getColorForMode(this.reportColorMode);

    const colorByType = {
      incident: this.normalizeHexColor(this.currentEmailReportConfig.reportTableColorByDocumentType?.incident)
        || SettingsComponent.DEFAULT_REPORT_COLOR,
      bulletin: this.normalizeHexColor(this.currentEmailReportConfig.reportTableColorByDocumentType?.bulletin)
        || SettingsComponent.DEFAULT_REPORT_COLOR
    };
    selectedTypes.forEach(t => { colorByType[t] = resolvedColor; });

    const emailReportConfig: EmailReportConfig = {
      ...this.currentEmailReportConfig,
      reportTableColor: colorByType.incident,
      reportTableColorByDocumentType: colorByType
    };

    const labels: Record<string, string> = { incident: 'Reporte de Incidente', bulletin: 'Boletín de Seguridad' };
    const targetsLabel = selectedTypes.map(t => labels[t]).join(', ');

    this.isSavingReportColor = true;
    this.configService.updateConfig({ emailReportConfig }).subscribe({
      next: () => {
        this.currentEmailReportConfig = emailReportConfig;
        this.selectedCustomReportColor = resolvedColor;
        this.customReportColorInput    = resolvedColor;
        this.snackBar.open(`✅ Color guardado para: ${targetsLabel}`, 'Cerrar', { duration: 3000 });
        this.isSavingReportColor = false;
      },
      error: () => {
        this.snackBar.open('Error guardando color', 'Cerrar', { duration: 3000 });
        this.isSavingReportColor = false;
      }
    });
  }

  private resolveReportColorMode(color: string): 'green' | 'sky' | 'light-red' | 'custom' {
    const n = this.normalizeHexColor(color);
    if (!n) return 'green';
    if (n === this.getColorForMode('green'))     return 'green';
    if (n === this.getColorForMode('sky'))        return 'sky';
    if (n === this.getColorForMode('light-red'))  return 'light-red';
    return 'custom';
  }

  private getColorForMode(mode: 'green' | 'sky' | 'light-red' | 'custom'): string {
    if (mode === 'sky')       return '#29B6F6';
    if (mode === 'light-red') return '#E57373';
    return SettingsComponent.DEFAULT_REPORT_COLOR;
  }

  private normalizeHexColor(color: string | undefined | null): string | null {
    if (!color) return null;
    const n = color.trim().toUpperCase();
    return /^#([A-F0-9]{6})$/.test(n) ? n : null;
  }
}
