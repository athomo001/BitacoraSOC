-- name: CreateEntryComment :one
-- Un seguimiento deja la entrada «En seguimiento» (10j), también los de
-- sistema que deja Escalamiento.
WITH inserted AS (
  INSERT INTO entry_comments (entry_id, user_id, comment, is_system_generated, via)
  VALUES ($1, $2, $3, $4, sqlc.narg('via')) RETURNING *
), opened AS (
  UPDATE entries SET follow_up_open = true, follow_up_closed_at = NULL, follow_up_closed_by = NULL, follow_up_close_note = NULL
  WHERE id = $1
)
SELECT * FROM inserted;

-- name: ListEntryComments :many
SELECT c.*, u.username AS author_username
FROM entry_comments c JOIN users u ON u.id = c.user_id
WHERE c.entry_id = $1
ORDER BY c.created_at ASC;
