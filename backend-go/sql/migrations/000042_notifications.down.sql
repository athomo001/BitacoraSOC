DELETE FROM maintenance_windows WHERE organization_id IS NOT NULL OR area_id IS NOT NULL OR team_id IS NOT NULL;
DROP INDEX IF EXISTS idx_maintenance_windows_team;
DROP INDEX IF EXISTS idx_maintenance_windows_area;
DROP INDEX IF EXISTS idx_maintenance_windows_org;
ALTER TABLE maintenance_windows
  DROP CONSTRAINT chk_maintenance_window_one_scope,
  DROP COLUMN notified_end, DROP COLUMN notified_start, DROP COLUMN closed_by, DROP COLUMN closed_at,
  DROP COLUMN agenda_task_id, DROP COLUMN team_id, DROP COLUMN area_id, DROP COLUMN organization_id,
  ADD CONSTRAINT chk_maintenance_window_one_scope CHECK (
    (service_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int + (territorial_unit_id IS NOT NULL)::int = 1
  );
DROP TABLE IF EXISTS notice_recipients;
DROP TABLE IF EXISTS notices;
DROP TABLE IF EXISTS agenda_occurrence_alerts;
DROP TABLE IF EXISTS notification_prefs;
DROP TABLE IF EXISTS notification_settings;
DROP TABLE IF EXISTS notifications;
