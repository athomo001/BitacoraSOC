-- Mi equipo → Actividad (10f): cuántas acciones hizo cada persona por día de
-- la semana y hora, a la hora real de la acción (la de la Auditoría).

-- name: ListActivityCounts :many
-- Solo lo que salió bien y solo los eventos de trabajo que se piden.
-- day: 1 = lunes … 7 = domingo.
SELECT a.actor_user_id::uuid AS user_id, a.event,
  EXTRACT(ISODOW FROM a."timestamp" AT TIME ZONE sqlc.arg('tz')::text)::int AS day,
  EXTRACT(HOUR FROM a."timestamp" AT TIME ZONE sqlc.arg('tz')::text)::int AS hour,
  count(*)::int AS n
FROM audit_log a
WHERE a.actor_user_id = ANY(sqlc.arg('user_ids')::uuid[])
  AND a."timestamp" >= sqlc.arg('from_at')::timestamptz AND a."timestamp" < sqlc.arg('to_at')::timestamptz
  AND a.success AND a.event = ANY(sqlc.arg('events')::text[])
GROUP BY 1, 2, 3, 4;
