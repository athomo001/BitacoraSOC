-- Guardias en línea de tiempo (000029, canvas "Turnos: guardias"): los
-- equipos "oncall" (Guardia N2, Guardia TI, Guardia N1_NO_HABIL, Guardia OL)
-- con su ciclo, sus integrantes y sus guardias con hora exacta.

-- name: ListGuardCycles :many
-- La hora de cambio sale del turno de trabajo enlazado a la guardia
-- (Administración → Turnos → Turnos de trabajo); sin turno enlazado, 09:00.
SELECT c.id, c.team_id, t.name AS team_name, c.start_day_of_week, c.timezone, c.must_be_covered, c.duration_days,
  COALESCE(ws.id, '00000000-0000-0000-0000-000000000000'::uuid) AS work_shift_id, COALESCE(ws.name, '')::text AS work_shift_name,
  COALESCE(ws.start_time, time '09:00') AS change_time
FROM rotation_cycles c
JOIN teams t ON t.id = c.team_id
LEFT JOIN LATERAL (
  SELECT w.id, w.name, w.start_time FROM work_shifts w
  WHERE w.rotation_cycle_id = c.id AND w.active ORDER BY w.name LIMIT 1
) ws ON true
WHERE t.kind = 'oncall' AND c.active AND t.active
ORDER BY t.name;

-- name: GetGuardCycle :one
SELECT c.*, t.name AS team_name FROM rotation_cycles c JOIN teams t ON t.id = c.team_id WHERE c.id = $1;

-- name: ListGuardMembers :many
SELECT m.id, m.team_id, m.user_id, m.contact_id,
  COALESCE(NULLIF(u.full_name, ''), u.username, ct.name, '')::text AS display_name
FROM team_members m
JOIN teams t ON t.id = m.team_id
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts ct ON ct.id = m.contact_id
WHERE t.kind = 'oncall' AND m.active AND (u.id IS NULL OR u.active)
ORDER BY display_name;

-- name: ListGuardSlotsBetween :many
SELECT s.id, s.cycle_id, s.team_member_id, s.starts_at, s.ends_at, s.is_paused,
  COALESCE(NULLIF(u.full_name, ''), u.username, ct.name, '')::text AS display_name, m.user_id
FROM rotation_slots s
JOIN rotation_cycles c ON c.id = s.cycle_id
JOIN teams t ON t.id = c.team_id
JOIN team_members m ON m.id = s.team_member_id
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts ct ON ct.id = m.contact_id
WHERE t.kind = 'oncall' AND s.starts_at < sqlc.arg('to_at')::timestamptz AND s.ends_at > sqlc.arg('from_at')::timestamptz
ORDER BY s.starts_at;

-- name: ListGuardOverridesBetween :many
SELECT o.id, o.cycle_id, o.original_team_member_id, o.replacement_team_member_id, o.start_date, o.end_date, o.reason,
  COALESCE(NULLIF(u.full_name, ''), u.username, ct.name, '')::text AS replacement_name
FROM rotation_overrides o
JOIN team_members m ON m.id = o.replacement_team_member_id
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts ct ON ct.id = m.contact_id
WHERE o.start_date < sqlc.arg('to_at')::timestamptz AND o.end_date > sqlc.arg('from_at')::timestamptz
ORDER BY o.start_date;

-- name: ListAbsencesBetween :many
-- Vacaciones, licencias y trámites médicos (Dotación) para avisar choques.
SELECT a.user_id, a.assigned_date, a.condition::text AS condition
FROM work_shift_assignments a
WHERE a.condition IN ('vacation', 'medical_leave', 'medical_appointment')
  AND a.assigned_date BETWEEN sqlc.arg('from_date')::date AND sqlc.arg('to_date')::date
ORDER BY a.user_id, a.assigned_date;

-- name: CreateGuardSlot :one
INSERT INTO rotation_slots (cycle_id, team_member_id, starts_at, ends_at, week_start_date, week_end_date)
SELECT c.id, sqlc.arg('team_member_id'), sqlc.arg('starts_at')::timestamptz, sqlc.arg('ends_at')::timestamptz,
  (sqlc.arg('starts_at')::timestamptz AT TIME ZONE c.timezone)::date,
  (sqlc.arg('ends_at')::timestamptz AT TIME ZONE c.timezone)::date
FROM rotation_cycles c WHERE c.id = sqlc.arg('cycle_id')
RETURNING *;

-- name: UpdateGuardSlot :one
UPDATE rotation_slots s
SET team_member_id = sqlc.arg('team_member_id'), starts_at = sqlc.arg('starts_at')::timestamptz, ends_at = sqlc.arg('ends_at')::timestamptz,
  week_start_date = (sqlc.arg('starts_at')::timestamptz AT TIME ZONE c.timezone)::date,
  week_end_date = (sqlc.arg('ends_at')::timestamptz AT TIME ZONE c.timezone)::date
FROM rotation_cycles c
WHERE s.id = sqlc.arg('id') AND c.id = s.cycle_id
RETURNING s.*;

-- name: GetGuardSlot :one
SELECT * FROM rotation_slots WHERE id = $1;

-- name: DeleteGuardSlot :execrows
DELETE FROM rotation_slots WHERE id = $1;

-- name: UpdateGuardCycle :one
UPDATE rotation_cycles SET must_be_covered = sqlc.arg('must_be_covered'), start_day_of_week = sqlc.arg('start_day_of_week')
WHERE id = sqlc.arg('id') RETURNING *;

-- name: UnlinkWorkShiftsFromCycle :exec
UPDATE work_shifts SET rotation_cycle_id = NULL WHERE rotation_cycle_id = $1;

-- name: LinkWorkShiftToCycle :exec
UPDATE work_shifts SET rotation_cycle_id = sqlc.arg('cycle_id') WHERE id = sqlc.arg('id');

-- name: GetTeamMemberForTeam :one
SELECT id FROM team_members WHERE id = $1 AND team_id = $2 AND active;

-- name: FindUserForGuardImport :one
-- usuario del CSV del legacy: username, correo o nombre completo.
SELECT id, COALESCE(NULLIF(full_name, ''), username)::text AS display_name FROM users
WHERE active AND (lower(username) = lower(sqlc.arg('q')::text) OR lower(email) = lower(sqlc.arg('q')::text) OR lower(full_name) = lower(sqlc.arg('q')::text))
LIMIT 1;

-- name: FindTeamMemberByUser :one
SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1;

-- name: AddGuardMember :one
INSERT INTO team_members (team_id, user_id, recipient_type, role_in_team, priority)
VALUES ($1, $2, 'to', 'primary', 0) RETURNING id;

-- name: UpsertDotacionDay :exec
INSERT INTO work_shift_assignments (user_id, assigned_date, condition, notes)
VALUES ($1, $2, $3, 'CSV')
ON CONFLICT (user_id, assigned_date) DO UPDATE SET condition = EXCLUDED.condition, notes = EXCLUDED.notes;
