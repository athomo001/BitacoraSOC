-- Administración de checklist y de usuarios (pantalla aprobada "Administración").

-- La espera mínima entre checks del mismo turno pasa a minutos (el legacy la
-- configuraba en minutos). La columna en horas nunca se leyó: el backend usaba
-- 1 h fija, así que se arranca en 60 para no cambiar el comportamiento real.
ALTER TABLE app_config RENAME COLUMN shift_check_cooldown_hours TO shift_check_cooldown_minutes;
ALTER TABLE app_config ALTER COLUMN shift_check_cooldown_minutes SET DEFAULT 60;
UPDATE app_config SET shift_check_cooldown_minutes = 60;
ALTER TABLE app_config ADD CONSTRAINT chk_shift_check_cooldown_minutes CHECK (shift_check_cooldown_minutes BETWEEN 0 AND 1440);

-- "Último acceso" en Usuarios y grupos.
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
