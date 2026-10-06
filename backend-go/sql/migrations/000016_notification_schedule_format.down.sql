ALTER TABLE work_shift_notification_schedules
  DROP COLUMN IF EXISTS email_format,
  DROP COLUMN IF EXISTS target_period;
