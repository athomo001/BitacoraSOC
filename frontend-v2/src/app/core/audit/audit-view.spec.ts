import { categoryOf, formatMetadata, rangeBounds } from './audit-view';

describe('audit-view', () => {
  it('cada evento que emite hoy el backend cae en una categoría (ninguno en "Otro")', () => {
    // Catálogo real de backend-go (grep de AuditLog.Log) al 2026-09-30.
    const events = [
      'asset.create', 'auth.login.fail', 'auth.mfa.setup', 'auth.session.ip_change', 'audit.logs.export', 'backup.created',
      'checklist.abandoned', 'checklist_config.update', 'checklist_template.delete', 'config.modules.update', 'deployment.notified',
      'directory.contact.create', 'dotacion.notification.test', 'entry.deleted', 'escalation.step.delete', 'log_source.create',
      'maintenance_window.create', 'notes.admin_updated', 'organization.update', 'permissiongroup.create', 'public_share.telework.rotated',
      'raci.create', 'report.shift.dispatch', 'rotation.slot.created', 'service.create', 'setup.bootstrap', 'shift.closed',
      'system.ratelimit.reset', 'system_feature.update', 'team.coverage.remove', 'team_group.create', 'territorial_unit.import',
      'ticket.updated', 'user.channel.delete', 'user.permissiongroups.replace', 'users.update', 'work_shift.created',
      'work_shift_assignment.upserted',
      // Los que llegaron después (9.x y paridad) y los que vienen del legacy.
      'agenda.task.created', 'notification.digest.sent', 'notice.read', 'calendar_feed.create', 'inventory.asset.create', 'glpi.import',
      'guard.slot.create', 'shiftcheck.delete', 'client_alert.update', 'mail.send.success', 'smtp.shift-report.sent', 'birthday.sent',
      'area.create', 'level.update', 'branding.update', 'complement.list.view', 'entries.tag.rename', 'user.reports.overview.view',
      'admin.users.update', 'admin.backup.create', 'BACKUP_AUTO_SCHEDULED', 'organization_type.create',
    ];
    const other = events.filter((e) => categoryOf(e).id === 'other');
    expect(other).toEqual([]);
  });

  it('agrupa por dominio y gana el prefijo más largo', () => {
    expect(categoryOf('auth.login.fail').id).toBe('access');
    expect(categoryOf('setup.bootstrap').id).toBe('access');
    expect(categoryOf('user.channel.create').id).toBe('directory');
    expect(categoryOf('users.update').id).toBe('admin');
    expect(categoryOf('checklist_template.delete').id).toBe('shifts');
    expect(categoryOf('admin.backup.create').id).toBe('backups');
    expect(categoryOf('BACKUP_AUTO_SCHEDULED').id).toBe('backups');
    expect(categoryOf('user.reports.overview.view').id).toBe('shifts');
    // "ticketera.x" no es del dominio "ticket": el prefijo tiene que terminar en punto.
    expect(categoryOf('ticketera.x').id).toBe('other');
  });

  it('calcula los rangos de fecha', () => {
    const now = new Date(2026, 8, 30, 14, 30);
    expect(rangeBounds('today', now)).toEqual({ from: new Date(2026, 8, 30) });
    expect(rangeBounds('7d', now).from).toEqual(new Date(now.getTime() - 7 * 86_400_000));
    // "Hasta" incluye el día completo.
    expect(rangeBounds('custom', now, '2026-09-01', '2026-09-15')).toEqual({ from: new Date(2026, 8, 1), to: new Date(2026, 8, 16) });
    expect(rangeBounds('custom', now, '', '')).toEqual({ from: undefined, to: undefined });
  });

  it('muestra los datos del evento legibles', () => {
    expect(formatMetadata({ previousIp: '10.0.0.1' })).toBe('{\n  "previousIp": "10.0.0.1"\n}');
    expect(formatMetadata({})).toBe('—');
    expect(formatMetadata(undefined)).toBe('—');
  });
});
