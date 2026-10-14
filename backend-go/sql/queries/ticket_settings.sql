-- Administración → Ticketera (000032): SLA, firma y avisos por correo.

-- name: GetTicketSettings :one
SELECT * FROM ticket_settings WHERE id;

-- name: UpdateTicketSettings :one
UPDATE ticket_settings SET
  sla_p1_response_minutes = sqlc.arg('sla_p1_response_minutes'),
  sla_p1_resolution_minutes = sqlc.arg('sla_p1_resolution_minutes'),
  sla_p2_response_minutes = sqlc.arg('sla_p2_response_minutes'),
  sla_p2_resolution_minutes = sqlc.arg('sla_p2_resolution_minutes'),
  sla_p3_response_minutes = sqlc.arg('sla_p3_response_minutes'),
  sla_p3_resolution_minutes = sqlc.arg('sla_p3_resolution_minutes'),
  sla_p4_response_minutes = sqlc.arg('sla_p4_response_minutes'),
  sla_p4_resolution_minutes = sqlc.arg('sla_p4_resolution_minutes'),
  sla_request_response_minutes = sqlc.arg('sla_request_response_minutes'),
  sla_request_resolution_minutes = sqlc.arg('sla_request_resolution_minutes'),
  at_risk_percent = sqlc.arg('at_risk_percent'),
  public_signature = sqlc.arg('public_signature'),
  mail_enabled = sqlc.arg('mail_enabled'),
  mail_team_link = sqlc.arg('mail_team_link'),
  mail_skip_actor = sqlc.arg('mail_skip_actor'),
  mail_team_enabled = sqlc.arg('mail_team_enabled'),
  mail_backup_emails = sqlc.arg('mail_backup_emails')::text[],
  mail_client_enabled = sqlc.arg('mail_client_enabled'),
  mail_affects_rule = sqlc.arg('mail_affects_rule'),
  mail_comment_batch_minutes = sqlc.arg('mail_comment_batch_minutes'),
  mail_include_pin = sqlc.arg('mail_include_pin'),
  mail_events = sqlc.arg('mail_events')::text[],
  updated_at = now()
WHERE id
RETURNING *;

-- ===== Cola de correos (spec/15 §7) =====

-- name: CreateTicketMail :one
INSERT INTO ticket_mail_outbox (ticket_id, event, mail_group, to_emails, cc_emails, subject, html, body_text, comments, status, send_after, created_by)
VALUES (sqlc.arg('ticket_id'), sqlc.arg('event'), sqlc.arg('mail_group'), sqlc.arg('to_emails')::text[], sqlc.arg('cc_emails')::text[],
  sqlc.arg('subject'), sqlc.arg('html'), sqlc.arg('body_text'), sqlc.arg('comments')::jsonb, sqlc.arg('status'), sqlc.arg('send_after'), sqlc.narg('created_by'))
RETURNING *;

-- name: GetWaitingCommentMail :one
-- El aviso de comentarios al cliente que todavía junta (ventana abierta).
SELECT * FROM ticket_mail_outbox
WHERE ticket_id = $1 AND event = 'client.comment' AND status = 'waiting'
ORDER BY created_at LIMIT 1;

-- name: AppendWaitingComment :execrows
UPDATE ticket_mail_outbox SET comments = comments || sqlc.arg('comment')::jsonb
WHERE id = sqlc.arg('id') AND status = 'waiting';

-- name: ListDueTicketMails :many
SELECT * FROM ticket_mail_outbox
WHERE status IN ('pending', 'waiting') AND send_after <= sqlc.arg('now')
ORDER BY send_after LIMIT 50;

-- name: MarkTicketMailSent :exec
UPDATE ticket_mail_outbox SET status = 'sent', sent_at = sqlc.arg('sent_at'), attempts = attempts + 1, last_error = NULL,
  subject = sqlc.arg('subject'), html = sqlc.arg('html'), body_text = sqlc.arg('body_text')
WHERE id = sqlc.arg('id');

-- name: MarkTicketMailFailed :exec
-- Reintentos (1, 5 y 30 min): al tercer fallo queda 'failed' y se reenvía a mano.
UPDATE ticket_mail_outbox SET attempts = attempts + 1, last_error = sqlc.arg('last_error'),
  status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
  send_after = sqlc.arg('retry_at')
WHERE id = sqlc.arg('id');

-- name: ListTicketMails :many
SELECT id, event, mail_group, to_emails, cc_emails, subject, status, attempts, last_error, send_after, sent_at, created_at
FROM ticket_mail_outbox WHERE ticket_id = $1
ORDER BY created_at DESC LIMIT 100;

-- name: RetryTicketMail :execrows
UPDATE ticket_mail_outbox SET status = 'pending', attempts = 0, last_error = NULL, send_after = now()
WHERE id = sqlc.arg('id') AND ticket_id = sqlc.arg('ticket_id') AND status = 'failed';

-- ===== Datos para armar los avisos =====

-- name: ListTicketResolverEmails :many
SELECT u.id, u.email FROM ticket_resolvers r JOIN users u ON u.id = r.user_id
WHERE r.ticket_id = $1 AND u.active;

-- name: GetActiveUserEmail :one
SELECT email FROM users WHERE id = $1 AND active;

-- name: SetTicketMailRecipients :one
-- "Afecta al cliente" y "Avisar a" del ticket (spec/15 §5). Recipients NULL
-- = volver a los del cliente.
UPDATE tickets SET
  affects_client = COALESCE(sqlc.narg('affects_client'), affects_client),
  notify_to = CASE WHEN sqlc.arg('set_recipients')::bool THEN sqlc.narg('notify_to')::text[] ELSE notify_to END,
  notify_cc = CASE WHEN sqlc.arg('set_recipients')::bool THEN sqlc.narg('notify_cc')::text[] ELSE notify_cc END,
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: ListOpenTicketsForSLAMail :many
-- Tickets abiertos a los que todavía les falta algún aviso de SLA.
SELECT * FROM tickets
WHERE status NOT IN ('resolved', 'closed', 'cancelled') AND merged_into_id IS NULL
  AND (sla_response_breach_notified_at IS NULL OR sla_resolution_warn_notified_at IS NULL OR sla_resolution_breach_notified_at IS NULL);

-- name: MarkTicketSLANotified :exec
UPDATE tickets SET
  sla_response_breach_notified_at = COALESCE(sla_response_breach_notified_at, sqlc.narg('response_breach')),
  sla_resolution_warn_notified_at = COALESCE(sla_resolution_warn_notified_at, sqlc.narg('resolution_warn')),
  sla_resolution_breach_notified_at = COALESCE(sla_resolution_breach_notified_at, sqlc.narg('resolution_breach'))
WHERE id = sqlc.arg('id');

-- name: ResetTicketResolutionSLANotified :exec
-- Reabrir permite volver a avisar el SLA de resolución (spec/15 §4.2).
UPDATE tickets SET sla_resolution_warn_notified_at = NULL, sla_resolution_breach_notified_at = NULL WHERE id = $1;
