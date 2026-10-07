-- name: ListTickets :many
SELECT t.*
FROM tickets t
WHERE (sqlc.narg('ticket_type')::ticket_type IS NULL OR t.ticket_type = sqlc.narg('ticket_type')::ticket_type)
  AND (sqlc.narg('scope')::entry_scope IS NULL OR t.scope = sqlc.narg('scope')::entry_scope)
  AND (sqlc.narg('status')::ticket_status IS NULL OR t.status = sqlc.narg('status')::ticket_status)
  AND (sqlc.narg('assigned_team_id')::uuid IS NULL OR t.assigned_team_id = sqlc.narg('assigned_team_id')::uuid)
  AND (sqlc.narg('client_id')::uuid IS NULL OR t.client_id = sqlc.narg('client_id')::uuid)
  AND (sqlc.narg('q')::text IS NULL OR t.ticket_number ILIKE '%' || sqlc.narg('q')::text || '%' OR t.title ILIKE '%' || sqlc.narg('q')::text || '%')
ORDER BY t.updated_at DESC
LIMIT sqlc.arg('page_size') OFFSET sqlc.arg('page_offset');

-- name: CountTickets :one
SELECT count(*) FROM tickets t
WHERE (sqlc.narg('ticket_type')::ticket_type IS NULL OR t.ticket_type = sqlc.narg('ticket_type')::ticket_type)
  AND (sqlc.narg('scope')::entry_scope IS NULL OR t.scope = sqlc.narg('scope')::entry_scope)
  AND (sqlc.narg('status')::ticket_status IS NULL OR t.status = sqlc.narg('status')::ticket_status)
  AND (sqlc.narg('assigned_team_id')::uuid IS NULL OR t.assigned_team_id = sqlc.narg('assigned_team_id')::uuid)
  AND (sqlc.narg('client_id')::uuid IS NULL OR t.client_id = sqlc.narg('client_id')::uuid)
  AND (sqlc.narg('q')::text IS NULL OR t.ticket_number ILIKE '%' || sqlc.narg('q')::text || '%' OR t.title ILIKE '%' || sqlc.narg('q')::text || '%');

-- name: GetTicket :one
SELECT * FROM tickets WHERE id = $1;

-- name: GetTicketByNumber :one
SELECT * FROM tickets WHERE ticket_number = $1;

