-- Resumen mensual de la jefatura (spec/16 §6.1, 9.7, 000044).

-- name: GetMonthlySummary :one
SELECT data, frozen_at FROM monthly_summaries WHERE area_id = $1 AND month = $2;

-- name: InsertMonthlySummary :exec
INSERT INTO monthly_summaries (area_id, month, data) VALUES ($1, $2, $3) ON CONFLICT (area_id, month) DO NOTHING;

-- name: ListMonthOccurrences :many
-- Las ocurrencias de las tareas del área que vencen en el mes: a quién
-- cuentan (quien la tiene o quien la cerró), cómo terminaron y cuándo.
SELECT o.id, COALESCE(o.user_id, o.closed_by) AS user_id, o.status, o.due_date, o.closed_at
FROM agenda_occurrences o
JOIN agenda_tasks t ON t.id = o.task_id
WHERE t.area_id = $1 AND o.status <> 'waiting'
  AND o.due_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date;

-- name: ListMonthResolvedTickets :many
-- Los tickets del área resueltos en el mes, con su vencimiento real de SLA
-- (con las pausas). Cuentan para quien estaba asignado.
SELECT t.id, t.assigned_user_id, t.resolved_at,
  (t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds))::timestamptz AS sla_due_at
FROM tickets t
WHERE t.area_id = $1 AND t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz;

-- name: ListMonthAbsenceDays :many
-- Días de vacaciones o licencia de cada persona en el mes (Dotación).
SELECT user_id, count(DISTINCT assigned_date)::int AS days
FROM work_shift_assignments
WHERE condition IN ('vacation', 'medical_leave') AND assigned_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date
GROUP BY user_id;

-- name: ListMonthGoalsDone :many
-- Metas de una persona cumplidas en el mes (las del bono, al confirmarlas).
SELECT person_user_id::uuid AS user_id, count(*)::int AS done FROM goals
WHERE scope = 'person'
  AND (CASE WHEN bonus_rank IS NOT NULL THEN confirmed_at ELSE completed_at END) >= sqlc.arg('from_at')::timestamptz
  AND (CASE WHEN bonus_rank IS NOT NULL THEN confirmed_at ELSE completed_at END) < sqlc.arg('to_at')::timestamptz
GROUP BY person_user_id;

-- name: ReplaceMonthlySummary :exec
-- Rehace la foto de un mes congelado con una versión anterior del resumen
-- (p. ej. antes de las entradas de la Bitácora, 10f).
INSERT INTO monthly_summaries (area_id, month, data) VALUES ($1, $2, $3)
ON CONFLICT (area_id, month) DO UPDATE SET data = EXCLUDED.data, frozen_at = now();
