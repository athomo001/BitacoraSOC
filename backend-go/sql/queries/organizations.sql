-- name: ListOrganizations :many
SELECT * FROM organizations
WHERE (sqlc.narg('type')::organization_type IS NULL OR type = sqlc.narg('type'))
  AND (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY name;

-- name: GetOrganization :one
SELECT * FROM organizations WHERE id = $1;

-- name: FindOrganizationByNameOrCode :one
-- Import CSV: la columna "Empresa" trae lo que el analista escribió; se acepta
-- tanto el nombre como el código, sin distinguir mayúsculas.
SELECT * FROM organizations
WHERE active AND (lower(name) = lower(sqlc.arg('ref')::text) OR lower(code) = lower(sqlc.arg('ref')::text))
ORDER BY (lower(code) = lower(sqlc.arg('ref')::text)) DESC
LIMIT 1;

-- name: CreateOrganization :one
INSERT INTO organizations (name, code, type) VALUES ($1, $2, $3) RETURNING *;

-- name: UpdateOrganization :one
UPDATE organizations SET
  name = COALESCE(sqlc.narg('name'), name),
  code = COALESCE(sqlc.narg('code'), code),
  type = COALESCE(sqlc.narg('type'), type),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1
RETURNING *;
