-- 000023: correos de cumpleaños (birthdayEmailScheduler del legacy;
-- comentario del dueño #21). Se mandan una vez al día, desde la hora
-- configurada (America/Santiago), con el correo del área en copia.
ALTER TABLE app_config
  ADD COLUMN birthday_emails_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN birthday_emails_time TEXT NOT NULL DEFAULT '09:00' CHECK (birthday_emails_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN birthday_emails_cc TEXT NOT NULL DEFAULT '',
  ADD COLUMN birthday_emails_last_date DATE;
