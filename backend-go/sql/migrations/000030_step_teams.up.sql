-- Llamados dentro de la política (canvas "Equipos y llamados de escalamiento",
-- aprobado 2026-10-07). Antes cada paso apuntaba a un equipo suelto y el ETL
-- creaba uno por llamado ("DPP · 1er Llamado"…), que llenaba Equipos.
--
-- 1) escalation_steps.title: el nombre del llamado ("1er llamado").
-- 2) teams.kind = 'step': el grupo de personas de UN paso. Pertenece a ese
--    paso (se edita en la política, se borra con él: trigger abajo), no es
--    de ninguna organización y no aparece en Equipos.
-- 3) teams.deactivated_by_org: desactivar una organización desactiva sus
--    equipos; reactivarla devuelve solo los que ella apagó.
ALTER TABLE escalation_steps ADD COLUMN title TEXT;
ALTER TABLE teams ADD COLUMN deactivated_by_org BOOLEAN NOT NULL DEFAULT false;

-- Datos existentes: un equipo de escalamiento que solo usan pasos (ni RACI,
-- ni guardias, ni tickets, ni cobertura) era un llamado. Pasa a ser del paso;
-- si lo compartían varios pasos (el ETL lo reutilizaba entre los servicios
-- del cliente), cada paso extra recibe su copia con las mismas personas.
DO $$
DECLARE
  t RECORD;
  s RECORD;
  first BOOLEAN;
  copy_id UUID;
  label TEXT;
BEGIN
  FOR t IN
    SELECT tm.*, o.name AS org_name FROM teams tm
    LEFT JOIN organizations o ON o.id = tm.organization_id
    WHERE tm.kind = 'escalation'
      AND EXISTS (SELECT 1 FROM escalation_steps st WHERE st.team_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM raci_assignments ra WHERE ra.team_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM rotation_cycles rc WHERE rc.team_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.assigned_team_id = tm.id)
      AND NOT EXISTS (SELECT 1 FROM team_coverage tc WHERE tc.team_id = tm.id)
  LOOP
    -- "DPP · 1er Llamado" en una política de DPP se lee "1er Llamado".
    label := t.name;
    IF t.org_name IS NOT NULL AND lower(split_part(t.name, ' · ', 1)) = lower(t.org_name) AND position(' · ' IN t.name) > 0 THEN
      label := substr(t.name, position(' · ' IN t.name) + 3);
    END IF;
    first := true;
    FOR s IN SELECT * FROM escalation_steps WHERE team_id = t.id ORDER BY policy_id, step_order LOOP
      IF first THEN
        UPDATE teams SET kind = 'step', organization_id = NULL, team_group_id = NULL WHERE id = t.id;
        UPDATE escalation_steps SET title = COALESCE(title, label) WHERE id = s.id;
        first := false;
      ELSE
        copy_id := gen_random_uuid();
        INSERT INTO teams (id, organization_id, team_group_id, name, slug, kind, audience, active)
        VALUES (copy_id, NULL, NULL, t.name, t.slug || '-' || substr(copy_id::text, 1, 8), 'step', t.audience, t.active);
        INSERT INTO team_members (team_id, user_id, contact_id, pool_id, recipient_type, role_in_team, priority, active)
        SELECT copy_id, user_id, contact_id, pool_id, recipient_type, role_in_team, priority, active
        FROM team_members WHERE team_id = t.id;
        UPDATE escalation_steps SET team_id = copy_id, title = COALESCE(title, label) WHERE id = s.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- El ETL armaba el paso 1 de cada servicio como "Servicio · Cliente" en modo
-- pool: era el aviso por correo a todos los PARA con los CC en copia.
UPDATE escalation_steps st SET title = 'Aviso por correo (PARA y CC)'
FROM teams tm
WHERE tm.id = st.team_id AND tm.kind = 'step' AND st.step_order = 1 AND st.mode = 'pool' AND st.title = tm.name;

-- Equipos de organizaciones ya desactivadas: quedan desactivados (y se
-- reactivan con ella).
UPDATE teams tm SET active = false, deactivated_by_org = true
FROM organizations o
WHERE o.id = tm.organization_id AND NOT o.active AND tm.active AND tm.kind <> 'step';

-- Un grupo de paso vive y muere con su paso: al borrar el paso (a mano, al
-- borrar la política o al eliminar el servicio) se borra su grupo.
CREATE FUNCTION delete_step_team() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM teams WHERE id = OLD.team_id AND kind = 'step'
    AND NOT EXISTS (SELECT 1 FROM escalation_steps WHERE team_id = OLD.team_id);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_escalation_steps_delete_team AFTER DELETE ON escalation_steps
  FOR EACH ROW EXECUTE FUNCTION delete_step_team();
