-- name: CreatePermissionGroup :one
INSERT INTO permission_groups (code, name, capabilities, profile, level_id)
VALUES ($1, $2, $3, sqlc.arg('profile'), sqlc.narg('level_id'))
RETURNING *;

-- name: ListPermissionGroups :many
SELECT * FROM permission_groups
WHERE (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY name;

-- name: GetPermissionGroup :one
SELECT * FROM permission_groups WHERE id = $1;

-- name: UpdatePermissionGroup :one
UPDATE permission_groups SET
  name = COALESCE(sqlc.narg('name'), name),
  profile = COALESCE(sqlc.narg('profile'), profile),
  level_id = CASE WHEN sqlc.arg('set_level')::bool THEN sqlc.narg('level_id')::uuid ELSE level_id END,
  capabilities = COALESCE(sqlc.narg('capabilities'), capabilities),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1
RETURNING *;

-- name: ReplaceUserPermissionGroups :exec
DELETE FROM user_permission_groups WHERE user_id = $1;

-- name: AddUserPermissionGroup :exec
INSERT INTO user_permission_groups (user_id, permission_group_id, assigned_by)
VALUES ($1, $2, $3);

-- name: ListUserPermissionGroups :many
SELECT pg.* FROM permission_groups pg
JOIN user_permission_groups upg ON upg.permission_group_id = pg.id
WHERE upg.user_id = $1 AND pg.active = true
ORDER BY pg.name;
