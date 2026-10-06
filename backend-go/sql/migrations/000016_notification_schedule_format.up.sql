-- 000016: el aviso periódico de dotación vuelve al correo del legacy
-- (ShiftNotificationSchedule): qué semana informa (la actual o la siguiente)
-- y el formato del correo. 'calendar' es la grilla "Personal Fuera de la
-- Oficina" (Lun–Vie); 'list' es la lista de guardias de escalamiento, que
-- llega con el rediseño de escalamiento.
ALTER TABLE work_shift_notification_schedules
  ADD COLUMN target_period TEXT NOT NULL DEFAULT 'current_week' CHECK (target_period IN ('current_week', 'next_week')),
  ADD COLUMN email_format TEXT NOT NULL DEFAULT 'calendar' CHECK (email_format IN ('calendar', 'list'));
