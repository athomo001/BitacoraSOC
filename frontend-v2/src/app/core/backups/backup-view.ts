import { MessageKey } from '../i18n/messages';
import { Tone } from '../tickets/ticket-view';
import { BackupRun } from './backups.service';

/** Etiqueta y tono de cada copia del historial (pastilla de la columna Tipo). */
export function runKind(run: BackupRun): { key: MessageKey; tone: Tone } {
  if (run.status === 'failed') return { key: 'backups.kind.failed', tone: 'bad' };
  if (run.kind === 'delta') return { key: 'backups.kind.delta', tone: 'system' };
  switch (run.triggerSource) {
    case 'auto':
      return { key: 'backups.kind.auto', tone: 'info' };
    case 'upload':
      return { key: 'backups.kind.upload', tone: 'neutral' };
    case 'pre_restore':
      return { key: 'backups.kind.pre_restore', tone: 'warn' };
    default:
      return { key: 'backups.kind.manual', tone: 'neutral' };
  }
}

/** "4,2 MB", "96 KB": tamaño legible con coma decimal. */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Miles con punto, como se lee en Chile: 184.212. */
export function formatCount(n: number): string {
  return n.toLocaleString('es-CL');
}
