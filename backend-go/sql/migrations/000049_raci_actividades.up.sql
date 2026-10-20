-- RACI por cliente con actividades (paridad con el legacy, raciEntries;
-- spec/12 pendiente 10, decisión del dueño 2026-10-20: falta para el corte).
-- En el legacy cada fila es una actividad (tópico, actividad, notas) con una
-- persona por letra R/A/C/I. Antes cada asignación guardaba el tema suelto
-- («tópico — actividad») y las notas se perdían; ahora la actividad tiene su
-- tabla y las letras cuelgan de ella. Cada letra apunta a un equipo: una
-- persona (equipo «raci» de un contacto), una lista o una guardia.
CREATE TABLE raci_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  topic TEXT NOT NULL DEFAULT '' CHECK (length(topic) <= 180),
  activity TEXT NOT NULL CHECK (length(trim(activity)) BETWEEN 1 AND 300),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Solo para el traspaso de abajo; se elimina al final.
  src_topic TEXT
);

-- Las asignaciones que ya existan (ETL anterior) traen «tópico — actividad».
INSERT INTO raci_activities (client_id, topic, activity, active, src_topic)
SELECT client_id,
  CASE WHEN position(' — ' IN topic) > 0 THEN split_part(topic, ' — ', 1) ELSE '' END,
  CASE WHEN position(' — ' IN topic) > 0 THEN substr(topic, position(' — ' IN topic) + 3) ELSE topic END,
  bool_or(active), topic
FROM raci_assignments
WHERE client_id IS NOT NULL
GROUP BY client_id, topic;

ALTER TABLE raci_assignments ADD COLUMN activity_id UUID REFERENCES raci_activities(id) ON DELETE CASCADE;
UPDATE raci_assignments ra SET activity_id = a.id
FROM raci_activities a
WHERE a.client_id = ra.client_id AND a.src_topic = ra.topic;
-- Sin cliente no había pantalla que las creara ni las mostrara.
DELETE FROM raci_assignments WHERE activity_id IS NULL;
-- Repetidas (misma letra y equipo en la misma actividad) quedan una.
DELETE FROM raci_assignments a USING raci_assignments b
WHERE a.activity_id = b.activity_id AND a.role = b.role AND a.team_id = b.team_id AND a.id > b.id;

ALTER TABLE raci_activities DROP COLUMN src_topic;
ALTER TABLE raci_assignments
  ALTER COLUMN activity_id SET NOT NULL,
  DROP COLUMN client_id,
  DROP COLUMN service_id,
  DROP COLUMN asset_id,
  DROP COLUMN topic,
  DROP COLUMN active;
ALTER TABLE raci_assignments ADD CONSTRAINT uq_raci_assignment UNIQUE (activity_id, role, team_id);
CREATE INDEX idx_raci_activities_client ON raci_activities(client_id) WHERE active;
CREATE INDEX idx_raci_assignments_team ON raci_assignments(team_id);
