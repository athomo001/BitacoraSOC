import { MessageKey } from '../../core/i18n/messages';

/**
 * Proveedores de correo con sus valores conocidos, portados del legacy
 * (settings.component.ts, smtpProviderPresets). Elegir uno solo rellena
 * servidor, puerto y TLS: no se guarda como dato propio, así que al abrir la
 * sección se reconoce por el servidor guardado.
 */
export interface SmtpPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  requireTls: boolean;
  usernamePlaceholder: string;
  hintKey: MessageKey;
}

export const SMTP_PRESETS: readonly SmtpPreset[] = [
  { id: 'office365', label: 'Office 365', host: 'smtp.office365.com', port: 587, requireTls: true, usernamePlaceholder: 'usuario@empresa.com', hintKey: 'smtp.hint.office365' },
  { id: 'google-mail', label: 'Gmail', host: 'smtp.gmail.com', port: 587, requireTls: true, usernamePlaceholder: 'usuario@gmail.com', hintKey: 'smtp.hint.gmail' },
  { id: 'google-workspace', label: 'Google Workspace', host: 'smtp.gmail.com', port: 587, requireTls: true, usernamePlaceholder: 'usuario@dominio.com', hintKey: 'smtp.hint.workspace' },
  { id: 'aws-ses', label: 'AWS SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, requireTls: true, usernamePlaceholder: 'SMTP username de SES', hintKey: 'smtp.hint.ses' },
  { id: 'mailgun', label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, requireTls: true, usernamePlaceholder: 'postmaster@tu-dominio.mailgun.org', hintKey: 'smtp.hint.mailgun' },
  { id: 'elastic-email', label: 'Elastic Email', host: 'smtp.elasticemail.com', port: 2525, requireTls: true, usernamePlaceholder: 'correo o usuario SMTP', hintKey: 'smtp.hint.elastic' },
  { id: 'custom', label: '', host: '', port: 587, requireTls: true, usernamePlaceholder: 'usuario@servidor.local', hintKey: 'smtp.hint.custom' },
];

/**
 * El proveedor que corresponde a un servidor guardado. Gmail y Workspace
 * comparten servidor: se muestra Gmail salvo que el usuario no sea @gmail.com.
 * AWS SES se reconoce en cualquier región.
 */
export function presetFor(host: string, username = ''): SmtpPreset {
  const h = host.trim().toLowerCase();
  const custom = SMTP_PRESETS[SMTP_PRESETS.length - 1];
  if (!h) return custom;
  if (/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) return SMTP_PRESETS.find((p) => p.id === 'aws-ses')!;
  if (h === 'smtp.gmail.com') {
    const user = username.trim().toLowerCase();
    return SMTP_PRESETS.find((p) => p.id === (user && !user.endsWith('@gmail.com') ? 'google-workspace' : 'google-mail'))!;
  }
  return SMTP_PRESETS.find((p) => p.host === h) ?? custom;
}