-- name: CreateTicket :one
INSERT INTO tickets (ticket_number, ticket_type, scope, client_id, asset_id, service_id, assigned_team_id, assigned_user_id, status, impact, urgency, priority, title, description, sla_response_due_at, sla_resolution_due_at, public_tracking_token, created_by)
VALUES ($1, $2, $3, $4, sqlc.narg('asset_id'), sqlc.narg('service_id'), $5, sqlc.narg('assigned_user_id'), 'new', $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING *;

-- name: UpdateTicket :one
UPDATE tickets SET
  status = COALESCE(sqlc.narg('status'), status),
  assigned_team_id = COALESCE(sqlc.narg('assigned_team_id'), assigned_team_id),
  assigned_user_id = COALESCE(sqlc.narg('assigned_user_id'), assigned_user_id),
  assigned_contact_id = COALESCE(sqlc.narg('assigned_contact_id'), assigned_contact_id),
  impact = COALESCE(sqlc.narg('impact'), impact),
  urgency = COALESCE(sqlc.narg('urgency'), urgency),
  priority = COALESCE(sqlc.narg('priority'), priority),
  sla_on_hold_since = sqlc.narg('sla_on_hold_since'),
  sla_paused_seconds = COALESCE(sqlc.narg('sla_paused_seconds'), sla_paused_seconds),
  first_responded_at = COALESCE(sqlc.narg('first_responded_at'), first_responded_at),
  resolved_at = sqlc.narg('resolved_at'),
  closed_at = sqlc.narg('closed_at'),
  reopened_count = COALESCE(sqlc.narg('reopened_count'), reopened_count),
  reopened_at = sqlc.narg('reopened_at'),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListTicketComments :many
SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC;

-- name: CreateTicketComment :one
INSERT INTO ticket_comments (ticket_id, user_id, author_name, content, is_public, origin)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: ListTicketTasks :many
SELECT * FROM ticket_tasks WHERE ticket_id = $1 ORDER BY performed_at ASC;

-- name: SumTicketTaskTime :one
SELECT COALESCE(sum(time_spent_seconds), 0)::bigint FROM ticket_tasks WHERE ticket_id = $1;

-- name: CreateTicketTask :one
INSERT INTO ticket_tasks (ticket_id, user_id, content, time_spent_seconds, is_public, performed_at)
VALUES ($1, $2, $3, $4, $5, COALESCE(sqlc.narg('performed_at'), now())) RETURNING *;

-- name: UpdateTicketTask :one
UPDATE ticket_tasks SET content = COALESCE(sqlc.narg('content'), content), time_spent_seconds = COALESCE(sqlc.narg('time_spent_seconds'), time_spent_seconds)
WHERE id = $1 AND ticket_id = $2 RETURNING *;

-- name: GetTicketTask :one
SELECT * FROM ticket_tasks WHERE id = $1;

-- name: GetPublicTicket :one
SELECT * FROM tickets WHERE public_tracking_token = $1 AND public_tracking_enabled = true;

-- name: ListPublicTicketComments :many
SELECT * FROM ticket_comments WHERE ticket_id = $1 AND is_public = true ORDER BY created_at ASC;

-- name: LinkEntryToTicket :one
UPDATE entries SET ticket_id = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: ListTicketEntries :many
SELECT * FROM entries WHERE ticket_id = $1 ORDER BY created_at ASC;
-- name: ListTicketsView :many
-- Vista de la cola (Fase 10, pantalla aprobada): nombres ya resueltos para no
-- mostrar UUID, abiertos primero y por prioridad, luego lo más reciente.
SELECT sqlc.embed(t), o.name AS client_name, tm.name AS team_name, u.username AS assignee_username,
  p.ticket_number AS parent_number, m.ticket_number AS merged_into_number,
  (SELECT count(*) FROM tickets c WHERE c.parent_id = t.id)::int AS child_count
FROM tickets t
JOIN organizations o ON o.id = t.client_id
LEFT JOIN teams tm ON tm.id = t.assigned_team_id
LEFT JOIN users u ON u.id = t.assigned_user_id
LEFT JOIN tickets p ON p.id = t.parent_id
LEFT JOIN tickets m ON m.id = t.merged_into_id
WHERE (sqlc.narg('ticket_type')::ticket_type IS NULL OR t.ticket_type = sqlc.narg('ticket_type')::ticket_type)
  AND (sqlc.narg('scope')::entry_scope IS NULL OR t.scope = sqlc.narg('scope')::entry_scope)
  AND (sqlc.narg('status')::ticket_status IS NULL OR t.status = sqlc.narg('status')::ticket_status)
  AND (sqlc.narg('assigned_team_id')::uuid IS NULL OR t.assigned_team_id = sqlc.narg('assigned_team_id')::uuid)
  AND (sqlc.narg('client_id')::uuid IS NULL OR t.client_id = sqlc.narg('client_id')::uuid)
  AND (sqlc.narg('q')::text IS NULL OR t.ticket_number ILIKE '%' || sqlc.narg('q')::text || '%' OR t.title ILIKE '%' || sqlc.narg('q')::text || '%')
  AND (NOT sqlc.arg('open_only')::bool OR t.status NOT IN ('resolved', 'closed', 'cancelled'))
ORDER BY (t.status IN ('resolved', 'closed', 'cancelled')), t.priority, t.updated_at DESC
LIMIT sqlc.arg('page_size') OFFSET sqlc.arg('page_offset');

-- name: CountTicketsView :one
SELECT count(*) FROM tickets t
WHERE (sqlc.narg('ticket_type')::ticket_type IS NULL OR t.ticket_type = sqlc.narg('ticket_type')::ticket_type)
  AND (sqlc.narg('scope')::entry_scope IS NULL OR t.scope = sqlc.narg('scope')::entry_scope)
  AND (sqlc.narg('status')::ticket_status IS NULL OR t.status = sqlc.narg('status')::ticket_status)
  AND (sqlc.narg('assigned_team_id')::uuid IS NULL OR t.assigned_team_id = sqlc.narg('assigned_team_id')::uuid)
  AND (sqlc.narg('client_id')::uuid IS NULL OR t.client_id = sqlc.narg('client_id')::uuid)
  AND (sqlc.narg('q')::text IS NULL OR t.ticket_number ILIKE '%' || sqlc.narg('q')::text || '%' OR t.title ILIKE '%' || sqlc.narg('q')::text || '%')
  AND (NOT sqlc.arg('open_only')::bool OR t.status NOT IN ('resolved', 'closed', 'cancelled'));

-- name: TicketQueueSummary :one
-- Resumen de la cola para la cabecera. "Vencido" = abierto, no en pausa y
-- pasado el vencimiento real (pactado + pausas acumuladas), igual que tickets.ResolutionClock.
SELECT
  count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'cancelled'))::bigint AS open_count,
  count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'cancelled') AND sla_on_hold_since IS NULL
                   AND sla_resolution_due_at + make_interval(secs => sla_paused_seconds) < sqlc.arg('now')::timestamptz)::bigint AS breached_count,
  count(*) FILTER (WHERE status = 'pending_vendor')::bigint AS paused_count,
  count(*) FILTER (WHERE resolved_at >= sqlc.arg('resolved_since')::timestamptz)::bigint AS resolved_today_count
