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
INSERT INTO ticket_comments (ticket_id, user_id, author_name, content, is_public)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

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