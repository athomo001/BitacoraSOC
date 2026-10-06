-- 000024: personas del turno (WorkShiftAssignment del legacy): quién trabaja
-- en cada turno y qué días de la semana. A ellas les llegan los recordatorios
-- de turno, como en el legacy (sin personas, a los correos del turno).
CREATE TABLE work_shift_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_shift_id UUID NOT NULL REFERENCES work_shifts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 0 = domingo … 6 = sábado.
  weekdays INT[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6] AND cardinality(weekdays) > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_shift_id, user_id)
);
CREATE INDEX idx_work_shift_members_shift ON work_shift_members(work_shift_id) WHERE active;