FROM tickets;

-- name: GetTicketView :one
SELECT sqlc.embed(t), o.name AS client_name, tm.name AS team_name, u.username AS assignee_username
FROM tickets t
JOIN organizations o ON o.id = t.client_id
LEFT JOIN teams tm ON tm.id = t.assigned_team_id
LEFT JOIN users u ON u.id = t.assigned_user_id
WHERE t.id = $1;

-- name: ListTicketTasksWithUser :many
SELECT tt.*, u.username
FROM ticket_tasks tt JOIN users u ON u.id = tt.user_id
WHERE tt.ticket_id = $1 ORDER BY tt.performed_at DESC;

-- name: ListTicketEntriesWithAuthor :many
SELECT e.id, e.entry_type, e.content, e.created_at, u.username
FROM entries e JOIN users u ON u.id = e.user_id
WHERE e.ticket_id = $1 ORDER BY e.created_at DESC;

-- name: MarkTicketResponded :exec
-- Primera acción del equipo = cumple el SLA de respuesta (solo la primera cuenta).
UPDATE tickets SET first_responded_at = COALESCE(first_responded_at, sqlc.arg('at')::timestamptz), updated_at = now() WHERE id = $1;

-- name: SetTicketPublicPin :one
UPDATE tickets SET public_tracking_pin = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteTicket :one
DELETE FROM tickets WHERE id = $1 RETURNING ticket_number;

-- name: ListTicketResolvers :many
SELECT r.user_id, u.username, u.full_name, r.added_at
FROM ticket_resolvers r JOIN users u ON u.id = r.user_id
WHERE r.ticket_id = $1
ORDER BY r.added_at, u.username;

-- name: AddTicketResolver :exec
INSERT INTO ticket_resolvers (ticket_id, user_id, added_by) VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: RemoveTicketResolver :execrows
DELETE FROM ticket_resolvers WHERE ticket_id = $1 AND user_id = $2;

-- name: ListTicketAssignees :many
-- Personas a las que se puede sumar como resolutor (usuarios activos que
-- operan: admin y analistas).
SELECT id, username, full_name FROM users
WHERE active AND role IN ('admin', 'user')
ORDER BY username;

