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
  a.attributes, a.active, tu.name AS place_name, a.glpi_id, g.name AS group_name, a.client_id, o.name AS client_name,
  COALESCE((SELECT host(i.address) FROM asset_ips i WHERE i.asset_id = a.id ORDER BY i.sort_order LIMIT 1), '')::text AS first_ip,
  (SELECT count(*) FROM asset_ips i WHERE i.asset_id = a.id)::int AS ip_count
FROM assets a
JOIN areas ar ON ar.id = a.area_id
LEFT JOIN territorial_units tu ON tu.id = a.territorial_unit_id
LEFT JOIN asset_groups g ON g.id = a.group_id
LEFT JOIN organizations o ON o.id = a.client_id
WHERE (sqlc.narg('areas')::uuid[] IS NULL OR a.area_id = ANY(sqlc.narg('areas')::uuid[])
       OR EXISTS (SELECT 1 FROM asset_responsibles r WHERE r.asset_id = a.id AND r.area_id = ANY(sqlc.narg('areas')::uuid[])))
  AND (sqlc.narg('kind')::text IS NULL OR a.kind_code = sqlc.narg('kind')::text)
  AND (sqlc.arg('include_inactive')::bool OR a.active)
  AND (NOT sqlc.arg('only_glpi')::bool OR a.glpi_id IS NOT NULL)
  AND (sqlc.narg('group_id')::uuid IS NULL OR a.group_id = sqlc.narg('group_id')::uuid)
  AND (sqlc.narg('q')::text IS NULL
       OR a.name ILIKE '%' || sqlc.narg('q')::text || '%' OR a.code ILIKE '%' || sqlc.narg('q')::text || '%'
       OR a.serial ILIKE '%' || sqlc.narg('q')::text || '%' OR g.name ILIKE '%' || sqlc.narg('q')::text || '%'
       OR EXISTS (SELECT 1 FROM asset_ips i WHERE i.asset_id = a.id AND host(i.address) LIKE sqlc.narg('q')::text || '%'))
ORDER BY a.active DESC, a.name
LIMIT 1000;

-- name: GetInventoryAsset :one
SELECT a.id, a.name, a.code, a.kind_code, a.type, a.area_id, ar.name AS area_name, ar.code AS area_code,
  a.serial, a.model, a.rack, a.rack_position, a.attributes, a.metadata, a.active,
  a.territorial_unit_id, tu.name AS place_name, a.client_id, o.name AS client_name, a.created_at, a.updated_at,
  a.glpi_itemtype, a.glpi_id, a.address, a.latitude, a.longitude, a.group_id, g.name AS group_name
FROM assets a
JOIN areas ar ON ar.id = a.area_id
LEFT JOIN territorial_units tu ON tu.id = a.territorial_unit_id
LEFT JOIN organizations o ON o.id = a.client_id
LEFT JOIN asset_groups g ON g.id = a.group_id
WHERE a.id = $1;

-- name: GetAssetIDByCode :one
SELECT id FROM assets WHERE code = $1;

-- name: CreateInventoryAsset :one
INSERT INTO assets (type, kind_code, name, code, area_id, territorial_unit_id, client_id, model, serial, rack, rack_position, attributes, metadata,
  address, latitude, longitude, group_id)
VALUES (sqlc.arg('type'), sqlc.arg('kind_code'), sqlc.arg('name'), sqlc.arg('code'), sqlc.arg('area_id'), sqlc.narg('territorial_unit_id'),
  sqlc.narg('client_id'), sqlc.narg('model'), sqlc.narg('serial'), sqlc.narg('rack'), sqlc.narg('rack_position'), sqlc.arg('attributes'), sqlc.arg('metadata'),
  sqlc.narg('address'), sqlc.narg('latitude'), sqlc.narg('longitude'), sqlc.narg('group_id'))
RETURNING id;

