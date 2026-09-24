-- name: CreateEntryComment :one
INSERT INTO entry_comments (entry_id, user_id, comment, is_system_generated)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListEntryComments :many
SELECT c.*, u.username AS author_username
FROM entry_comments c JOIN users u ON u.id = c.user_id
WHERE c.entry_id = $1
ORDER BY c.created_at ASC;