-- name: CreateTicketImage :one
INSERT INTO ticket_images (ticket_id, file_name, mime_type, size_bytes, file_data, hash_sha256, uploaded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, file_name, size_bytes, created_at;

-- name: ClaimTicketImages :execrows
-- El comentario reclama las imágenes que subió su autor en ese ticket.
UPDATE ticket_images SET comment_id = sqlc.arg('comment_id')
WHERE ticket_id = sqlc.arg('ticket_id') AND comment_id IS NULL
  AND uploaded_by = sqlc.arg('user_id') AND id = ANY(sqlc.arg('ids')::uuid[]);

-- name: ListTicketImages :many
SELECT i.id, i.comment_id, i.file_name, i.size_bytes, i.created_at, c.is_public, c.author_name
FROM ticket_images i JOIN ticket_comments c ON c.id = i.comment_id
WHERE i.ticket_id = $1
ORDER BY i.created_at DESC;

-- name: GetTicketImage :one
SELECT i.id, i.ticket_id, i.comment_id, i.mime_type, i.file_name, i.file_data, i.uploaded_by,
       COALESCE(c.is_public, false)::boolean AS is_public
FROM ticket_images i LEFT JOIN ticket_comments c ON c.id = i.comment_id
WHERE i.id = $1 AND i.ticket_id = $2;

-- name: DeletePendingTicketImage :execrows
DELETE FROM ticket_images WHERE id = $1 AND ticket_id = $2 AND comment_id IS NULL AND uploaded_by = $3;

-- name: DeleteStaleTicketImages :exec
-- Subidas que nunca llegaron a un comentario (se cerró la pestaña).
DELETE FROM ticket_images WHERE comment_id IS NULL AND created_at < now() - interval '1 day';

-- name: MarkEntriesOfDeletedTicket :exec
-- Al eliminar un ticket (comentario del dueño #20) la entrada de la
-- bitácora se queda: un comentario de sistema deja constancia del ticket.
INSERT INTO entry_comments (entry_id, user_id, comment, is_system_generated)
SELECT e.id, sqlc.arg('user_id'), sqlc.arg('comment'), true
FROM entries e WHERE e.ticket_id = sqlc.arg('ticket_id');

-- ===== Unir tickets y padre/hijo (000028) =====

-- name: SetTicketParent :exec
UPDATE tickets SET parent_id = sqlc.narg('parent_id'), updated_at = now() WHERE id = sqlc.arg('id');

-- name: CountTicketChildren :one
SELECT count(*) FROM tickets WHERE parent_id = $1;

-- name: ListTicketChildren :many
SELECT t.id, t.ticket_number, t.title, t.status, o.name AS client_name
FROM tickets t JOIN organizations o ON o.id = t.client_id
WHERE t.parent_id = $1
ORDER BY t.created_at;

-- name: ListOpenChildTickets :many
SELECT * FROM tickets WHERE parent_id = $1 AND status NOT IN ('resolved', 'closed', 'cancelled') ORDER BY created_at;

-- name: GetTicketRef :one
SELECT id, ticket_number, title FROM tickets WHERE id = $1;

-- name: GetTicketByNumberForMerge :one
SELECT * FROM tickets WHERE ticket_number = $1;

-- name: MoveTicketComments :exec
UPDATE ticket_comments
SET ticket_id = sqlc.arg('main_id'),
    origin = CASE WHEN origin = '' THEN 'merged:' || sqlc.arg('other_number')::text ELSE origin END
WHERE ticket_id = sqlc.arg('other_id');

-- name: MoveTicketTasks :exec
UPDATE ticket_tasks SET ticket_id = sqlc.arg('main_id') WHERE ticket_id = sqlc.arg('other_id');

-- name: MoveTicketImages :exec
UPDATE ticket_images SET ticket_id = sqlc.arg('main_id') WHERE ticket_id = sqlc.arg('other_id');

-- name: MoveTicketEntries :exec
UPDATE entries SET ticket_id = sqlc.arg('main_id')::uuid, updated_at = now() WHERE ticket_id = sqlc.arg('other_id')::uuid;

-- name: MoveTicketEscalationIncidents :exec
UPDATE escalation_incidents SET ticket_id = sqlc.arg('main_id')::uuid WHERE ticket_id = sqlc.arg('other_id')::uuid;

-- name: CopyTicketResolvers :exec
INSERT INTO ticket_resolvers (ticket_id, user_id, added_by, added_at)
SELECT sqlc.arg('main_id'), r.user_id, r.added_by, r.added_at FROM ticket_resolvers r WHERE r.ticket_id = sqlc.arg('other_id')
ON CONFLICT (ticket_id, user_id) DO NOTHING;

-- name: MoveTicketChildren :exec
UPDATE tickets SET parent_id = sqlc.arg('main_id')::uuid, updated_at = now() WHERE parent_id = sqlc.arg('other_id')::uuid;

-- name: MarkTicketMerged :exec
-- El que se une queda cerrado apuntando al principal (no se borra).
UPDATE tickets
SET status = 'closed', closed_at = now(), merged_into_id = sqlc.arg('main_id')::uuid, parent_id = NULL,
    sla_on_hold_since = NULL, updated_at = now()
WHERE id = sqlc.arg('other_id');

-- name: SetTicketClient :one
-- Cambiar el cliente (registrado mal): el servicio se quita si era del
-- cliente anterior; enlace público y PIN nuevos (el cliente equivocado deja
-- de ver el ticket).
UPDATE tickets
SET client_id = sqlc.arg('client_id'),
    service_id = CASE WHEN service_id IS NULL OR EXISTS (SELECT 1 FROM services s WHERE s.id = tickets.service_id AND s.organization_id = sqlc.arg('client_id'))
                      THEN service_id ELSE NULL END,
    public_tracking_token = sqlc.arg('token'),
    public_tracking_pin = CASE WHEN public_tracking_pin IS NULL THEN NULL ELSE sqlc.narg('pin') END,
    updated_at = now()
WHERE tickets.id = sqlc.arg('id')
RETURNING *;
