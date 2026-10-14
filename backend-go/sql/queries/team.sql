-- Mi equipo: la jefatura de área (spec/16 §3.5, 9d). Un grupo con la
-- capacidad area:lead es jefe de las áreas de ese grupo.

-- name: ListLeadAreas :many
SELECT DISTINCT a.id, a.code, a.name
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active AND 'area:lead' = ANY(pg.capabilities)
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
JOIN areas a ON a.id = pa.area_id AND a.active
WHERE upg.user_id = $1
ORDER BY a.name;

-- name: ListActiveAreas :many
SELECT id, code, name FROM areas WHERE active ORDER BY name;

-- name: ListAreaGroups :many
-- Los grupos activos de un área, con todas sus áreas y su nivel: el handler
-- decide cuáles puede asignar la jefatura (los que no salen de sus áreas).
SELECT pg.id, pg.name, pg.capabilities, COALESCE(l.name, '')::text AS level_name,
  array_agg(a.code ORDER BY a.code)::text[] AS area_codes
FROM permission_groups pg
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
JOIN areas a ON a.id = pa.area_id
LEFT JOIN levels l ON l.id = pg.level_id
WHERE pg.active AND EXISTS (
  SELECT 1 FROM permission_group_areas x WHERE x.permission_group_id = pg.id AND x.area_id = sqlc.arg('area_id')::uuid)
GROUP BY pg.id, l.name, l.rank
ORDER BY l.rank NULLS LAST, pg.name;

-- name: ListAreaPeople :many
-- Las personas con algún grupo del área (también las dadas de baja, para
-- reactivarlas), con sus tickets abiertos y vencidos (mismo "vencido" que
-- TicketQueueSummary): los asignados y en los que es resolutor.
SELECT u.id, u.username, COALESCE(u.full_name, '')::text AS full_name, u.email, u.role, u.active,
  (SELECT count(*) FROM tickets t
   WHERE t.status NOT IN ('resolved', 'closed', 'cancelled')
     AND (t.assigned_user_id = u.id OR EXISTS (SELECT 1 FROM ticket_resolvers r WHERE r.ticket_id = t.id AND r.user_id = u.id)))::bigint AS open_tickets,
  (SELECT count(*) FROM tickets t
   WHERE t.status NOT IN ('resolved', 'closed', 'cancelled') AND t.sla_on_hold_since IS NULL
     AND t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds) < sqlc.arg('now')::timestamptz
     AND (t.assigned_user_id = u.id OR EXISTS (SELECT 1 FROM ticket_resolvers r WHERE r.ticket_id = t.id AND r.user_id = u.id)))::bigint AS breached_tickets
FROM users u
WHERE EXISTS (
  SELECT 1 FROM user_permission_groups upg
  JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
  JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
  WHERE upg.user_id = u.id AND pa.area_id = sqlc.arg('area_id')::uuid)
ORDER BY u.active DESC, COALESCE(NULLIF(u.full_name, ''), u.username);

-- name: ListAreaPeopleGroups :many
SELECT upg.user_id, pg.id, pg.name
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id AND pa.area_id = $1
ORDER BY pg.name;

-- name: ListUserGroupsWithAreas :many
-- Todos los grupos activos de una persona con sus áreas (vacío = grupo sin
-- área): para saber si la jefatura puede tocarla.
SELECT pg.id, pg.capabilities,
  COALESCE(array_agg(a.code ORDER BY a.code) FILTER (WHERE a.code IS NOT NULL), '{}')::text[] AS area_codes
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
LEFT JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
LEFT JOIN areas a ON a.id = pa.area_id
WHERE upg.user_id = $1
GROUP BY pg.id;

-- name: RemoveUserPermissionGroup :exec
DELETE FROM user_permission_groups WHERE user_id = $1 AND permission_group_id = $2;

-- name: CreateTeamUser :one
INSERT INTO users (username, email, full_name, password_hash, role, must_change_password)
VALUES ($1, $2, $3, $4, 'user', true)
RETURNING *;

-- name: SetUserActive :one
UPDATE users SET active = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: ListPersonOpenTickets :many
SELECT t.id, t.ticket_number, t.title, t.status,
  (t.sla_on_hold_since IS NULL
   AND t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds) < sqlc.arg('now')::timestamptz)::bool AS breached
FROM tickets t
WHERE t.status NOT IN ('resolved', 'closed', 'cancelled')
  AND (t.assigned_user_id = sqlc.arg('user_id')::uuid
       OR EXISTS (SELECT 1 FROM ticket_resolvers r WHERE r.ticket_id = t.id AND r.user_id = sqlc.arg('user_id')::uuid))
ORDER BY t.sla_resolution_due_at NULLS LAST
LIMIT 20;

