/**
 * File Purpose: frontend/src/app/models/config.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export interface AppConfig {
  _id?: string;
  guestModeEnabled: boolean;
  guestMaxDurationDays: number;
  // Habilitar envío de correos de cumpleaños
  birthdayEmailsEnabled?: boolean;
  // Hora de envío de correos de cumpleaños
  birthdayEmailsTime?: string;
  shiftCheckCooldownHours: number;
  checklistCloseEmailEnabled?: boolean;
  alertNokEnabled?: boolean;
  alertNokRoleTarget?: string[];
  checklistAlertEnabled?: boolean;
  checklistAlertTime?: string;
  checklistWeeklyAlertEnabled?: boolean;
  checklistWeeklyReminderDay?: number;
  checklistWeeklyReminderTime?: string;
  checklistWeeklyCutoffTime?: string;
  checklistWeeklyTimezone?: string;
  escalationReminderEnabled?: boolean;
  escalationReminderCargoLabels?: string[];
  escalationReminderDaysAhead?: number;
  lastEscalationReminderDate?: Date;
  lastEscalationReminderWeekStartDate?: Date;
  lastChecklistAlertDate?: Date;
  appTitle?: string;
  // Fuente tipográfica seleccionada para el título de la barra superior.
  titleFont?: string;
  security?: SecurityConfig;
  logoUrl?: string;
  logoType?: 'url' | 'upload' | 'external';
  faviconUrl?: string;
  faviconType?: 'url' | 'upload' | 'external';
  defaultLogSourceId?: string | { _id: string; name: string; enabled: boolean };
  defaultCompanyName?: string;
  emailReportConfig?: EmailReportConfig;
  incidentEmailPaletteKey?: string;
  smtpConfig?: SmtpConfig;
  easterEggRules?: EasterEggRule[];
  loginTheme?: 'crt' | 'infoflow' | 'modern' | 'surrealism';
  escalationScheduleAutomation?: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly';
    dayOfWeek: number;
    time: string;
    recipients: string[];
    ccRecipients: string[];
    lastSentAt?: Date;
  };
  // Autenticación Single Sign-On (SSO)
  googleSsoEnabled?: boolean;
  googleClientId?: string;
  microsoftSsoEnabled?: boolean;
  microsoftClientId?: string;
  microsoftTenantId?: string;

  lastUpdatedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EasterEggRule {
  scope: 'login' | 'entry';
  triggerType: 'credentials' | 'hashtag';
  username?: string;
  password?: string;
  pattern?: string;
  hashtag?: string;
  payload?: EasterEggPayload;
  enabled?: boolean;
}

export interface EasterEggPayload {
  blackout?: boolean;
  imageUrl?: string;
  durationMs?: number;
  cooldownMs?: number;
}

export interface EmailReportConfig {
  enabled: boolean;
  recipients: string[];
  includeChecklist: boolean;
  includeEntries: boolean;
  subjectTemplate: string;
  reportTableColor?: string;
  reportTableColorByDocumentType?: {
    incident?: string;
    bulletin?: string;
  };
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface SecurityConfig {
  httpsEnabled: boolean;
  forceHttps: boolean;
  httpsPort?: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  tlsCaPath?: string;
  certUploaded?: boolean;
  keyUploaded?: boolean;
  caUploaded?: boolean;
  certFileName?: string;
  keyFileName?: string;
  caFileName?: string;
  httpsReady?: boolean;
}

export interface ShiftReminder {
  _id?: string;
  label: string;
  reminderText: string;
  frequencyType: 'hours' | 'fixed';
  intervalHours: number;
  fixedTimes: string[];
  targetShiftIds: string[];
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateConfigRequest {
  guestModeEnabled?: boolean;
  guestMaxDurationDays?: number;
  shiftCheckCooldownHours?: number;
  checklistCloseEmailEnabled?: boolean;
  alertNokEnabled?: boolean;
  alertNokRoleTarget?: string[];
  checklistAlertEnabled?: boolean;
  checklistAlertTime?: string;
  checklistWeeklyAlertEnabled?: boolean;
  checklistWeeklyReminderDay?: number;
  checklistWeeklyReminderTime?: string;
  checklistWeeklyCutoffTime?: string;
  checklistWeeklyTimezone?: string;
  escalationReminderEnabled?: boolean;
  escalationReminderCargoLabels?: string[];
  escalationReminderDaysAhead?: number;
  appTitle?: string;
  // Fuente tipográfica opcional para actualizar en el branding.
  titleFont?: string;
  security?: Partial<SecurityConfig>;
  logoUrl?: string;
  faviconUrl?: string;
  defaultLogSourceId?: string | null;
  defaultCompanyName?: string;
  emailReportConfig?: EmailReportConfig;
  incidentEmailPaletteKey?: string;
  smtpConfig?: SmtpConfig;
  easterEggRules?: EasterEggRule[];
  loginTheme?: 'crt' | 'infoflow' | 'modern' | 'surrealism';
  escalationScheduleAutomation?: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly';
    dayOfWeek: number;
    time: string;
    recipients: string[];
    ccRecipients: string[];
  };
  googleSsoEnabled?: boolean;
  googleClientId?: string;
  microsoftSsoEnabled?: boolean;
  microsoftClientId?: string;
  microsoftTenantId?: string;
  // Configuración de cumpleaños
  birthdayEmailsEnabled?: boolean;
  birthdayEmailsTime?: string;
}
