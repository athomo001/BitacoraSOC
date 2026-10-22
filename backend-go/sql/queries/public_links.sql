-- Enlaces públicos (10h): Administración → Enlaces públicos y lo que muestra
-- cada vista sin iniciar sesión. El token nunca se guarda: solo su SHA-256.

-- name: ListPublicLinks :many
SELECT l.id, l.slug, l.name, l.is_active, l.area_ids, l.organization_id, l.created_at, l.last_accessed_at,
  COALESCE(o.name, '')::text AS organization_name, COALESCE(u.username, '')::text AS created_by_name
FROM public_share_links l
LEFT JOIN organizations o ON o.id = l.organization_id
LEFT JOIN users u ON u.id = l.created_by
ORDER BY l.created_at;

-- name: CreatePublicLink :one
INSERT INTO public_share_links (slug, name, token_hash, created_by, area_ids, organization_id)
VALUES (sqlc.arg('slug'), sqlc.arg('name'), sqlc.arg('token_hash'), sqlc.arg('created_by'), sqlc.arg('area_ids'), sqlc.narg('organization_id'))
RETURNING *;

-- name: UpdatePublicLink :one
UPDATE public_share_links SET
  name = COALESCE(sqlc.narg('name'), name),
  is_active = COALESCE(sqlc.narg('is_active'), is_active)
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: DeletePublicLink :execrows
DELETE FROM public_share_links WHERE id = $1;

-- name: GetPublicLink :one
SELECT * FROM public_share_links WHERE id = $1;

-- name: ListPublicBoardTickets :many
-- Tablero de la Ticketera: los abiertos de esas áreas (de la que resuelve o
-- de la que lo pidió), primero el SLA de resolución que vence antes; los
-- que esperan al proveedor tienen el SLA en pausa.
SELECT t.ticket_number, t.title, t.status::text AS status, t.sla_resolution_due_at, t.sla_on_hold_since,
  COALESCE(o.name, '')::text AS client_name,
  COALESCE(NULLIF(u.full_name, ''), u.username, tm.name, '')::text AS assignee
FROM tickets t
LEFT JOIN organizations o ON o.id = t.client_id
LEFT JOIN users u ON u.id = t.assigned_user_id
LEFT JOIN teams tm ON tm.id = t.assigned_team_id
WHERE t.merged_into_id IS NULL
  AND t.status NOT IN ('resolved', 'closed', 'cancelled')
  AND (t.area_id = ANY(sqlc.arg('area_ids')::uuid[]) OR t.requested_area_id = ANY(sqlc.arg('area_ids')::uuid[]))
ORDER BY t.sla_on_hold_since IS NOT NULL, t.sla_resolution_due_at NULLS LAST, t.created_at
LIMIT 200;

-- name: ListPublicClientServices :many
-- Estado de un cliente: sus servicios activos con el incidente abierto más
-- antiguo y la ventana en curso (del servicio o de todo el cliente).
SELECT s.id, s.name,
  (SELECT min(i.opened_at) FROM escalation_incidents i WHERE i.service_id = s.id AND i.closed_at IS NULL)::timestamptz AS incident_since,
  (SELECT max(m.ends_at) FROM maintenance_windows m
    WHERE m.active AND m.starts_at <= now() AND m.ends_at > now()
      AND (m.service_id = s.id OR m.organization_id = s.organization_id))::timestamptz AS maintenance_until
FROM services s
WHERE s.organization_id = sqlc.arg('organization_id') AND s.active
ORDER BY s.name;

-- name: ListPublicClientWindows :many
-- Mantenimientos programados de un cliente en los próximos 30 días. Sin
-- servicio = todos sus servicios.
SELECT m.title, m.starts_at, m.ends_at, COALESCE(s.name, '')::text AS service_name
FROM maintenance_windows m
LEFT JOIN services s ON s.id = m.service_id
WHERE m.active AND m.starts_at > now() AND m.starts_at < now() + interval '30 days'
  AND (m.organization_id = sqlc.arg('organization_id') OR s.organization_id = sqlc.arg('organization_id'))
ORDER BY m.starts_at
LIMIT 50;

-- name: ListPublicClientRecent :many
-- Incidentes resueltos de los servicios del cliente en los últimos 7 días.
SELECT s.name AS service_name, i.opened_at, i.closed_at::timestamptz AS closed_at
FROM escalation_incidents i
JOIN services s ON s.id = i.service_id
WHERE s.organization_id = sqlc.arg('organization_id') AND i.closed_at IS NOT NULL AND i.closed_at > now() - interval '7 days'
ORDER BY i.closed_at DESC
LIMIT 20;

-- name: ListPublicMapIncidents :many
-- Mapa en TV: los incidentes abiertos con lugar, con su localidad.
SELECT u.name AS place, i.title, i.opened_at
FROM escalation_incidents i
LEFT JOIN assets a ON a.id = i.asset_id
JOIN territorial_units u ON u.id = COALESCE(i.territorial_unit_id, a.territorial_unit_id)
WHERE i.closed_at IS NULL
ORDER BY i.opened_at
LIMIT 50;

-- name: ListPublicMapWindows :many
-- Mapa en TV: los mantenimientos en curso con lugar.
SELECT u.name AS place, m.title, m.ends_at
FROM maintenance_windows m
LEFT JOIN assets a ON a.id = m.asset_id
JOIN territorial_units u ON u.id = COALESCE(m.territorial_unit_id, a.territorial_unit_id)
WHERE m.active AND m.starts_at <= now() AND m.ends_at > now()
ORDER BY m.ends_at
LIMIT 50;

-- name: GetTeamMemberPublicName :one
-- En las TV, el nombre completo de quien está de guardia (sin él, su usuario).
SELECT COALESCE(NULLIF(u.full_name, ''), u.username, c.name, '')::text
FROM team_members m
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts c ON c.id = m.contact_id
WHERE m.id = $1;
