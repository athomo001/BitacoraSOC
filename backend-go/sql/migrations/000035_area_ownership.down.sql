ALTER TABLE escalation_policies DROP COLUMN area_id;
ALTER TABLE teams DROP CONSTRAINT chk_oncall_team_area;
ALTER TABLE teams DROP COLUMN area_id;