-- name: UpdateInventoryAsset :exec
UPDATE assets SET type = sqlc.arg('type'), kind_code = sqlc.arg('kind_code'), name = sqlc.arg('name'), area_id = sqlc.arg('area_id'),
  territorial_unit_id = sqlc.narg('territorial_unit_id'), client_id = sqlc.narg('client_id'), model = sqlc.narg('model'),
  serial = sqlc.narg('serial'), rack = sqlc.narg('rack'), rack_position = sqlc.narg('rack_position'),
  attributes = sqlc.arg('attributes'), metadata = sqlc.arg('metadata'), address = sqlc.narg('address'),
  latitude = sqlc.narg('latitude'), longitude = sqlc.narg('longitude'), group_id = sqlc.narg('group_id'), updated_at = now()
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

-- ===== Grupos de equipos (000061) =====

-- name: ListAssetGroups :many
-- Los grupos con su ubicación y cuántos equipos activos tienen.
SELECT g.id, g.name, g.area_id, ar.code AS area_code, ar.name AS area_name, g.territorial_unit_id, tu.name AS place_name,
  g.address, g.latitude, g.longitude, g.rack, g.client_id, o.name AS client_name,
  (SELECT count(*) FROM assets a WHERE a.group_id = g.id AND a.active)::int AS asset_count
FROM asset_groups g
JOIN areas ar ON ar.id = g.area_id
LEFT JOIN territorial_units tu ON tu.id = g.territorial_unit_id
LEFT JOIN organizations o ON o.id = g.client_id
ORDER BY lower(g.name);

-- name: GetAssetGroup :one
SELECT * FROM asset_groups WHERE id = $1;

-- name: CreateAssetGroup :one
INSERT INTO asset_groups (name, area_id, territorial_unit_id, address, latitude, longitude, rack, client_id)
VALUES (sqlc.arg('name'), sqlc.arg('area_id'), sqlc.narg('territorial_unit_id'), sqlc.narg('address'), sqlc.narg('latitude'), sqlc.narg('longitude'), sqlc.narg('rack'),
  sqlc.narg('client_id'))
RETURNING id;

-- name: UpdateAssetGroup :exec
UPDATE asset_groups SET name = sqlc.arg('name'), area_id = sqlc.arg('area_id'), territorial_unit_id = sqlc.narg('territorial_unit_id'),
  address = sqlc.narg('address'), latitude = sqlc.narg('latitude'), longitude = sqlc.narg('longitude'), rack = sqlc.narg('rack'),
  client_id = sqlc.narg('client_id'), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: DeleteAssetGroup :exec
-- Sus equipos quedan sin grupo y con la ubicación que tenían.
DELETE FROM asset_groups WHERE id = $1;

-- name: ApplyAssetGroupLocation :many
-- El grupo cambió de lugar: sus equipos lo siguen (y los que no tienen
-- cliente toman el del grupo). Devuelve los que cambiaron.
UPDATE assets a SET territorial_unit_id = g.territorial_unit_id, address = g.address, latitude = g.latitude,
  longitude = g.longitude, rack = g.rack, client_id = COALESCE(a.client_id, g.client_id), updated_at = now()
FROM asset_groups g
WHERE g.id = sqlc.arg('group_id')::uuid AND a.group_id = g.id
  AND (a.territorial_unit_id IS DISTINCT FROM g.territorial_unit_id OR a.address IS DISTINCT FROM g.address
       OR a.latitude IS DISTINCT FROM g.latitude OR a.longitude IS DISTINCT FROM g.longitude OR a.rack IS DISTINCT FROM g.rack
       OR (a.client_id IS NULL AND g.client_id IS NOT NULL))
RETURNING a.id;

-- name: ListAssetGroupAreas :many
-- Las áreas de los equipos de un grupo (dueñas y responsables).
SELECT DISTINCT a.area_id FROM assets a WHERE a.group_id = sqlc.arg('group_id')::uuid
UNION
SELECT r.area_id FROM asset_responsibles r JOIN assets a ON a.id = r.asset_id
WHERE a.group_id = sqlc.arg('group_id')::uuid AND r.area_id IS NOT NULL;

