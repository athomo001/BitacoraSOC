DROP TABLE IF EXISTS escalation_incident_notes;
ALTER TABLE escalation_action_logs DROP COLUMN IF EXISTS incident_id;
DROP TABLE IF EXISTS escalation_incidents;
DELETE FROM team_members WHERE pool_id IS NOT NULL;
ALTER TABLE team_members DROP CONSTRAINT chk_team_member_exactly_one;
ALTER TABLE team_members DROP COLUMN IF EXISTS pool_id;
ALTER TABLE team_members ADD CONSTRAINT chk_team_member_exactly_one CHECK (
  (user_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int = 1
);
DROP TABLE IF EXISTS escalation_pool_members;
DROP TABLE IF EXISTS escalation_pools;
ALTER TABLE escalation_policies DROP COLUMN IF EXISTS reminder;
