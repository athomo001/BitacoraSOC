-- Calendario en Outlook (spec/16 §6.1, 9.7, 000044): suscripción ICS propia.

-- name: GetCalendarFeed :one
SELECT user_id, token_encrypted, include_windows, created_at, last_read_at FROM calendar_feeds WHERE user_id = $1;

-- name: UpsertCalendarFeed :exec
-- Generar uno nuevo deja inútil el anterior.
INSERT INTO calendar_feeds (user_id, token_hash, token_encrypted, include_windows) VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_encrypted = EXCLUDED.token_encrypted,
  created_at = now(), last_read_at = NULL;

-- name: SetCalendarFeedWindows :execrows
UPDATE calendar_feeds SET include_windows = $2 WHERE user_id = $1;

-- name: DeleteCalendarFeed :execrows
DELETE FROM calendar_feeds WHERE user_id = $1;

-- name: GetCalendarFeedByToken :one
-- Solo responde mientras la persona siga activa.
SELECT f.user_id, f.include_windows
FROM calendar_feeds f JOIN users u ON u.id = f.user_id AND u.active
WHERE f.token_hash = $1;

-- name: TouchCalendarFeed :exec
UPDATE calendar_feeds SET last_read_at = now() WHERE user_id = $1;

-- name: ListFeedOccurrences :many
-- Lo que está a nombre de la persona (decisión del dueño 2026-10-15: lo
-- ofrecido a su nivel que nadie tomó no va).
SELECT o.id, o.due_date, o.status, o.updated_at, t.name AS task_name, a.name AS area_name,
  COALESCE(org.name, '')::text AS organization_name
FROM agenda_occurrences o
JOIN agenda_tasks t ON t.id = o.task_id AND t.active
JOIN areas a ON a.id = t.area_id
LEFT JOIN organizations org ON org.id = t.organization_id
WHERE o.user_id = $1 AND o.status IN ('pending', 'done')
  AND o.due_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date
ORDER BY o.due_date;
