-- 000022: la alerta NOK del checklist avisa por CARGO, como el legacy
-- (alertNokRoleTarget eran cargos: "N2"), no por rol de la app. Uno o varios.
ALTER TABLE checklist_templates ADD COLUMN alert_nok_cargos TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE checklist_templates DROP COLUMN alert_nok_role_target;
