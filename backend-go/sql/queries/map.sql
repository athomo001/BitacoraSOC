-- name: ListMapPoints :many
-- Mapa (#24): cada localidad con coordenadas y lo que hay que revisar en
-- ella. Un incidente o una ventana sobre un activo cuenta para la localidad
-- del activo; un ticket, por su lugar (000038). El país solo aparece si
-- tiene algo abierto.
WITH open_incidents AS (
  SELECT COALESCE(i.territorial_unit_id, a.territorial_unit_id) AS unit_id,
         count(*)::int AS total,
         (array_agg(i.title ORDER BY i.opened_at DESC))[1]::text AS last_title
  FROM escalation_incidents i
  LEFT JOIN assets a ON a.id = i.asset_id
  WHERE i.closed_at IS NULL AND COALESCE(i.territorial_unit_id, a.territorial_unit_id) IS NOT NULL
  GROUP BY 1
), open_tickets AS (
  SELECT t.territorial_unit_id AS unit_id,
         count(*)::int AS total,
         (array_agg(t.ticket_number || ' · ' || t.title ORDER BY t.created_at DESC))[1]::text AS last_title
  FROM tickets t
  WHERE t.territorial_unit_id IS NOT NULL AND t.merged_into_id IS NULL
    AND t.status NOT IN ('resolved', 'closed', 'cancelled')
  GROUP BY 1
), active_windows AS (
  SELECT COALESCE(m.territorial_unit_id, a.territorial_unit_id) AS unit_id,
         max(m.ends_at) AS ends_at,
         (array_agg(m.title ORDER BY m.ends_at DESC))[1]::text AS title
  FROM maintenance_windows m
  LEFT JOIN assets a ON a.id = m.asset_id
  WHERE m.active AND m.starts_at <= now() AND m.ends_at > now()
    AND COALESCE(m.territorial_unit_id, a.territorial_unit_id) IS NOT NULL
  GROUP BY 1
)
SELECT u.id, u.kind, u.name, u.latitude, u.longitude,
       p.name AS parent_name,
       COALESCE(oi.total, 0)::int AS open_incidents,
       oi.last_title AS last_incident_title,
       aw.ends_at::timestamptz AS maintenance_until,
       aw.title AS maintenance_title,
       COALESCE(ot.total, 0)::int AS open_tickets,
       ot.last_title AS last_ticket_title
FROM territorial_units u
LEFT JOIN territorial_units p ON p.id = u.parent_id
LEFT JOIN open_incidents oi ON oi.unit_id = u.id
LEFT JOIN active_windows aw ON aw.unit_id = u.id
LEFT JOIN open_tickets ot ON ot.unit_id = u.id
WHERE u.active AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
  AND (u.kind <> 'country' OR oi.unit_id IS NOT NULL OR aw.unit_id IS NOT NULL OR ot.unit_id IS NOT NULL)
ORDER BY u.path;

-- name: ListMapUnitIncidents :many
-- Incidentes abiertos de una localidad, directos o sobre sus activos.
SELECT i.id, i.title, i.glpi_ticket, i.opened_at, a.name AS asset_name
FROM escalation_incidents i
LEFT JOIN assets a ON a.id = i.asset_id
WHERE i.closed_at IS NULL
  AND (i.territorial_unit_id = sqlc.arg('unit_id')::uuid OR a.territorial_unit_id = sqlc.arg('unit_id')::uuid)
ORDER BY i.opened_at DESC
LIMIT 50;

-- name: ListMapUnitWindows :many
-- Ventanas de mantenimiento activas ahora en una localidad o sus activos.
SELECT m.id, m.title, m.ends_at, m.suppress_notifications, a.name AS asset_name
FROM maintenance_windows m
LEFT JOIN assets a ON a.id = m.asset_id
WHERE m.active AND m.starts_at <= now() AND m.ends_at > now()
  AND (m.territorial_unit_id = sqlc.arg('unit_id')::uuid OR a.territorial_unit_id = sqlc.arg('unit_id')::uuid)
ORDER BY m.ends_at;

-- name: ListMapUnitTeams :many
-- Equipos que cubren la localidad: los de ella o de un nivel de arriba.
SELECT DISTINCT ON (t.id) t.id, t.name, anc.name AS covered_via
FROM territorial_units u
JOIN territorial_units anc ON anc.path @> u.path
JOIN team_coverage tc ON tc.territorial_unit_id = anc.id
JOIN teams t ON t.id = tc.team_id AND t.active
WHERE u.id = sqlc.arg('unit_id')
ORDER BY t.id, nlevel(anc.path) DESC;

-- name: ListMapUnitTickets :many
-- Tickets abiertos con lugar en la localidad (000038), los más urgentes primero.
SELECT t.id, t.ticket_number, t.title, t.priority, t.status, a.name AS asset_name
FROM tickets t
LEFT JOIN assets a ON a.id = t.asset_id
WHERE t.territorial_unit_id = sqlc.arg('unit_id')::uuid AND t.merged_into_id IS NULL
  AND t.status NOT IN ('resolved', 'closed', 'cancelled')
ORDER BY t.priority, t.created_at DESC
LIMIT 50;
