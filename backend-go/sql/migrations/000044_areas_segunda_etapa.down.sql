DROP INDEX IF EXISTS uq_maintenance_windows_series_day;
ALTER TABLE maintenance_windows
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS holiday_name,
  DROP COLUMN IF EXISTS series_day,
  DROP COLUMN IF EXISTS series_id;
DROP TABLE IF EXISTS maintenance_window_series;

DROP TABLE IF EXISTS monthly_summaries;

DROP TABLE IF EXISTS calendar_feeds;
DELETE FROM system_features WHERE code = 'calendar_feed';

DELETE FROM agenda_occurrences WHERE flow_run_id IS NOT NULL;
DELETE FROM agenda_tasks WHERE flow_id IS NOT NULL;
DROP INDEX IF EXISTS idx_agenda_occurrences_run;
DROP INDEX IF EXISTS uq_agenda_occurrences_flow_step;
DROP INDEX IF EXISTS uq_agenda_occurrences_task_day;
ALTER TABLE agenda_occurrences
  ADD CONSTRAINT agenda_occurrences_task_id_due_date_key UNIQUE (task_id, due_date),
  DROP CONSTRAINT agenda_occurrences_status_check,
  ADD CONSTRAINT agenda_occurrences_status_check CHECK (status IN ('pending', 'done', 'skipped')),
  DROP COLUMN flow_run_id;
DROP TABLE IF EXISTS agenda_flow_runs;
DROP INDEX IF EXISTS uq_agenda_tasks_flow_position;
ALTER TABLE agenda_tasks
  DROP CONSTRAINT IF EXISTS chk_agenda_task_flow,
  DROP COLUMN IF EXISTS flow_days,
  DROP COLUMN IF EXISTS flow_after,
  DROP COLUMN IF EXISTS flow_position,
  DROP COLUMN IF EXISTS flow_id;
DROP TABLE IF EXISTS agenda_flows;
