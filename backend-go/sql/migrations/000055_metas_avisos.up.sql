-- Gestión CSM (9.4, spec/16 §4.4.5): una meta avisa antes de vencer, igual
-- que una tarea de la Agenda (5 y 1 días hábiles antes, el día y si se
-- venció sin cumplirse). Cada aviso sale una sola vez.
CREATE TABLE goal_alerts (
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  alert TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, alert)
);
