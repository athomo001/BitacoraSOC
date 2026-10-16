-- Avisos del legacy: checklist no realizado y guardia sin cubrir (000045).

-- name: GetShiftAlertsConfig :one
SELECT checklist_missing_enabled, checklist_missing_time, checklist_missing_team_id, checklist_missing_cargos, checklist_missing_last_date,
  guard_reminder_enabled, guard_reminder_days_ahead, guard_reminder_cargos, guard_reminder_last_date, guard_reminder_last_week
FROM app_config LIMIT 1;

-- name: UpdateShiftAlertsConfig :exec
-- Cambiar la hora o prender el aviso de nuevo permite que salga hoy.
UPDATE app_config SET
  checklist_missing_last_date = CASE
    WHEN checklist_missing_time <> sqlc.arg('checklist_time')::text OR (sqlc.arg('checklist_enabled')::boolean AND NOT checklist_missing_enabled) THEN NULL
    ELSE checklist_missing_last_date END,
  checklist_missing_enabled = sqlc.arg('checklist_enabled')::boolean,
  checklist_missing_time = sqlc.arg('checklist_time')::text,
  checklist_missing_team_id = sqlc.narg('checklist_team_id')::uuid,
  checklist_missing_cargos = sqlc.arg('checklist_cargos')::text[],
  guard_reminder_enabled = sqlc.arg('guard_enabled')::boolean,
  guard_reminder_days_ahead = sqlc.arg('guard_days_ahead')::int,
  guard_reminder_cargos = sqlc.arg('guard_cargos')::text[];

-- name: ClaimChecklistMissingDay :execrows
-- Un solo envío por día aunque corran dos nodos.
UPDATE app_config SET checklist_missing_last_date = sqlc.arg('day')::date
WHERE checklist_missing_last_date IS DISTINCT FROM sqlc.arg('day')::date;

-- name: ClaimGuardReminder :execrows
-- Un solo envío por día y por semana objetivo.
UPDATE app_config SET guard_reminder_last_date = sqlc.arg('day')::date, guard_reminder_last_week = sqlc.arg('week')::date
WHERE guard_reminder_last_date IS DISTINCT FROM sqlc.arg('day')::date
  AND guard_reminder_last_week IS DISTINCT FROM sqlc.arg('week')::date;

-- name: CountStartChecksBetween :one
-- Checklists de inicio hechos en el día (cualquier turno).
SELECT count(*) FROM shift_checks
WHERE check_type = 'inicio' AND check_date >= sqlc.arg('from_at')::timestamptz AND check_date < sqlc.arg('to_at')::timestamptz;

-- name: ListActiveUsersByCargo :many
-- Personas activas con correo cuyo cargo está en la lista (sin distinguir mayúsculas).
SELECT id, email, COALESCE(NULLIF(full_name, ''), username)::text AS name
FROM users
WHERE active AND email <> '' AND upper(trim(cargo_label)) = ANY(sqlc.arg('cargos')::text[]);

-- name: SetGuardRemindUncovered :exec
UPDATE rotation_cycles SET remind_uncovered = $2 WHERE id = $1;
