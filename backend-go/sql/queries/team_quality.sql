-- Puntaje de calidad por analista (10f, Mi equipo → Calidad; spec/08 §7).

-- name: ListQualityEntries :many
-- Las entradas que cuentan: sin el checklist ni lo que entra por API o
-- complementos.
SELECT e.user_id, e.entry_type::text AS entry_type, e.content, e.tags, e.created_at, e.ticket_id, e.service_id, e.asset_id
FROM entries e
WHERE e.user_id = ANY(sqlc.arg('user_ids')::uuid[])
  AND e.created_at >= sqlc.arg('from_at')::timestamptz AND e.created_at < sqlc.arg('to_at')::timestamptz
  AND e.entry_type <> 'checklist' AND e.api_key_id IS NULL AND e.owner_complement_id IS NULL
ORDER BY e.created_at;

-- name: ListQualityChecks :many
-- Los checklists de inicio y cierre: marcan el turno real de cada persona.
SELECT sc.user_id, sc.check_type::text AS check_type, sc.check_date, ws.name AS shift_name, ws.start_time, ws.end_time
FROM shift_checks sc
JOIN work_shifts ws ON ws.id = sc.work_shift_id
WHERE sc.user_id = ANY(sqlc.arg('user_ids')::uuid[])
  AND sc.check_date >= sqlc.arg('from_at')::timestamptz AND sc.check_date < sqlc.arg('to_at')::timestamptz
ORDER BY sc.check_date;

-- name: ListQualityAbsences :many
-- Días de vacaciones o licencia de cada persona en el período (Dotación).
SELECT user_id, condition::text AS condition, count(DISTINCT assigned_date)::int AS days
FROM work_shift_assignments
WHERE condition IN ('vacation', 'medical_leave') AND assigned_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date
GROUP BY user_id, condition;

-- name: ListAreaProfiles :many
-- El perfil de cada área: la Calidad se ve en las que usan la Bitácora (Operativo).
SELECT code, default_profile FROM areas WHERE active;
