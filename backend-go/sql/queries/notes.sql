-- Notas Operativas (Fase 9): pizarrón admin (fila singleton id=true) y
-- libreta personal (1:1 por usuario). Ambas con autosave/debounce desde el
-- frontend, ver spec/04-contratos-api.md sección "Notas Operativas".

-- name: GetAdminNotes :one
SELECT n.*, u.username AS last_edited_by_username
FROM admin_notes n LEFT JOIN users u ON u.id = n.last_edited_by
WHERE n.id = true;

-- name: UpsertAdminNotes :one
INSERT INTO admin_notes (id, content, last_edited_by, updated_at)
VALUES (true, $1, $2, now())
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, last_edited_by = EXCLUDED.last_edited_by, updated_at = now()
RETURNING *;

-- name: GetPersonalNotes :one
SELECT * FROM personal_notes WHERE user_id = $1;

-- name: UpsertPersonalNotes :one
INSERT INTO personal_notes (user_id, content, updated_at)
VALUES ($1, $2, now())
ON CONFLICT (user_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
RETURNING *;
