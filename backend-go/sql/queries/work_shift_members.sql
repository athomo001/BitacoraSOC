-- ===== Personas del turno (WorkShiftAssignment del legacy) =====

-- name: ListWorkShiftMembers :many
SELECT m.*, u.username, COALESCE(NULLIF(trim(u.full_name), ''), u.username)::text AS display_name, u.active AS user_active
FROM work_shift_members m JOIN users u ON u.id = m.user_id
WHERE m.work_shift_id = $1
ORDER BY display_name;

-- name: UpsertWorkShiftMember :one
INSERT INTO work_shift_members (work_shift_id, user_id, weekdays, active)
VALUES ($1, $2, $3, true)
ON CONFLICT (work_shift_id, user_id) DO UPDATE SET weekdays = EXCLUDED.weekdays, active = true
RETURNING *;

-- name: DeleteWorkShiftMember :execrows
DELETE FROM work_shift_members WHERE work_shift_id = $1 AND user_id = $2;

-- name: CountActiveWorkShiftMembers :one
SELECT count(*)::int FROM work_shift_members WHERE work_shift_id = $1 AND active;

-- name: ListShiftReminderMemberEmails :many
-- Recordatorios: las personas activas del turno que trabajan ese día (y
-- dentro de su vigencia), con correo — como shiftReminderScheduler del legacy.
SELECT DISTINCT lower(trim(u.email))::text AS email
FROM work_shift_members m JOIN users u ON u.id = m.user_id
WHERE m.work_shift_id = sqlc.arg('work_shift_id') AND m.active AND u.active
  AND sqlc.arg('weekday')::int = ANY(m.weekdays)
  AND (m.valid_from IS NULL OR m.valid_from <= sqlc.arg('day')::date)
  AND (m.valid_to IS NULL OR m.valid_to >= sqlc.arg('day')::date)
  AND u.email IS NOT NULL AND trim(u.email) <> ''
ORDER BY 1;
