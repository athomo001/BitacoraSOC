-- Imagen propia del correo de cumpleaños (pedido del dueño 2026-10-16).
-- Sin imagen propia se usa la incluida en la app.
ALTER TABLE app_config
  ADD COLUMN birthday_image BYTEA,
  ADD COLUMN birthday_image_type TEXT,
  ADD COLUMN birthday_image_updated_at TIMESTAMPTZ;
