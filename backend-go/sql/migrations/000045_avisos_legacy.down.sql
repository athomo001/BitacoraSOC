ALTER TABLE rotation_cycles DROP COLUMN IF EXISTS remind_uncovered;
ALTER TABLE app_config
  DROP COLUMN IF EXISTS guard_reminder_last_week,
  DROP COLUMN IF EXISTS guard_reminder_last_date,
  DROP COLUMN IF EXISTS guard_reminder_cargos,
  DROP COLUMN IF EXISTS guard_reminder_days_ahead,
  DROP COLUMN IF EXISTS guard_reminder_enabled,
  DROP COLUMN IF EXISTS checklist_missing_last_date,
  DROP COLUMN IF EXISTS checklist_missing_cargos,
  DROP COLUMN IF EXISTS checklist_missing_team_id,
  DROP COLUMN IF EXISTS checklist_missing_time,
  DROP COLUMN IF EXISTS checklist_missing_enabled;
