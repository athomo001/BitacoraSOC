-- Metas por persona con escalones y resultado (diseño y propuestas aprobados
-- por el dueño, 2026-10-21): primaria, secundaria y terciaria; una meta
-- termina lograda o no lograda (con el motivo); la regla de la persona decide
-- si, al lograr una, las demás dejan de hacer falta.

ALTER TABLE goals DROP CONSTRAINT goals_bonus_rank_check;
ALTER TABLE goals ADD CONSTRAINT goals_bonus_rank_check CHECK (bonus_rank IN ('primary', 'secondary', 'tertiary'));

-- Lograda sigue siendo completed_at (y confirmed_at en las de escalón).
-- outcome: no lograda (la marca la jefatura con el motivo) o no hace falta
-- (la cierra la regla de la persona); NULL = sin cerrar por eso.
ALTER TABLE goals
  ADD COLUMN outcome TEXT CHECK (outcome IN ('not_achieved', 'not_needed')),
  ADD COLUMN outcome_reason TEXT CHECK (length(outcome_reason) <= 300),
  ADD COLUMN outcome_at TIMESTAMPTZ,
  ADD COLUMN outcome_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- La regla de cada persona; sin fila = «Todas cuentan».
CREATE TABLE goal_person_rules (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rule TEXT NOT NULL CHECK (rule IN ('any', 'primary', 'secondary')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
