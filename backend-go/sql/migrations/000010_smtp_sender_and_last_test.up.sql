-- Correo (Administración → Correo), paridad con el legacy (settings SMTP):
-- nombre visible del remitente ("Bitácora Ops <noc@empresa.cl>") y el
-- resultado de la última prueba de envío, para saber si el correo funciona
-- sin tener que mandar otra.
ALTER TABLE smtp_config ADD COLUMN from_name TEXT;
ALTER TABLE smtp_config ADD COLUMN last_test_at TIMESTAMPTZ;
ALTER TABLE smtp_config ADD COLUMN last_test_ok BOOLEAN;
ALTER TABLE smtp_config ADD COLUMN last_test_error TEXT;
