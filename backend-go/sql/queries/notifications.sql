-- Notificaciones (spec/16 §4.5, 9.5, 000042).

-- name: InsertNotification :one
INSERT INTO notifications (user_id, kind, title, body, link, group_key, toast, browser)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id;

-- name: FindGroupedNotification :one
-- Un aviso igual sin leer y reciente: se suma a él en vez de crear otro.
SELECT id, count FROM notifications
WHERE user_id = $1 AND group_key = $2 AND read_at IS NULL
  AND updated_at > now() - make_interval(mins => sqlc.arg('minutes')::int)
ORDER BY updated_at DESC
LIMIT 1;

-- name: UpdateGroupedNotification :exec
UPDATE notifications SET count = $2, title = $3, body = $4, toast = $5, browser = $6, updated_at = now()
WHERE id = $1;

-- name: ListNotifications :many
SELECT id, kind, title, body, link, count, toast, browser, created_at, updated_at, read_at
FROM notifications
WHERE user_id = $1 AND (NOT sqlc.arg('only_unread')::bool OR read_at IS NULL)
ORDER BY updated_at DESC
LIMIT sqlc.arg('lim')::int;

-- name: CountUnreadNotifications :one
SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL;

-- name: MarkNotificationsRead :execrows
-- ids vacío = todas.
UPDATE notifications SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND (cardinality(sqlc.arg('ids')::uuid[]) = 0 OR id = ANY(sqlc.arg('ids')::uuid[]));

-- name: PurgeOldNotifications :execrows
DELETE FROM notifications WHERE updated_at < now() - make_interval(days => sqlc.arg('days')::int);

-- name: GetNotificationPrefs :one
SELECT prefs, digest, browser FROM notification_prefs WHERE user_id = $1;

-- name: ListNotificationPrefs :many
SELECT user_id, prefs, digest, browser FROM notification_prefs WHERE user_id = ANY(sqlc.arg('ids')::uuid[]);

-- name: UpsertNotificationPrefs :exec
INSERT INTO notification_prefs (user_id, prefs, digest, browser) VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, digest = EXCLUDED.digest, browser = EXCLUDED.browser, updated_at = now();

-- name: GetNotificationSettings :one
SELECT to_char(digest_time, 'HH24:MI')::text AS digest_time, locked_kinds, group_minutes, retention_days, last_digest_day
FROM notification_settings WHERE id;

-- name: UpdateNotificationSettings :exec
UPDATE notification_settings SET digest_time = sqlc.arg('digest_time')::text::time, locked_kinds = sqlc.arg('locked_kinds')::text[],
  group_minutes = sqlc.arg('group_minutes')::int, retention_days = sqlc.arg('retention_days')::int, updated_at = now()
WHERE id;

-- name: ClaimDigestDay :execrows
-- Solo un nodo envía el resumen del día: el que logra marcarlo.
UPDATE notification_settings SET last_digest_day = sqlc.arg('day')::date
WHERE id AND (last_digest_day IS NULL OR last_digest_day < sqlc.arg('day')::date);

-- name: ListNotifyUsers :many
SELECT id, COALESCE(NULLIF(full_name, ''), username)::text AS name, email, active
FROM users WHERE id = ANY(sqlc.arg('ids')::uuid[]);

-- name: ListActiveUserIDs :many
SELECT id FROM users WHERE active;

-- name: ListAdminUserIDs :many
SELECT id FROM users WHERE active AND role = 'admin';

-- name: ListAreaLeadUserIDs :many
SELECT DISTINCT upg.user_id
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active AND 'area:lead' = ANY(pg.capabilities)
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id AND pa.area_id = $1
JOIN users u ON u.id = upg.user_id AND u.active;

-- name: ListAreaMemberIDs :many
SELECT DISTINCT upg.user_id
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id AND pa.area_id = $1
JOIN users u ON u.id = upg.user_id AND u.active;

-- name: ListUserCapabilities :many
SELECT DISTINCT unnest(pg.capabilities)::text AS capability
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
WHERE upg.user_id = $1;

-- name: InsertAgendaAlert :execrows
INSERT INTO agenda_occurrence_alerts (occurrence_id, alert) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: ListOpenTicketsAssignedCount :many
-- Para el resumen diario: tickets abiertos por responsable o resolutor.
SELECT u AS user_id, count(*)::int AS open_tickets
FROM (
  SELECT t.assigned_user_id AS u FROM tickets t
  WHERE t.status NOT IN ('resolved', 'closed', 'cancelled') AND t.assigned_user_id IS NOT NULL
  UNION ALL
  SELECT r.user_id FROM ticket_resolvers r JOIN tickets t ON t.id = r.ticket_id
  WHERE t.status NOT IN ('resolved', 'closed', 'cancelled') AND r.user_id IS DISTINCT FROM t.assigned_user_id
) x
GROUP BY u;

-- ===== Avisos con acuse =====

-- name: CreateNotice :one
INSERT INTO notices (title, body, audience, publish_at, expires_at, created_by)
VALUES ($1, $2, $3, COALESCE(sqlc.narg('publish_at')::timestamptz, now()), $4, $5)
RETURNING id;

