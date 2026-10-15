-- Inventario (spec/16 §4.2, 9.2, 000040).

-- name: ListAssetKinds :many
SELECT * FROM asset_kinds ORDER BY sort_order, name;

-- name: GetAssetKind :one
SELECT * FROM asset_kinds WHERE code = $1;

-- name: UpsertAssetKind :one
-- Administración → Inventario: tipos y sus campos.
INSERT INTO asset_kinds (code, name, icon, base_type, fields, sort_order, active)
VALUES (sqlc.arg('code'), sqlc.arg('name'), sqlc.arg('icon'), sqlc.arg('base_type'), sqlc.arg('fields'), sqlc.arg('sort_order'), sqlc.arg('active'))
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, base_type = EXCLUDED.base_type,
  fields = EXCLUDED.fields, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active
RETURNING *;

-- name: ListResponsibilityTypes :many
SELECT * FROM responsibility_types ORDER BY sort_order, name;

-- name: UpsertResponsibilityType :one
INSERT INTO responsibility_types (code, name, sort_order, active)
VALUES (sqlc.arg('code'), sqlc.arg('name'), sqlc.arg('sort_order'), sqlc.arg('active'))
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active
RETURNING *;

-- name: ListInventory :many
-- La lista: los equipos de las áreas dadas (dueña o responsable); nil = todos.
SELECT a.id, a.name, a.code, a.kind_code, a.type, a.area_id, ar.name AS area_name, a.serial, a.model,
  a.attributes, a.active, tu.name AS place_name, a.glpi_id,
  COALESCE((SELECT host(i.address) FROM asset_ips i WHERE i.asset_id = a.id ORDER BY i.sort_order LIMIT 1), '')::text AS first_ip,
  (SELECT count(*) FROM asset_ips i WHERE i.asset_id = a.id)::int AS ip_count
FROM assets a
JOIN areas ar ON ar.id = a.area_id
LEFT JOIN territorial_units tu ON tu.id = a.territorial_unit_id
WHERE (sqlc.narg('areas')::uuid[] IS NULL OR a.area_id = ANY(sqlc.narg('areas')::uuid[])
       OR EXISTS (SELECT 1 FROM asset_responsibles r WHERE r.asset_id = a.id AND r.area_id = ANY(sqlc.narg('areas')::uuid[])))
  AND (sqlc.narg('kind')::text IS NULL OR a.kind_code = sqlc.narg('kind')::text)
  AND (sqlc.arg('include_inactive')::bool OR a.active)
  AND (NOT sqlc.arg('only_glpi')::bool OR a.glpi_id IS NOT NULL)
  AND (sqlc.narg('q')::text IS NULL
       OR a.name ILIKE '%' || sqlc.narg('q')::text || '%' OR a.code ILIKE '%' || sqlc.narg('q')::text || '%'
       OR a.serial ILIKE '%' || sqlc.narg('q')::text || '%'
       OR EXISTS (SELECT 1 FROM asset_ips i WHERE i.asset_id = a.id AND host(i.address) LIKE sqlc.narg('q')::text || '%'))
ORDER BY a.active DESC, a.name
LIMIT 1000;

-- name: GetInventoryAsset :one
SELECT a.id, a.name, a.code, a.kind_code, a.type, a.area_id, ar.name AS area_name, ar.code AS area_code,
  a.serial, a.model, a.rack, a.rack_position, a.attributes, a.metadata, a.active,
  a.territorial_unit_id, tu.name AS place_name, a.client_id, o.name AS client_name, a.created_at, a.updated_at,
  a.glpi_itemtype, a.glpi_id
FROM assets a
JOIN areas ar ON ar.id = a.area_id
LEFT JOIN territorial_units tu ON tu.id = a.territorial_unit_id
LEFT JOIN organizations o ON o.id = a.client_id
WHERE a.id = $1;

-- name: GetAssetIDByCode :one
SELECT id FROM assets WHERE code = $1;

-- name: CreateInventoryAsset :one
INSERT INTO assets (type, kind_code, name, code, area_id, territorial_unit_id, client_id, model, serial, rack, rack_position, attributes, metadata)
VALUES (sqlc.arg('type'), sqlc.arg('kind_code'), sqlc.arg('name'), sqlc.arg('code'), sqlc.arg('area_id'), sqlc.narg('territorial_unit_id'),
  sqlc.narg('client_id'), sqlc.narg('model'), sqlc.narg('serial'), sqlc.narg('rack'), sqlc.narg('rack_position'), sqlc.arg('attributes'), sqlc.arg('metadata'))
RETURNING id;

-- name: UpdateInventoryAsset :exec
UPDATE assets SET type = sqlc.arg('type'), kind_code = sqlc.arg('kind_code'), name = sqlc.arg('name'), area_id = sqlc.arg('area_id'),
  territorial_unit_id = sqlc.narg('territorial_unit_id'), client_id = sqlc.narg('client_id'), model = sqlc.narg('model'),
  serial = sqlc.narg('serial'), rack = sqlc.narg('rack'), rack_position = sqlc.narg('rack_position'),
  attributes = sqlc.arg('attributes'), metadata = sqlc.arg('metadata'), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SetAssetActive :exec
