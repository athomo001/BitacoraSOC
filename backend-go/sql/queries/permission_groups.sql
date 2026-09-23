-- name: CreatePermissionGroup :one
INSERT INTO permission_groups (code, name, module_scope, capabilities)
VALUES ($1, $2, $3, $4)
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
  module_scope = COALESCE(sqlc.narg('module_scope'), module_scope),
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