-- name: ListDueNotices :many
SELECT id, title, body, audience, created_by FROM notices WHERE NOT published AND publish_at <= now();

-- name: MarkNoticePublished :exec
UPDATE notices SET published = true WHERE id = $1;

-- name: InsertNoticeRecipient :execrows
INSERT INTO notice_recipients (notice_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: ListPendingNotices :many
-- Los que el usuario todavía no leyó, el más antiguo primero.
SELECT n.id, n.title, n.body, n.publish_at, COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS created_by_name
FROM notice_recipients r
JOIN notices n ON n.id = r.notice_id AND n.published AND (n.expires_at IS NULL OR n.expires_at > now())
LEFT JOIN users u ON u.id = n.created_by
WHERE r.user_id = $1 AND r.read_at IS NULL
ORDER BY n.publish_at, n.created_at;

-- name: MarkNoticeRead :execrows
UPDATE notice_recipients SET read_at = now() WHERE notice_id = $1 AND user_id = $2 AND read_at IS NULL;

-- name: ListSentNotices :many
SELECT n.id, n.title, n.body, n.audience, n.publish_at, n.expires_at, n.published, n.created_by,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS created_by_name,
  (SELECT count(*) FROM notice_recipients r WHERE r.notice_id = n.id)::int AS total,
  (SELECT count(*) FROM notice_recipients r WHERE r.notice_id = n.id AND r.read_at IS NOT NULL)::int AS read
FROM notices n
LEFT JOIN users u ON u.id = n.created_by
WHERE sqlc.arg('all')::bool OR n.created_by = sqlc.arg('user_id')::uuid
ORDER BY n.publish_at DESC
LIMIT 100;

-- name: GetNotice :one
SELECT id, title, body, created_by, published FROM notices WHERE id = $1;

-- name: ListNoticeRecipients :many
SELECT r.user_id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS name, u.email, r.read_at, r.reminded_at
FROM notice_recipients r JOIN users u ON u.id = r.user_id
WHERE r.notice_id = $1
ORDER BY r.read_at NULLS FIRST, name;

-- name: MarkNoticeReminded :exec
UPDATE notice_recipients SET reminded_at = now() WHERE notice_id = $1 AND read_at IS NULL;

-- ===== Ventanas de mantenimiento (avisos y Agenda) =====

-- name: ListWindowsToNotify :many
-- Ventanas que empezaron o terminaron y todavía no se avisaron, con el área
-- a la que se le avisa: la de la ventana, la del activo o la del equipo.
SELECT w.id, w.title, w.starts_at, w.ends_at, w.notified_start, w.notified_end, w.created_by,
  COALESCE(w.area_id, a.area_id, t.area_id, '00000000-0000-0000-0000-000000000000'::uuid) AS area_id
FROM maintenance_windows w
LEFT JOIN assets a ON a.id = w.asset_id
LEFT JOIN teams t ON t.id = w.team_id
WHERE w.active AND ((NOT w.notified_start AND w.starts_at <= now()) OR (NOT w.notified_end AND w.ends_at <= now()));

-- name: MarkWindowNotified :exec
UPDATE maintenance_windows SET notified_start = notified_start OR starts_at <= now(), notified_end = notified_end OR ends_at <= now()
WHERE id = $1;

-- name: ListWindowsBetween :many
-- Para el calendario de la Agenda: las ventanas activas que tocan el rango.
SELECT w.id, w.title, w.starts_at, w.ends_at, w.suppress_notifications, w.agenda_task_id,
  COALESCE(s.name, a.name, tu.name, o.name, ar.name, t.name, '')::text AS target_name,
  COALESCE(w.area_id, a.area_id, t.area_id, '00000000-0000-0000-0000-000000000000'::uuid) AS area_id, w.organization_id, s.organization_id AS service_org_id, a.client_id AS asset_client_id
FROM maintenance_windows w
LEFT JOIN services s ON s.id = w.service_id
LEFT JOIN assets a ON a.id = w.asset_id
LEFT JOIN territorial_units tu ON tu.id = w.territorial_unit_id
LEFT JOIN organizations o ON o.id = w.organization_id
LEFT JOIN areas ar ON ar.id = w.area_id
LEFT JOIN teams t ON t.id = w.team_id
WHERE w.active AND w.starts_at < sqlc.arg('to_at')::timestamptz AND w.ends_at > sqlc.arg('from_at')::timestamptz
ORDER BY w.starts_at;

-- name: ShiftTaskWindows :execrows
-- La tarea cambió de fecha: sus ventanas que todavía no empiezan se mueven igual.
UPDATE maintenance_windows SET starts_at = starts_at + make_interval(days => sqlc.arg('days')::int),
  ends_at = ends_at + make_interval(days => sqlc.arg('days')::int)
WHERE agenda_task_id = $1 AND active AND starts_at > now();

-- name: CloseMaintenanceWindow :one
-- Cerrar antes de tiempo: termina ahora y queda quién la cerró.
UPDATE maintenance_windows SET ends_at = now(), closed_at = now(), closed_by = $2, notified_end = false
WHERE id = $1 AND active AND starts_at <= now() AND ends_at > now()
RETURNING *;
