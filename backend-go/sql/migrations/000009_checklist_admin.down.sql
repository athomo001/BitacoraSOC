ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE app_config DROP CONSTRAINT IF EXISTS chk_shift_check_cooldown_minutes;
ALTER TABLE app_config ALTER COLUMN shift_check_cooldown_minutes SET DEFAULT 4;
UPDATE app_config SET shift_check_cooldown_minutes = GREATEST(1, shift_check_cooldown_minutes / 60);
ALTER TABLE app_config RENAME COLUMN shift_check_cooldown_minutes TO shift_check_cooldown_hours;
