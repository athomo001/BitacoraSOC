import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfigService } from '../../../services/config.service';
import { SmtpService } from '../../../services/smtp.service';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { UpdateConfigRequest } from '../../../models/config.model';
import { SmtpConfigRequest, SmtpConfig } from '../../../models/smtp.model';
import { MatCard, MatCardHeader, MatCardTitle, MatCardContent } from '@angular/material/card';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    ReactiveFormsModule,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    MatButton,
    NgClass,
    MatSelect,
    NgFor,
    MatOption,
    NgIf,
    MatProgressSpinner,
  ]
})
export class SettingsComponent implements OnInit {
  appConfigForm: FormGroup;
  smtpForm: FormGroup;
  smtpTestPassed = false;
  hasStoredSmtpConfig = false;
  connectionStatus: 'conectado' | 'desconectado' | 'sin-config' = 'sin-config';
  testing = false;
  savingSmtp = false;
  smtpLastError: { code: string; probableCause: string; suggestedAction: string; rawMessage?: string } | null = null;
  smtpGuideVisible = false;
  smtpRetryCount = 0;

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
      senderEmail: ['', [Validators.required, Validators.email]],
      recipientsText: [''], // Opcional para pruebas, obligatorio para guardar
      sendOnlyIfRed: [false],
      isActive: [true]
    });

    this.smtpForm.valueChanges.subscribe(() => {
      this.smtpTestPassed = false;
      this.smtpRetryCount = 0;
    });
  }

  ngOnInit(): void {
    this.loadConfig();
    this.loadSmtpConfig();
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
      senderEmail: config.senderEmail,
      recipientsText: (config.recipients || []).join(', '),
      sendOnlyIfRed: config.sendOnlyIfRed ?? false,
      isActive: config.isActive ?? true
    });

    this.smtpTestPassed = !!config.lastTestSuccess;
    this.connectionStatus = config.lastTestSuccess ? 'conectado' : 'desconectado';
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

  saveSmtpConfig(): void {
    if (!this.smtpTestPassed) {
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
        this.connectionStatus = 'desconectado';
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
    const rawMessage = String(err?.error?.error || err?.error?.message || err?.message || 'error desconocido');
    const lowered = rawMessage.toLowerCase();

    if (lowered.includes('invalid login') || lowered.includes('535') || lowered.includes('auth')) {
      return {
        code: 'SMTP_AUTH',
        probableCause: 'Credenciales SMTP inválidas o bloqueadas',
        suggestedAction: 'Verifica usuario/clave y vuelve a probar.',
        rawMessage
      };
    }
    if (lowered.includes('etimedout') || lowered.includes('timeout')) {
      return {
        code: 'SMTP_TIMEOUT',
        probableCause: 'Tiempo de espera agotado hacia el servidor SMTP',
        suggestedAction: 'Revisa conectividad de red/firewall y reintenta.',
        rawMessage
      };
    }
    if (lowered.includes('econnrefused') || lowered.includes('enotfound')) {
      return {
        code: 'SMTP_HOST',
        probableCause: 'Host o puerto SMTP no alcanzable',
        suggestedAction: 'Confirma host/puerto y DNS interno.',
        rawMessage
      };
    }
    if (lowered.includes('self signed') || lowered.includes('certificate') || lowered.includes('tls')) {
      return {
        code: 'SMTP_TLS',
        probableCause: 'Problema de certificado o negociación TLS',
        suggestedAction: 'Revisa opción SSL/TLS y política de certificados.',
        rawMessage
      };
    }

    return {
      code: 'SMTP_UNKNOWN',
      probableCause: 'Fallo no categorizado en la prueba SMTP',
      suggestedAction: 'Reintenta y revisa logs de auditoría para detalle técnico.',
      rawMessage
    };
  }

  private buildSmtpPayload(): SmtpConfigRequest {
    const value = this.smtpForm.value;
    const recipients = (value.recipientsText as string || '')
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    const payload: SmtpConfigRequest = {
      provider: value.provider,
      authMethod: 'credentials',
      username: value.username,
      host: value.host,
      port: Number(value.port),
      useTLS: value.useTLS,
      senderName: value.senderName,
      senderEmail: value.senderEmail,
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
}
