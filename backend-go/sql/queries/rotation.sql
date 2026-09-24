-- Fase 8 del roadmap (spec/02-alcance-y-roadmap.md): motor de rotación
-- unificado (rotation_cycles/rotation_slots/rotation_overrides) y work_shifts.
-- GET /api/rotation-slots, POST /api/rotation-slots y PATCH
-- /api/rotation-slots/:id no estaban en el contrato original (faltaba forma
-- de armar/pausar el rol semanal, ver 04-contratos-api.md) — agregados acá,
-- mismo patrón de gap real que las Fases 5-7.

-- name: ListRotationCyclesByTeam :many
SELECT * FROM rotation_cycles
WHERE (sqlc.narg('team_id')::uuid IS NULL OR team_id = sqlc.narg('team_id'))
ORDER BY team_id;

-- name: GetRotationCycle :one
SELECT * FROM rotation_cycles WHERE id = $1;

-- name: CreateRotationCycle :one
INSERT INTO rotation_cycles (team_id, start_day_of_week, start_time_utc, duration_days, timezone)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: ListRotationSlotsByCycle :many
SELECT s.*, COALESCE(u.username, c.name, '')::text AS display_name
FROM rotation_slots s
JOIN team_members m ON m.id = s.team_member_id
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts c ON c.id = m.contact_id
WHERE s.cycle_id = $1
ORDER BY s.week_start_date DESC;

-- name: GetCurrentRotationSlot :one
-- El slot regular cuya semana cubre `now` (independiente de is_paused: el
-- handler decide qué hacer con eso vía internal/rotation.Resolve).
SELECT s.*, COALESCE(u.username, c.name, '')::text AS display_name
FROM rotation_slots s
JOIN team_members m ON m.id = s.team_member_id
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts c ON c.id = m.contact_id
WHERE s.cycle_id = $1
  AND s.week_start_date <= sqlc.arg('today')::date
  AND s.week_end_date >= sqlc.arg('today')::date
ORDER BY s.week_start_date DESC
LIMIT 1;

-- name: CreateRotationSlot :one
INSERT INTO rotation_slots (cycle_id, team_member_id, week_start_date, week_end_date)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: PatchRotationSlotPause :one
-- HU-5: pausar sin borrar la fila (conserva el historial del rol).
UPDATE rotation_slots SET is_paused = $2, paused_reason = $3 WHERE id = $1 RETURNING *;

-- name: ListActiveOverridesForCycle :many
SELECT * FROM rotation_overrides
WHERE cycle_id = $1
  AND start_date <= sqlc.arg('now')::timestamptz
  AND end_date > sqlc.arg('now')::timestamptz
ORDER BY start_date DESC;

-- name: CreateRotationOverride :one
INSERT INTO rotation_overrides (cycle_id, original_team_member_id, replacement_team_member_id, start_date, end_date, reason, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: GetTeamMemberDisplay :one
SELECT m.id, m.team_id, m.user_id, m.contact_id, COALESCE(u.username, c.name, '')::text AS display_name
FROM team_members m
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts c ON c.id = m.contact_id
WHERE m.id = $1;

-- name: ListWorkShifts :many
SELECT * FROM work_shifts
WHERE (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY name;

-- name: CreateWorkShift :one
INSERT INTO work_shifts (
  rotation_cycle_id, name, start_time, end_time, timezone, shift_type,
  checklist_template_start_id, checklist_template_end_id, email_recipients
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
