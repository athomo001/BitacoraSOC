-- 000025: largo mínimo de contraseña, configurable por el admin
-- (pedido del dueño 2026-10-07). 6 por defecto, igual que el legacy.
ALTER TABLE app_config
  ADD COLUMN password_min_length SMALLINT NOT NULL DEFAULT 6 CHECK (password_min_length BETWEEN 4 AND 64);