-- name: ListMapAssets :many
-- Mapa: los equipos activos con coordenadas propias (o de su grupo), de las
-- áreas dadas (dueña o responsable); nil = todos. Con lo que los afecta:
-- tickets abiertos (si la Ticketera está encendida y el usuario los ve),
-- incidentes de escalamiento abiertos, entradas de incidente de la Bitácora
-- (con seguimiento abierto o de las últimas 24 h) y mantenimiento activo.
SELECT a.id, a.name, a.code, a.kind_code, a.type, a.latitude, a.longitude, a.address, g.name AS group_name, tu.name AS place_name,
  a.client_id, o.name AS client_name,
  tk.total AS open_tickets, tk.last_id AS ticket_id, tk.last_number AS ticket_number, tk.last_title AS ticket_title,
  tk.last_status AS ticket_status, tk.last_priority AS ticket_priority,
  inc.total AS open_incidents, inc.last_title AS incident_title, inc.last_opened AS incident_opened_at,
  en.total AS incident_entries, en.last_id AS entry_id, en.last_content AS entry_content, en.last_at AS entry_at, en.last_author AS entry_author,
  COALESCE(mw.title, '')::text AS maintenance_title, mw.ends_at AS maintenance_until
FROM assets a
LEFT JOIN asset_groups g ON g.id = a.group_id
LEFT JOIN territorial_units tu ON tu.id = a.territorial_unit_id
LEFT JOIN organizations o ON o.id = a.client_id
CROSS JOIN LATERAL (
  SELECT count(*)::int AS total,
    COALESCE((array_agg(t.id ORDER BY t.created_at DESC))[1], '00000000-0000-0000-0000-000000000000')::uuid AS last_id,
    COALESCE((array_agg(t.ticket_number ORDER BY t.created_at DESC))[1], '')::text AS last_number,
    COALESCE((array_agg(t.title ORDER BY t.created_at DESC))[1], '')::text AS last_title,
    COALESCE((array_agg(t.status::text ORDER BY t.created_at DESC))[1], '')::text AS last_status,
    COALESCE((array_agg(t.priority::text ORDER BY t.created_at DESC))[1], '')::text AS last_priority
  FROM tickets t
  WHERE sqlc.arg('with_tickets')::bool AND t.asset_id = a.id AND t.merged_into_id IS NULL
    AND t.status NOT IN ('resolved', 'closed', 'cancelled')
    AND (sqlc.narg('visible_areas')::uuid[] IS NULL OR t.area_id = ANY(sqlc.narg('visible_areas')::uuid[]) OR t.requested_area_id = ANY(sqlc.narg('visible_areas')::uuid[]))
) tk
CROSS JOIN LATERAL (
  SELECT count(*)::int AS total,
    COALESCE((array_agg(i.title ORDER BY i.opened_at DESC))[1], '')::text AS last_title,
    max(i.opened_at)::timestamptz AS last_opened
  FROM escalation_incidents i WHERE i.asset_id = a.id AND i.closed_at IS NULL
) inc
CROSS JOIN LATERAL (
  SELECT count(*)::int AS total,
    COALESCE((array_agg(e.id ORDER BY e.created_at DESC))[1], '00000000-0000-0000-0000-000000000000')::uuid AS last_id,
    COALESCE((array_agg(left(e.content, 240) ORDER BY e.created_at DESC))[1], '')::text AS last_content,
    max(e.created_at)::timestamptz AS last_at,
    COALESCE((array_agg(COALESCE(NULLIF(u.full_name, ''), u.username) ORDER BY e.created_at DESC))[1], '')::text AS last_author
  FROM entries e JOIN users u ON u.id = e.user_id
  WHERE e.asset_id = a.id AND e.entry_type = 'incidente'
    AND (e.follow_up_open OR e.created_at > now() - interval '24 hours')
) en
LEFT JOIN LATERAL (
  SELECT m.title, m.ends_at FROM maintenance_windows m
  WHERE m.asset_id = a.id AND m.active AND m.starts_at <= now() AND m.ends_at > now()
  ORDER BY m.ends_at DESC LIMIT 1
) mw ON true
WHERE a.active AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
  AND (sqlc.narg('areas')::uuid[] IS NULL OR a.area_id = ANY(sqlc.narg('areas')::uuid[])
       OR EXISTS (SELECT 1 FROM asset_responsibles r WHERE r.asset_id = a.id AND r.area_id = ANY(sqlc.narg('areas')::uuid[])))
ORDER BY a.name
LIMIT 5000;

-- name: ListAssetGroupAssetIDs :many
SELECT id FROM assets WHERE group_id = $1;
