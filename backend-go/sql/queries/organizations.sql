-- name: ListOrganizations :many
-- clients_only: los de tipos que cuentan como cliente (Cliente, Mandante…).
SELECT o.*, v.name AS via_name
FROM organizations o
JOIN organization_types t ON t.code = o.type
LEFT JOIN organizations v ON v.id = o.via_organization_id
WHERE (sqlc.narg('type')::text IS NULL OR o.type = sqlc.narg('type'))
  AND (sqlc.narg('active')::boolean IS NULL OR o.active = sqlc.narg('active'))
  AND (NOT sqlc.arg('clients_only')::boolean OR t.is_client)
ORDER BY o.name;

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
  active = COALESCE(sqlc.narg('active'), active),
  via_organization_id = CASE WHEN sqlc.arg('set_via')::boolean THEN sqlc.narg('via_organization_id')::uuid ELSE via_organization_id END
WHERE id = $1
RETURNING *;

-- name: OrganizationDependents :one
-- Qué tiene asociado una organización antes de eliminarla: si hay algo, no se
-- borra (los contactos caerían en cascada) y se propone desactivarla.
SELECT
  (SELECT count(*) FROM services s WHERE s.organization_id = $1)::bigint AS services,
  (SELECT count(*) FROM contacts c WHERE c.organization_id = $1)::bigint AS contacts,
  (SELECT count(*) FROM tickets t WHERE t.client_id = $1)::bigint AS tickets,
  (SELECT count(*) FROM teams tm WHERE tm.organization_id = $1)::bigint AS teams,
  (SELECT count(*) FROM assets a WHERE a.client_id = $1 OR a.contractor_id = $1)::bigint AS assets,
  ((SELECT count(*) FROM team_groups g WHERE g.client_id = $1) + (SELECT count(*) FROM raci_assignments r WHERE r.client_id = $1))::bigint AS other;

-- name: DeleteOrganization :execrows
DELETE FROM organizations WHERE id = $1;

-- name: ListOrganizationTypes :many
SELECT t.*, (SELECT count(*) FROM organizations o WHERE o.type = t.code)::bigint AS organizations
FROM organization_types t
ORDER BY t.sort_order, t.name;

-- name: GetOrganizationType :one
SELECT * FROM organization_types WHERE code = $1;

-- name: CreateOrganizationType :one
INSERT INTO organization_types (code, name, description, is_client, sort_order)
VALUES ($1, $2, $3, $4, COALESCE((SELECT max(sort_order) FROM organization_types), 0) + 10)
RETURNING *;

-- name: UpdateOrganizationType :one
UPDATE organization_types SET
  name = COALESCE(sqlc.narg('name'), name),
  description = COALESCE(sqlc.narg('description'), description),
  is_client = COALESCE(sqlc.narg('is_client'), is_client)
WHERE code = $1
RETURNING *;

-- name: MoveOrganizationsToType :execrows
UPDATE organizations SET type = sqlc.arg('to_code') WHERE type = sqlc.arg('from_code');

-- name: DeleteOrganizationType :execrows
DELETE FROM organization_types WHERE code = $1 AND NOT system;
