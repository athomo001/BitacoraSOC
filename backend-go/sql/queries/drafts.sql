-- Borradores (Autosave, HU-7d): generaliza personal_notes a cualquier
-- formulario largo. draft_key es libre (no FK): el recurso final puede no
-- existir todavía en el momento del autosave.

-- name: UpsertDraft :one
INSERT INTO entry_drafts (user_id, form_type, draft_key, content)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, form_type, draft_key)
DO UPDATE SET content = EXCLUDED.content, updated_at = now(), expires_at = now() + INTERVAL '7 days'
RETURNING *;

-- name: ListDrafts :many
SELECT * FROM entry_drafts
WHERE user_id = $1
  AND (sqlc.narg('form_type')::text IS NULL OR form_type = sqlc.narg('form_type'))
ORDER BY updated_at DESC;

-- name: DeleteDraft :execrows
DELETE FROM entry_drafts WHERE id = $1 AND user_id = $2;
