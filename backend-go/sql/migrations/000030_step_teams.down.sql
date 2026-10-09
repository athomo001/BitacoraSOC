DROP TRIGGER IF EXISTS trg_escalation_steps_delete_team ON escalation_steps;
DROP FUNCTION IF EXISTS delete_step_team();
-- Los grupos de los pasos vuelven a ser equipos de escalamiento visibles
-- (las copias por paso se conservan: deshacerlas podría juntar personas que
-- ya se editaron por separado).
UPDATE teams SET kind = 'escalation' WHERE kind = 'step';
UPDATE teams SET active = true WHERE deactivated_by_org;
ALTER TABLE teams DROP COLUMN deactivated_by_org;
ALTER TABLE escalation_steps DROP COLUMN title;
