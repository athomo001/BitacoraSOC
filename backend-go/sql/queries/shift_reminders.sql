-- Recordatorios de turno por correo (spec/12-pendientes.md §2.3b).

-- name: ListShiftReminders :many
-- Con el último envío de cada uno, para la tabla de Administración → Turnos.
SELECT r.*,
  last.sent_at AS last_sent_at,
  COALESCE(last.recipients_count, 0)::int AS last_recipients_count,
  COALESCE(last.status, '')::text AS last_status
FROM shift_reminders r
LEFT JOIN LATERAL (
  SELECT s.sent_at, s.recipients_count, s.status
  FROM shift_reminder_sends s
  WHERE s.reminder_id = r.id
  ORDER BY s.sent_at DESC
  LIMIT 1
) last ON true
ORDER BY r.created_at;

-- name: ListEnabledShiftReminders :many
SELECT * FROM shift_reminders WHERE enabled ORDER BY created_at;

-- name: GetShiftReminder :one
SELECT * FROM shift_reminders WHERE id = $1;

-- name: CreateShiftReminder :one
INSERT INTO shift_reminders (label, reminder_text, frequency_type, interval_hours, fixed_times, target_shift_ids, enabled, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: UpdateShiftReminder :one
UPDATE shift_reminders SET
  label = $2, reminder_text = $3, frequency_type = $4, interval_hours = $5,
  fixed_times = $6, target_shift_ids = $7, enabled = $8, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteShiftReminder :execrows
DELETE FROM shift_reminders WHERE id = $1;

-- name: ClaimShiftReminderSend :execrows
-- Reserva el envío de un bloque u hora: 0 filas = otro nodo (u otra vuelta
-- del planificador) ya lo tomó, y no se envía de nuevo.
INSERT INTO shift_reminder_sends (reminder_id, work_shift_id, trigger_key, recipients_count, status)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (reminder_id, work_shift_id, trigger_key) DO NOTHING;

-- name: MarkShiftReminderSendFailed :exec
UPDATE shift_reminder_sends SET status = 'failed', error = $4
WHERE reminder_id = $1 AND work_shift_id = $2 AND trigger_key = $3;
