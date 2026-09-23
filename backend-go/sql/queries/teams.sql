-- name: ListTeamGroups :many
SELECT * FROM team_groups
WHERE (sqlc.narg('client_id')::uuid IS NULL OR client_id = sqlc.narg('client_id'))
  AND (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY name;

-- name: CreateTeamGroup :one
INSERT INTO team_groups (name, slug, client_id) VALUES ($1, $2, $3) RETURNING *;

-- name: ListTeams :many
SELECT t.*, o.name AS organization_name,
  (SELECT count(*) FROM team_members m WHERE m.team_id = t.id AND m.active)::int AS member_count
FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
WHERE (sqlc.narg('kind')::text IS NULL OR t.kind = sqlc.narg('kind'))
  AND (sqlc.narg('organization_id')::uuid IS NULL OR t.organization_id = sqlc.narg('organization_id'))
  AND (sqlc.narg('team_group_id')::uuid IS NULL OR t.team_group_id = sqlc.narg('team_group_id'))
  AND (sqlc.narg('audience')::team_audience IS NULL OR t.audience = sqlc.narg('audience'))
  AND (sqlc.narg('active')::boolean IS NULL OR t.active = sqlc.narg('active'))
ORDER BY t.name;

-- name: GetTeam :one
SELECT * FROM teams WHERE id = $1;

-- name: CreateTeam :one
INSERT INTO teams (name, slug, kind, organization_id, team_group_id, audience)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdateTeam :one
UPDATE teams SET
  name = COALESCE(sqlc.narg('name'), name),
  kind = COALESCE(sqlc.narg('kind'), kind),
  organization_id = COALESCE(sqlc.narg('organization_id'), organization_id),
  team_group_id = COALESCE(sqlc.narg('team_group_id'), team_group_id),
  audience = COALESCE(sqlc.narg('audience'), audience),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1
RETURNING *;

-- name: ListTeamMembers :many
-- Un miembro es un usuario interno O un contacto del directorio (CHECK
-- exactamente uno): se devuelve el nombre de cualquiera de los dos.
SELECT m.*, COALESCE(u.username, c.name, '')::text AS display_name
FROM team_members m
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts c ON c.id = m.contact_id
WHERE m.team_id = $1 AND m.active
ORDER BY m.priority, display_name;

-- name: AddTeamMember :one
INSERT INTO team_members (team_id, user_id, contact_id, recipient_type, role_in_team, priority)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: RemoveTeamMember :execrows
DELETE FROM team_members WHERE id = $1 AND team_id = $2;

-- name: ListTeamCoverage :many
SELECT tc.team_id, tc.territorial_unit_id, tc.priority, tu.name, tu.code, tu.kind
FROM team_coverage tc JOIN territorial_units tu ON tu.id = tc.territorial_unit_id
WHERE tc.team_id = $1
ORDER BY tc.priority, tu.path;

-- name: UpsertTeamCoverage :one
INSERT INTO team_coverage (team_id, territorial_unit_id, priority) VALUES ($1, $2, $3)
ON CONFLICT (team_id, territorial_unit_id) DO UPDATE SET priority = EXCLUDED.priority
RETURNING *;

-- name: RemoveTeamCoverage :execrows
DELETE FROM team_coverage WHERE team_id = $1 AND territorial_unit_id = $2;
