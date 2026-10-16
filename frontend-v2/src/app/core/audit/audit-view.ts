import { MessageKey } from '../i18n/messages';
import { Tone } from '../tickets/ticket-view';

/**
 * Categorías del artboard "Administración → Auditoría": cada una agrupa los
 * dominios de evento (`dominio.accion`, spec/07 §6.1) que el backend filtra
 * por prefijo. Un evento de un dominio nuevo cae en "Otro" hasta que se
 * agregue acá; el filtro "Todas" lo sigue mostrando.
 */
export interface AuditCategory {
  id: string;
  labelKey: MessageKey;
  prefixes: readonly string[];
  tone: Tone;
}

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  { id: 'access', labelKey: 'audit.cat.access', prefixes: ['auth', 'setup'], tone: 'info' },
  { id: 'entries', labelKey: 'audit.cat.entries', prefixes: ['entry', 'entries'], tone: 'neutral' },
  { id: 'tickets', labelKey: 'audit.cat.tickets', prefixes: ['ticket'], tone: 'neutral' },
  {
    id: 'shifts',
    labelKey: 'audit.cat.shifts',
    prefixes: ['shift', 'shiftcheck', 'checklist', 'checklist_template', 'checklist_config', 'work_shift', 'work_shift_assignment', 'rotation', 'guard', 'dotacion', 'report', 'user.reports', 'public_share', 'notes'],
    tone: 'neutral',
  },
  { id: 'escalation', labelKey: 'audit.cat.escalation', prefixes: ['escalation', 'maintenance_window', 'raci', 'client_alert'], tone: 'neutral' },
  { id: 'agenda', labelKey: 'audit.cat.agenda', prefixes: ['agenda', 'notification', 'notice', 'calendar_feed'], tone: 'neutral' },
  { id: 'inventory', labelKey: 'audit.cat.inventory', prefixes: ['inventory', 'glpi'], tone: 'neutral' },
  { id: 'directory', labelKey: 'audit.cat.directory', prefixes: ['directory', 'user.channel'], tone: 'neutral' },
  { id: 'mail', labelKey: 'audit.cat.mail', prefixes: ['mail', 'smtp', 'birthday'], tone: 'neutral' },
  {
    id: 'admin',
    labelKey: 'audit.cat.admin',
    prefixes: [
      'users', 'user', 'admin', 'permissiongroup', 'user.permissiongroups', 'config', 'password_policy', 'system_feature', 'system', 'team', 'team_group',
      'area', 'level', 'organization', 'organization_type', 'territorial_unit', 'log_source', 'service', 'asset', 'deployment', 'branding', 'complement',
    ],
    tone: 'system',
  },
  {
    id: 'backups',
    labelKey: 'audit.cat.backups',
    // Los del legacy venían en mayúsculas y sin punto.
    prefixes: ['backup', 'admin.backup', 'BACKUP_AUTO_SCHEDULED', 'BACKUP_AUTO_TRIGGERED', 'BACKUP_AUTO_COMPLETED', 'BACKUP_AUTO_FAILED',
      'BACKUP_RETENTION_CLEANUP_STARTED', 'BACKUP_RETENTION_FILE_DELETED', 'BACKUP_RETENTION_FILE_SKIPPED'],
    tone: 'system',
  },
  { id: 'audit', labelKey: 'audit.cat.audit', prefixes: ['audit'], tone: 'system' },
];

const OTHER: AuditCategory = { id: 'other', labelKey: 'audit.cat.other', prefixes: [], tone: 'neutral' };

function matches(event: string, prefix: string): boolean {
  return event === prefix || event.startsWith(prefix + '.');
}

/** La categoría del evento; gana el prefijo más largo ("user.channel" antes que "users"). */
export function categoryOf(event: string): AuditCategory {
  let best: AuditCategory = OTHER;
  let bestLength = 0;
  for (const category of AUDIT_CATEGORIES) {
    for (const prefix of category.prefixes) {
      if (prefix.length > bestLength && matches(event, prefix)) {
        best = category;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

export type AuditRange = 'today' | '7d' | '30d' | 'custom';

/**
 * Límites del rango para la API. "Hoy" empieza a la medianoche local; los
 * rangos a mano toman el día completo de "hasta" (fin exclusivo al día
 * siguiente). Sin fecha en un extremo, ese extremo queda abierto.
 */
export function rangeBounds(range: AuditRange, now: Date, customFrom?: string, customTo?: string): { from?: Date; to?: Date } {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (range) {
    case 'today':
      return { from: startOfDay(now) };
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86_400_000) };
    case '30d':
      return { from: new Date(now.getTime() - 30 * 86_400_000) };
    case 'custom': {
      const parse = (value?: string) => {
        const [y, m, d] = (value ?? '').split('-').map(Number);
        return y && m && d ? new Date(y, m - 1, d) : undefined;
      };
      const from = parse(customFrom);
      const toDay = parse(customTo);
      return { from, to: toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : undefined };
    }
  }
}

/** Los datos del evento legibles: JSON con sangría, o "—" si no trae nada. */
export function formatMetadata(metadata?: Record<string, unknown>): string {
  return metadata && Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '—';
}
