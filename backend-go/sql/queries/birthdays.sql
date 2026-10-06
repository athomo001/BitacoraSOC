-- ===== Correos de cumpleaños (comentario del dueño #21) =====

-- name: GetBirthdayConfig :one
SELECT birthday_emails_enabled, birthday_emails_time, birthday_emails_cc, birthday_emails_last_date FROM app_config LIMIT 1;

-- name: UpdateBirthdayConfig :one
-- Cambiar la hora o volver a encenderlo permite enviar de nuevo hoy (como el legacy).
UPDATE app_config SET
  birthday_emails_last_date = CASE
    WHEN birthday_emails_time <> sqlc.arg('time')::text OR (sqlc.arg('enabled')::boolean AND NOT birthday_emails_enabled) THEN NULL
    ELSE birthday_emails_last_date END,
  birthday_emails_enabled = sqlc.arg('enabled')::boolean,
  birthday_emails_time = sqlc.arg('time')::text,
  birthday_emails_cc = sqlc.arg('cc')::text
RETURNING birthday_emails_enabled, birthday_emails_time, birthday_emails_cc, birthday_emails_last_date;

-- name: MarkBirthdayEmailsSent :exec
UPDATE app_config SET birthday_emails_last_date = sqlc.arg('day')::date;

-- name: ListBirthdayUsers :many
-- Usuarios activos que cumplen años ese día (mes y día) y tienen correo.
SELECT id, username, COALESCE(NULLIF(trim(full_name), ''), username)::text AS display_name, email::text AS email
FROM users
WHERE active = true AND birthday IS NOT NULL AND email IS NOT NULL AND trim(email) <> ''
  AND EXTRACT(MONTH FROM birthday) = sqlc.arg('month')::int AND EXTRACT(DAY FROM birthday) = sqlc.arg('day')::int
ORDER BY username;
