-- Dos avisos por correo del legacy que faltaban (revisión de paridad,
-- decisiones del dueño 2026-10-16: «igual al legacy»).
--
-- 1. Checklist no realizado (checklistAlertScheduler del legacy): si a la
--    hora configurada (09:30) nadie hizo el checklist de inicio ese día, avisa
--    a quien esté de guardia en la guardia elegida (N1_NO_HABIL en el legacy)
--    y a las personas con los cargos elegidos (N2). Uno al día como máximo.
-- 2. Guardia sin cubrir (runEscalationInternalReminder): desde las 09:00, si
--    la semana que empieza dentro de N días (7) tiene una guardia marcada sin
--    nadie, avisa a las personas con los cargos elegidos (N2). Uno por semana
--    objetivo y por día como máximo. Apagado por defecto, como el legacy.
ALTER TABLE app_config
  ADD COLUMN checklist_missing_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN checklist_missing_time TEXT NOT NULL DEFAULT '09:30' CHECK (checklist_missing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN checklist_missing_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN checklist_missing_cargos TEXT[] NOT NULL DEFAULT '{N2}',
  ADD COLUMN checklist_missing_last_date DATE,
  ADD COLUMN guard_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN guard_reminder_days_ahead INT NOT NULL DEFAULT 7 CHECK (guard_reminder_days_ahead BETWEEN 1 AND 60),
  ADD COLUMN guard_reminder_cargos TEXT[] NOT NULL DEFAULT '{N2}',
  ADD COLUMN guard_reminder_last_date DATE,
  ADD COLUMN guard_reminder_last_week DATE;

UPDATE app_config SET checklist_missing_team_id = (
  SELECT id FROM teams WHERE kind = 'oncall' AND name = 'Guardia N1_NO_HABIL' ORDER BY id LIMIT 1);

-- Qué guardias revisa el recordatorio. Las del legacy (N2, TI y N1 no hábil).
ALTER TABLE rotation_cycles ADD COLUMN remind_uncovered BOOLEAN NOT NULL DEFAULT false;
UPDATE rotation_cycles c SET remind_uncovered = true
FROM teams t
WHERE t.id = c.team_id AND t.name IN ('Guardia N2', 'Guardia TI', 'Guardia N1_NO_HABIL');
