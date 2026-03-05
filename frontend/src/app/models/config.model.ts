export interface AppConfig {
  _id?: string;
  guestModeEnabled: boolean;
  guestMaxDurationDays: number;
  shiftCheckCooldownHours: number;
  checklistCloseEmailEnabled?: boolean;
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
  security?: SecurityConfig;
  logoUrl?: string;
  logoType?: 'url' | 'upload' | 'external';
  faviconUrl?: string;
  faviconType?: 'url' | 'upload' | 'external';
  defaultLogSourceId?: string | { _id: string; name: string; enabled: boolean };
  emailReportConfig?: EmailReportConfig;
  smtpConfig?: SmtpConfig;
  easterEggRules?: EasterEggRule[];
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

export interface UpdateConfigRequest {
  guestModeEnabled?: boolean;
  guestMaxDurationDays?: number;
  shiftCheckCooldownHours?: number;
  checklistCloseEmailEnabled?: boolean;
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
  security?: Partial<SecurityConfig>;
  logoUrl?: string;
  faviconUrl?: string;
  defaultLogSourceId?: string | null;
  emailReportConfig?: EmailReportConfig;
  smtpConfig?: SmtpConfig;
  easterEggRules?: EasterEggRule[];
}

