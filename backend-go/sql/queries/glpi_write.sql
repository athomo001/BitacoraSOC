-- GLPI en la Ticketera, fase 2 (10d.2, spec/18 §4): de la app a GLPI.

-- name: UpdateGlpiWriteConfig :exec
UPDATE glpi_config SET write_enabled = sqlc.arg('write_enabled'), write_token_encrypted = sqlc.narg('write_token_encrypted'),
  write_default_type = sqlc.arg('write_default_type'), client_entities = sqlc.arg('client_entities'), area_groups = sqlc.arg('area_groups'),
  updated_at = now()
WHERE id;

-- name: MarkGlpiWriteFailureNotified :exec
UPDATE glpi_config SET write_failure_notified_on = $1 WHERE id;

-- name: SetTicketGlpiCopy :execrows
-- Una sola copia por ticket, y solo de los tickets de la app.
UPDATE tickets SET glpi_copy_id = $2, glpi_copy_synced_at = now(), updated_at = now()
WHERE id = $1 AND glpi_copy_id IS NULL AND source = 'app';

-- name: ListGlpiCopies :many
-- Las copias que la sincronización mira: las de tickets abiertos y las de
-- cerrados hace menos de una semana (por si alguien escribe en GLPI al cierre).
SELECT id, glpi_copy_id::int AS glpi_copy_id, glpi_copy_date_mod FROM tickets
WHERE glpi_copy_id IS NOT NULL AND (status NOT IN ('closed', 'cancelled') OR updated_at > now() - interval '7 days');

-- name: SetGlpiCopyDateMod :exec
UPDATE tickets SET glpi_copy_date_mod = $2, glpi_copy_synced_at = now() WHERE id = $1;

-- name: UpsertGlpiCopyComment :exec
-- Lo que alguien escribió en GLPI sobre la copia llega al ticket de la app
-- con la marca «desde GLPI» (origin 'glpi'); no toca nada más del ticket.
INSERT INTO ticket_comments (ticket_id, user_id, author_name, content, is_public, origin, glpi_id, glpi_kind, glpi_time_seconds, created_at)
VALUES (sqlc.arg('ticket_id'), sqlc.narg('user_id'), sqlc.arg('author_name'), sqlc.arg('content'), sqlc.arg('is_public'), 'glpi',
  sqlc.arg('glpi_id')::int, sqlc.arg('glpi_kind')::text, sqlc.narg('glpi_time_seconds'), sqlc.arg('created_at'))
ON CONFLICT (ticket_id, glpi_kind, glpi_id) WHERE glpi_id IS NOT NULL DO UPDATE SET
  author_name = EXCLUDED.author_name, content = EXCLUDED.content, is_public = EXCLUDED.is_public,
  glpi_time_seconds = EXCLUDED.glpi_time_seconds
WHERE ticket_comments.origin = 'glpi';

-- name: DeleteGlpiCopyCommentsExcept :exec
-- Lo que se borró en GLPI sale de la app, pero solo lo que vino de GLPI: los
-- comentarios propios del ticket de la app no se tocan.
DELETE FROM ticket_comments
WHERE ticket_id = sqlc.arg('ticket_id') AND origin = 'glpi' AND glpi_id IS NOT NULL
  AND NOT ((glpi_kind || ':' || glpi_id) = ANY(sqlc.arg('keep')::text[]));

-- name: InsertGlpiOutbox :one
INSERT INTO glpi_outbox (kind, glpi_ticket_id, ticket_id, ticket_comment_id, entry_id, entry_comment_id, content, is_private, created_by)
VALUES (sqlc.arg('kind'), sqlc.arg('glpi_ticket_id'), sqlc.narg('ticket_id'), sqlc.narg('ticket_comment_id'), sqlc.narg('entry_id'),
  sqlc.narg('entry_comment_id'), sqlc.arg('content'), sqlc.arg('is_private'), sqlc.narg('created_by'))
RETURNING id;

-- name: ClaimGlpiOutbox :many
-- Toma lo que toca enviar (en orden) por dos minutos: el otro nodo no lo
-- repite. Sin id, lo vencido; con id, solo ese (enviar al momento).
UPDATE glpi_outbox SET locked_until = now() + interval '2 minutes'
WHERE id IN (
  SELECT o.id FROM glpi_outbox o
  WHERE o.state = 'queued' AND (o.locked_until IS NULL OR o.locked_until < now())
    AND (sqlc.narg('only_id')::uuid IS NULL AND o.next_attempt_at <= now() OR o.id = sqlc.narg('only_id'))
  ORDER BY o.created_at
  LIMIT 25
  FOR UPDATE SKIP LOCKED)
RETURNING *;

-- name: MarkGlpiOutboxSent :exec
UPDATE glpi_outbox SET state = 'sent', attempts = attempts + 1, last_attempt_at = now(), done_at = now(), glpi_item_id = sqlc.narg('glpi_item_id'),
  last_error = NULL, locked_until = NULL
WHERE id = sqlc.arg('id');

-- name: MarkGlpiOutboxRetry :exec
UPDATE glpi_outbox SET attempts = attempts + 1, last_attempt_at = now(), next_attempt_at = sqlc.arg('next_attempt_at'),
  last_error = sqlc.arg('error'), locked_until = NULL
WHERE id = sqlc.arg('id');

-- name: MarkGlpiOutboxFailed :exec
UPDATE glpi_outbox SET state = 'failed', attempts = attempts + 1, last_attempt_at = now(), last_error = sqlc.arg('error'), locked_until = NULL
WHERE id = sqlc.arg('id');

-- name: ListGlpiOutbox :many
-- Lo último de la cola, para Administración → GLPI.
SELECT o.id, o.kind, o.glpi_ticket_id, o.state, o.attempts, o.last_error, o.last_attempt_at, o.next_attempt_at, o.created_at,
  COALESCE(t.ticket_number, '')::text AS ticket_number
FROM glpi_outbox o LEFT JOIN tickets t ON t.id = o.ticket_id
ORDER BY (o.state = 'failed') DESC, (o.state = 'queued') DESC, o.created_at DESC
LIMIT 50;

-- name: RetryGlpiOutbox :execrows
-- «Reintentar»: lo que falló vuelve a la cola desde cero (uno o todos).
UPDATE glpi_outbox SET state = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL, locked_until = NULL, created_at = now()
WHERE state = 'failed' AND (sqlc.narg('id')::uuid IS NULL OR id = sqlc.narg('id'));

-- name: SetTicketCommentPush :exec
-- Estado del envío a GLPI de un comentario; al enviarse queda con el número
-- del seguimiento (así la sincronización no lo trae de vuelta como nuevo).
UPDATE ticket_comments SET glpi_push_state = sqlc.arg('state'), glpi_push_error = sqlc.narg('error'),
  glpi_id = COALESCE(sqlc.narg('glpi_id')::int, glpi_id),
  glpi_kind = CASE WHEN sqlc.narg('glpi_id')::int IS NOT NULL THEN 'followup' ELSE glpi_kind END
WHERE id = sqlc.arg('id');

-- name: SetEntryCommentPush :exec
UPDATE entry_comments SET glpi_push_state = sqlc.arg('state'), glpi_push_error = sqlc.narg('error'),
  glpi_followup_id = COALESCE(sqlc.narg('glpi_id')::int, glpi_followup_id)
WHERE id = sqlc.arg('id');


-- name: GetTicketComment :one
SELECT * FROM ticket_comments WHERE id = $1;

-- name: GetEntryCommentPush :one
SELECT glpi_push_state, glpi_push_error FROM entry_comments WHERE id = $1;
