-- Vuelve al tema suelto por asignación («tópico — actividad»); las notas se pierden.
DROP INDEX IF EXISTS idx_raci_assignments_team;
ALTER TABLE raci_assignments DROP CONSTRAINT IF EXISTS uq_raci_assignment;
ALTER TABLE raci_assignments
  ADD COLUMN client_id UUID REFERENCES organizations(id),
  ADD COLUMN service_id UUID REFERENCES services(id),
  ADD COLUMN asset_id UUID REFERENCES assets(id),
  ADD COLUMN topic TEXT,
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
UPDATE raci_assignments ra SET
  client_id = a.client_id,
  topic = CASE WHEN a.topic = '' THEN a.activity ELSE a.topic || ' — ' || a.activity END,
  active = a.active
FROM raci_activities a
WHERE a.id = ra.activity_id;
ALTER TABLE raci_assignments ALTER COLUMN topic SET NOT NULL, DROP COLUMN activity_id;
DROP TABLE raci_activities;
