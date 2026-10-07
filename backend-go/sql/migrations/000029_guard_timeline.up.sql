-- 000029: guardias con hora exacta (pedido del dueño 2026-10-07, canvas
-- "Turnos: guardias (línea de tiempo)"). Antes un slot era de fecha a fecha
-- y el lunes de cambio quedaban dos personas de guardia todo el día; en el
-- legacy el cambio es a una hora (09:00). starts_at/ends_at mandan; las
-- columnas de fecha se mantienen (las leen el correo de dotación y Mi turno).
ALTER TABLE rotation_slots
  ADD COLUMN starts_at TIMESTAMPTZ,
  ADD COLUMN ends_at TIMESTAMPTZ;

UPDATE rotation_slots s SET
  starts_at = (s.week_start_date + time '09:00') AT TIME ZONE c.timezone,
  ends_at = ((CASE WHEN s.week_end_date > s.week_start_date THEN s.week_end_date ELSE s.week_start_date + 1 END) + time '09:00') AT TIME ZONE c.timezone
FROM rotation_cycles c
WHERE c.id = s.cycle_id;

ALTER TABLE rotation_slots
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  ADD CONSTRAINT chk_rotation_slot_range CHECK (ends_at > starts_at);
CREATE INDEX idx_rotation_slots_range ON rotation_slots(cycle_id, starts_at, ends_at);

-- Guardias que nunca pueden quedar sin nadie (decisión del dueño: N1 y N2).
-- La línea de tiempo marca sus huecos en rojo.
ALTER TABLE rotation_cycles ADD COLUMN must_be_covered BOOLEAN NOT NULL DEFAULT false;
UPDATE rotation_cycles c SET must_be_covered = true
FROM teams t
WHERE t.id = c.team_id AND t.name IN ('Guardia N2', 'Guardia N1_NO_HABIL');