UPDATE assets SET active = sqlc.arg('active'), updated_at = now() WHERE id = sqlc.arg('id');

-- name: DeleteAsset :exec
DELETE FROM assets WHERE id = $1;

-- name: ListAssetIPs :many
SELECT id, kind, host(address)::text AS address, note FROM asset_ips WHERE asset_id = $1 ORDER BY sort_order;

-- name: ClearAssetIPs :exec
DELETE FROM asset_ips WHERE asset_id = $1;

-- name: AddAssetIP :exec
INSERT INTO asset_ips (asset_id, kind, address, note, sort_order)
VALUES (sqlc.arg('asset_id'), sqlc.arg('kind'), sqlc.arg('address')::text::inet, sqlc.narg('note'), sqlc.arg('sort_order'));

-- name: ListAssetResponsibles :many
SELECT r.id, r.type_code, rt.name AS type_name, r.area_id, ar.name AS area_name, r.user_id,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name, r.organization_id, o.name AS organization_name
FROM asset_responsibles r
JOIN responsibility_types rt ON rt.code = r.type_code
LEFT JOIN areas ar ON ar.id = r.area_id
LEFT JOIN users u ON u.id = r.user_id
LEFT JOIN organizations o ON o.id = r.organization_id
WHERE r.asset_id = $1
ORDER BY r.sort_order;

-- name: ClearAssetResponsibles :exec
DELETE FROM asset_responsibles WHERE asset_id = $1;

-- name: AddAssetResponsible :exec
INSERT INTO asset_responsibles (asset_id, type_code, area_id, user_id, organization_id, sort_order)
VALUES (sqlc.arg('asset_id'), sqlc.arg('type_code'), sqlc.narg('area_id'), sqlc.narg('user_id'), sqlc.narg('organization_id'), sqlc.arg('sort_order'));

-- name: ListAssetResponsibleAreas :many
-- Las áreas que trabajan un equipo: la dueña y las responsables.
SELECT x.area_id FROM assets x WHERE x.id = sqlc.arg('asset_id')::uuid
UNION
SELECT r.area_id FROM asset_responsibles r WHERE r.asset_id = sqlc.arg('asset_id')::uuid AND r.area_id IS NOT NULL;

-- name: ListAssetEvents :many
SELECT e.id, e.kind, e.description, e.happened_at, e.ticket_id, t.ticket_number,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name
FROM asset_events e
LEFT JOIN users u ON u.id = e.user_id
LEFT JOIN tickets t ON t.id = e.ticket_id
WHERE e.asset_id = $1
ORDER BY e.happened_at DESC, e.created_at DESC
LIMIT 500;

-- name: AddAssetEvent :exec
INSERT INTO asset_events (asset_id, kind, description, happened_at, user_id, ticket_id)
VALUES (sqlc.arg('asset_id'), sqlc.arg('kind'), sqlc.arg('description'), sqlc.arg('happened_at'), sqlc.narg('user_id'), sqlc.narg('ticket_id'));

-- name: ListAssetTickets :many
-- Los tickets que tuvieron este equipo como lugar.
SELECT t.id, t.ticket_number, t.title, t.status, t.priority, t.created_at, t.area_id, t.requested_area_id
FROM tickets t WHERE t.asset_id = sqlc.arg('asset_id')::uuid AND t.merged_into_id IS NULL
ORDER BY t.created_at DESC
LIMIT 200;

-- name: CreateAssetRequest :one
INSERT INTO asset_requests (asset_id, action, reason, requested_by)
VALUES (sqlc.arg('asset_id'), sqlc.arg('action'), sqlc.arg('reason'), sqlc.arg('requested_by'))
RETURNING id;

-- name: GetAssetRequest :one
SELECT * FROM asset_requests WHERE id = $1;

-- name: PendingAssetRequestExists :one
SELECT EXISTS (SELECT 1 FROM asset_requests WHERE asset_id = $1 AND status = 'pending') AS pending;

-- name: ListPendingAssetRequests :many
-- Solicitudes pendientes de los equipos de las áreas dadas (nil = todas, para el admin).
SELECT q.id, q.asset_id, a.name AS asset_name, a.code AS asset_code, q.action, q.reason, q.created_at,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS requested_by_name, ar.name AS area_name
FROM asset_requests q
JOIN assets a ON a.id = q.asset_id
JOIN areas ar ON ar.id = a.area_id
LEFT JOIN users u ON u.id = q.requested_by
WHERE q.status = 'pending' AND (sqlc.narg('areas')::uuid[] IS NULL OR a.area_id = ANY(sqlc.narg('areas')::uuid[]))
ORDER BY q.created_at;

-- name: DecideAssetRequest :exec
UPDATE asset_requests SET status = sqlc.arg('status'), decided_by = sqlc.arg('decided_by'), decided_at = now(), decision_note = sqlc.narg('decision_note')
WHERE id = sqlc.arg('id') AND status = 'pending';
