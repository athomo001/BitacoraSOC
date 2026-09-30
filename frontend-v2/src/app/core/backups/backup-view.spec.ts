import { formatSize, runKind } from './backup-view';
import { BackupRun } from './backups.service';

const run = (overrides: Partial<BackupRun>): BackupRun => ({
  id: 'r1', kind: 'full', triggerSource: 'manual', status: 'success', startedAt: '', finishedAt: null,
  recordsCount: 0, fileSizeBytes: null, checksumSha256: null, errorMessage: null, needsPassphrase: true, ...overrides,
});

describe('backup-view', () => {
  it('distingue automático, manual, subido, seguridad, delta y fallido', () => {
    expect(runKind(run({ triggerSource: 'auto' })).key).toBe('backups.kind.auto');
    expect(runKind(run({})).key).toBe('backups.kind.manual');
    expect(runKind(run({ triggerSource: 'upload' })).key).toBe('backups.kind.upload');
    expect(runKind(run({ triggerSource: 'pre_restore' }))).toEqual({ key: 'backups.kind.pre_restore', tone: 'warn' });
    expect(runKind(run({ kind: 'delta', triggerSource: 'auto' })).key).toBe('backups.kind.delta');
    expect(runKind(run({ status: 'failed', triggerSource: 'auto' }))).toEqual({ key: 'backups.kind.failed', tone: 'bad' });
  });

  it('muestra tamaños legibles', () => {
    expect(formatSize(4_404_019)).toBe('4,2 MB');
    expect(formatSize(98_304)).toBe('96 KB');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(null)).toBe('—');
  });
});
