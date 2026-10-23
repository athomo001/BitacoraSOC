DROP TABLE IF EXISTS management_scopes;
DELETE FROM permission_groups WHERE department_id IS NOT NULL;
ALTER TABLE permission_groups DROP COLUMN IF EXISTS department_id;
ALTER TABLE areas DROP COLUMN IF EXISTS shares_team, DROP COLUMN IF EXISTS department_id;
DROP TABLE IF EXISTS departments;
