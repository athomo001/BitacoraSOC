-- 000026: cada incidente de escalamiento tiene su entrada en la bitácora,
-- donde quedan solos los intentos, comentarios y el cierre (HU-1t punto 2).
ALTER TABLE escalation_incidents
  ADD COLUMN entry_id UUID REFERENCES entries(id) ON DELETE SET NULL;
