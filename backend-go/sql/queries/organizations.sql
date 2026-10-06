-- name: ListOrganizations :many
-- clients_only: los de tipos que cuentan como cliente (Cliente, Mandante…).
SELECT o.*, v.name AS via_name
FROM organizations o
JOIN organization_types t ON t.code = o.type
LEFT JOIN organizations v ON v.id = o.via_organization_id
WHERE o.archived_at IS NULL
  AND (sqlc.narg('type')::text IS NULL OR o.type = sqlc.narg('type'))
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

-- name: ListOrganizationTypes :many
SELECT t.*, (SELECT count(*) FROM organizations o WHERE o.type = t.code AND o.archived_at IS NULL)::bigint AS organizations
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

-- ===== Eliminar organización: popup con lo asociado (canvas v22) =====

-- name: ListOrgServicesForDelete :many
-- Historial = entradas, tickets o mantenciones: esos no se borran, se mueven.
SELECT s.id, s.name, s.code,
  (SELECT count(*) FROM entries e WHERE e.service_id = s.id)::bigint AS entries,
  (SELECT count(*) FROM tickets t WHERE t.service_id = s.id)::bigint AS tickets,
  (SELECT count(*) FROM maintenance_windows m WHERE m.service_id = s.id)::bigint AS windows
FROM services s WHERE s.organization_id = $1 ORDER BY s.name;

-- name: ListOrgTeamsForDelete :many
SELECT tm.id, tm.name,
  (SELECT count(*) FROM team_members m WHERE m.team_id = tm.id)::bigint AS members,
  (SELECT count(DISTINCT p.service_id) FROM escalation_steps st JOIN escalation_policies p ON p.id = st.policy_id WHERE st.team_id = tm.id)::bigint AS services,
  (SELECT count(*) FROM tickets t WHERE t.assigned_team_id = tm.id)::bigint AS tickets,
  (SELECT count(*) FROM rotation_cycles r WHERE r.team_id = tm.id)::bigint AS rotations
FROM teams tm WHERE tm.organization_id = $1 ORDER BY tm.name;

-- name: ListOrgAssetsForDelete :many
SELECT a.id, a.name, a.code, a.type::text AS type,
  (SELECT count(*) FROM entries e WHERE e.asset_id = a.id)::bigint AS entries,
  (SELECT count(*) FROM tickets t WHERE t.asset_id = a.id)::bigint AS tickets,
  (SELECT count(*) FROM maintenance_windows m WHERE m.asset_id = a.id)::bigint AS windows,
  (SELECT count(*) FROM assets c WHERE c.parent_asset_id = a.id)::bigint AS children
FROM assets a WHERE a.client_id = $1 OR a.contractor_id = $1 ORDER BY a.name;

-- name: ListOrgTicketsForDelete :many
SELECT id, ticket_number, title, status::text AS status, created_at
FROM tickets WHERE client_id = $1 ORDER BY created_at DESC;

-- name: CountOrgContacts :one
SELECT count(*) FROM contacts WHERE organization_id = $1;

-- name: MoveServiceToOrganization :execrows
UPDATE services SET organization_id = sqlc.arg('to_org') WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('from_org');

-- name: RenameService :execrows
UPDATE services SET name = sqlc.arg('name') WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('org');

-- name: DeleteServiceRaci :exec
-- Antes de borrar un servicio sin historial: su RACI y sus políticas de
-- escalamiento (los pasos caen con la política).
DELETE FROM raci_assignments WHERE service_id = $1;

-- name: DeleteServicePolicies :exec
DELETE FROM escalation_policies WHERE service_id = $1;

-- name: DeleteServiceWithoutHistory :execrows
DELETE FROM services s WHERE s.id = sqlc.arg('id') AND s.organization_id = sqlc.arg('org')
  AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.service_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.service_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM maintenance_windows m WHERE m.service_id = s.id);

-- name: MoveTeamToOrganization :execrows
UPDATE teams SET organization_id = sqlc.arg('to_org') WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('from_org');

-- name: RenameTeam :execrows
UPDATE teams SET name = sqlc.arg('name') WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('org');

-- name: DeleteTeamRaci :exec
-- Antes de borrar un equipo sin tickets ni rotaciones: lo saca de los
-- escalamientos y del RACI (integrantes y cobertura caen con él).
DELETE FROM raci_assignments WHERE team_id = $1;

-- name: DeleteTeamSteps :exec
DELETE FROM escalation_steps WHERE team_id = $1;

-- name: DeleteTeamWithoutHistory :execrows
DELETE FROM teams tm WHERE tm.id = sqlc.arg('id') AND tm.organization_id = sqlc.arg('org')
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.assigned_team_id = tm.id)
  AND NOT EXISTS (SELECT 1 FROM rotation_cycles rc WHERE rc.team_id = tm.id);

-- name: MoveAssetToOrganization :execrows
UPDATE assets SET
  client_id = CASE WHEN client_id = sqlc.arg('from_org') THEN sqlc.arg('to_org') ELSE client_id END,
  contractor_id = CASE WHEN contractor_id = sqlc.arg('from_org') THEN sqlc.arg('to_org') ELSE contractor_id END
WHERE id = sqlc.arg('id') AND (client_id = sqlc.arg('from_org') OR contractor_id = sqlc.arg('from_org'));

-- name: RenameAsset :execrows
UPDATE assets SET name = sqlc.arg('name') WHERE id = sqlc.arg('id') AND (client_id = sqlc.arg('org') OR contractor_id = sqlc.arg('org'));

-- name: DeleteAssetRaci :exec
DELETE FROM raci_assignments WHERE asset_id = $1;

-- name: DeleteAssetPolicies :exec
DELETE FROM escalation_policies WHERE asset_id = $1;

-- name: DeleteAssetWithoutHistory :execrows
DELETE FROM assets a WHERE a.id = sqlc.arg('id') AND (a.client_id = sqlc.arg('org') OR a.contractor_id = sqlc.arg('org'))
  AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.asset_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.asset_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM maintenance_windows m WHERE m.asset_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM assets c WHERE c.parent_asset_id = a.id);

-- name: MoveTicketToOrganization :execrows
UPDATE tickets SET client_id = sqlc.arg('to_org'), updated_at = now() WHERE id = sqlc.arg('id') AND client_id = sqlc.arg('from_org');

-- name: ReleaseOrganizationGroups :exec
-- Antes de archivar: los equipos dejan sus grupos, quien la tenía como
-- mandante queda sin mandante, y sus grupos y RACI se eliminan.
UPDATE teams SET team_group_id = NULL WHERE team_group_id IN (SELECT g.id FROM team_groups g WHERE g.client_id = $1);

-- name: ReleaseOrganizationVia :exec
UPDATE organizations SET via_organization_id = NULL WHERE via_organization_id = $1;

-- name: DeleteOrganizationRaci :exec
DELETE FROM raci_assignments WHERE client_id = $1;

-- name: DeleteOrganizationGroups :exec
DELETE FROM team_groups WHERE client_id = $1;

-- name: ArchiveOrganization :execrows
-- Solo si ya no tiene servicios, equipos ni activos; el código queda libre.
UPDATE organizations o SET archived_at = now(), active = false, code = o.code || '~' || substr(o.id::text, 1, 8)
WHERE o.id = $1 AND o.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM teams tm WHERE tm.organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.client_id = o.id OR a.contractor_id = o.id);
