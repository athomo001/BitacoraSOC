-- ===== Numeración de tickets (pedido del dueño 2026-10-16) =====

-- name: ListTicketSeries :many
SELECT * FROM ticket_number_series ORDER BY is_default DESC, name;

-- name: GetTicketSeries :one
SELECT * FROM ticket_number_series WHERE id = $1;

-- name: LockTicketSeriesForArea :one
-- La numeración del área (o la general) bloqueada hasta el fin de la
-- transacción: dos altas a la vez nunca toman el mismo número.
SELECT * FROM ticket_number_series
WHERE id = COALESCE((SELECT ticket_series_id FROM areas WHERE areas.id = sqlc.narg('area_id')::uuid),
                    (SELECT s.id FROM ticket_number_series s WHERE s.is_default))
FOR UPDATE;

-- name: SetTicketSeriesNext :exec
UPDATE ticket_number_series SET next_number = $2 WHERE id = $1;

-- name: TicketNumberTaken :one
SELECT EXISTS (SELECT 1 FROM tickets WHERE ticket_number = $1);

-- name: CreateTicketSeries :one
INSERT INTO ticket_number_series (name, prefix, year_format, digits, next_number)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateTicketSeries :one
UPDATE ticket_number_series SET name = $2, prefix = $3, year_format = $4, digits = $5, next_number = $6
WHERE id = $1 RETURNING *;

-- name: ClearDefaultTicketSeries :exec
UPDATE ticket_number_series SET is_default = false WHERE is_default;

-- name: MakeDefaultTicketSeries :exec
UPDATE ticket_number_series SET is_default = true WHERE id = $1;

-- name: DeleteTicketSeries :execrows
-- La general no se borra; las áreas que usaban esta pasan a la general.
DELETE FROM ticket_number_series WHERE id = $1 AND NOT is_default;

-- name: ListAreaTicketSeries :many
SELECT id, code, name, active, ticket_series_id FROM areas ORDER BY sort_order, name;

-- name: SetAreaTicketSeries :execrows
UPDATE areas SET ticket_series_id = sqlc.narg('series_id') WHERE id = sqlc.arg('id');
