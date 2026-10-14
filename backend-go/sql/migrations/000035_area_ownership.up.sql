-- 9e (spec/16 §3.6, aprobado por el dueño 2026-10-14): cada guardia y cada
-- política de escalamiento tiene un área dueña. Esa área la ve (y su
-- jefatura la edita); el administrador ve todas.
--
-- Decisiones del dueño: «Guardia N2» y «Guardia N1_NO_HABIL» (y cualquier
-- otra guardia) quedan en SOC; «Guardia TI» pasa al área TI, que se crea si
-- no existe. Las políticas que existen (todas por servicio de cliente)
-- quedan en SOC.
INSERT INTO areas (code, name, sort_order, default_profile)
SELECT 'ti', 'TI', (SELECT COALESCE(max(sort_order), 0) + 10 FROM areas), 'resolutor'
WHERE EXISTS (SELECT 1 FROM teams WHERE kind = 'oncall' AND name = 'Guardia TI')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE teams ADD COLUMN area_id UUID REFERENCES areas(id) ON DELETE RESTRICT;
UPDATE teams SET area_id = 'a0000000-0000-4000-8000-000000000001' WHERE kind = 'oncall';
UPDATE teams SET area_id = (SELECT id FROM areas WHERE code = 'ti') WHERE kind = 'oncall' AND name = 'Guardia TI';
ALTER TABLE teams ADD CONSTRAINT chk_oncall_team_area CHECK (kind <> 'oncall' OR area_id IS NOT NULL);

ALTER TABLE escalation_policies
  ADD COLUMN area_id UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001' REFERENCES areas(id) ON DELETE RESTRICT;
CREATE INDEX idx_escalation_policies_area ON escalation_policies(area_id);
