-- Fase 8 del roadmap: matriz semanal de dotación/teletrabajo
-- (work_shift_assignments), enlace público de solo lectura para TV
-- (public_share_links) y notificación periódica a RRHH
-- (work_shift_notification_schedules). Ver spec/04-contratos-api.md sección
-- "Dotación, Teletrabajo y Pantallas de Sala (TV)".

-- name: ListAssignmentsForRange :many
SELECT * FROM work_shift_assignments
WHERE assigned_date BETWEEN sqlc.arg('from_date')::date AND sqlc.arg('to_date')::date
ORDER BY user_id, assigned_date;

-- name: UpsertAssignment :one
-- Un POST sobre el mismo (userId, assignedDate) corrige la condición en vez
-- de fallar con 409 — mismo criterio "upsert" que UpsertTeamCoverage
-- (teams.sql) de la Fase 6, más amigable para el admin que corrige un día.
INSERT INTO work_shift_assignments (user_id, assigned_date, condition, notes)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, assigned_date) DO UPDATE SET condition = EXCLUDED.condition, notes = EXCLUDED.notes
RETURNING *;

-- name: MarkNotificationScheduleSent :exec
UPDATE work_shift_notification_schedules SET last_sent_at = now(), updated_at = now() WHERE id = $1;

-- ===== Enlace público TV (slug fijo 'telework', sin UNIQUE en slug: se
-- resuelve la fila existente en el handler antes de decidir INSERT/UPDATE) =====

-- name: GetPublicShareBySlug :one
SELECT * FROM public_share_links WHERE slug = $1;

-- name: CreatePublicShareLink :one
INSERT INTO public_share_links (slug, token_hash, is_active, created_by)
VALUES ($1, $2, true, $3) RETURNING *;

-- name: RotatePublicShareLink :one
UPDATE public_share_links SET token_hash = $2, is_active = true, created_by = $3, created_at = now()
WHERE id = $1 RETURNING *;

-- name: SetPublicShareLinkActive :one
UPDATE public_share_links SET is_active = $2 WHERE id = $1 RETURNING *;

-- name: GetActivePublicShareByTokenHash :one
SELECT * FROM public_share_links WHERE token_hash = $1 AND is_active;

-- name: TouchPublicShareAccess :exec
UPDATE public_share_links SET last_accessed_at = now() WHERE id = $1;

-- ===== Notificación periódica de dotación (HU-5b) =====

-- name: ListNotificationSchedules :many
SELECT * FROM work_shift_notification_schedules ORDER BY name;

-- name: GetNotificationSchedule :one
SELECT * FROM work_shift_notification_schedules WHERE id = $1;

-- name: CreateNotificationSchedule :one
INSERT INTO work_shift_notification_schedules (name, frequency, day_of_week, send_time, role_filter, recipients, cc_recipients, created_by, target_period, email_format)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: PatchNotificationSchedule :one
UPDATE work_shift_notification_schedules SET
  enabled = COALESCE(sqlc.narg('enabled'), enabled),
  name = COALESCE(sqlc.narg('name'), name),
  frequency = COALESCE(sqlc.narg('frequency'), frequency),
  day_of_week = COALESCE(sqlc.narg('day_of_week'), day_of_week),
  send_time = COALESCE(sqlc.narg('send_time'), send_time),
  role_filter = COALESCE(sqlc.narg('role_filter')::text[], role_filter),
  recipients = COALESCE(sqlc.narg('recipients')::text[], recipients),
  cc_recipients = COALESCE(sqlc.narg('cc_recipients')::text[], cc_recipients),
  target_period = COALESCE(sqlc.narg('target_period'), target_period),
  email_format = COALESCE(sqlc.narg('email_format'), email_format),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListGuardSlotsForRange :many
-- Guardias semanales (equipos "oncall": Guardia N2, Guardia TI…) que tocan
-- el periodo, para el correo de dotación en formato lista
-- (sendEscalationScheduleInternal del legacy).
SELECT s.week_start_date, s.week_end_date, t.name AS team_name, c.start_time_utc, c.timezone,
  COALESCE(NULLIF(u.full_name, ''), ct.name, 'Pendiente')::text AS person_name,
  COALESCE(u.cargo_label, '')::text AS cargo_label,
  tm.user_id
FROM rotation_slots s
JOIN rotation_cycles c ON c.id = s.cycle_id
JOIN teams t ON t.id = c.team_id
JOIN team_members tm ON tm.id = s.team_member_id
LEFT JOIN users u ON u.id = tm.user_id
LEFT JOIN contacts ct ON ct.id = tm.contact_id
WHERE t.kind = 'oncall' AND NOT s.is_paused
  AND s.week_start_date <= sqlc.arg('to_date')::date AND s.week_end_date >= sqlc.arg('from_date')::date
ORDER BY s.week_start_date, t.name;
