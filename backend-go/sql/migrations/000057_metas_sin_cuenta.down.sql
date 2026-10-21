DROP TRIGGER IF EXISTS trg_users_link_goals ON users;
DROP FUNCTION IF EXISTS link_goals_to_user();
-- Las metas de alguien sin cuenta no caben en el modelo anterior.
DELETE FROM goals WHERE scope = 'person' AND person_user_id IS NULL;
DROP INDEX IF EXISTS idx_goals_person_email;
ALTER TABLE goals DROP CONSTRAINT chk_goal_scope;
ALTER TABLE goals DROP COLUMN person_name, DROP COLUMN person_email;
ALTER TABLE goals ADD CONSTRAINT chk_goal_scope CHECK (
  (scope = 'client' AND client_id IS NOT NULL AND person_user_id IS NULL) OR
  (scope = 'area' AND area_id IS NOT NULL AND client_id IS NULL AND person_user_id IS NULL) OR
  (scope = 'person' AND person_user_id IS NOT NULL AND client_id IS NULL AND area_id IS NULL));
