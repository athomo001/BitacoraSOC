-- Fase 9 del roadmap (spec/02-alcance-y-roadmap.md): bitácora — registro
-- operativo central. HU-7: búsqueda de texto completo con
-- websearch_to_tsquery, NUNCA to_tsquery directo (rompe con '&'/'!' sueltos),
-- contra el índice funcional idx_entries_fulltext ya creado en la Fase 2
-- (to_tsvector('spanish', content)) — la expresión del WHERE debe calzar
-- exactamente con la del índice para poder usarlo.

-- name: CreateEntry :one
INSERT INTO entries (user_id, entry_type, scope, content, tags, service_id, asset_id, image_url, image_hash, image_size_bytes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: UpdateEntryTicket :one
UPDATE entries SET ticket_id = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: GetServiceOrganizationID :one
SELECT organization_id FROM services WHERE id = $1;

-- name: GetEntry :one
SELECT e.*, u.username AS author_username
FROM entries e JOIN users u ON u.id = e.user_id
WHERE e.id = $1;

-- name: ListEntries :many
SELECT e.*, u.username AS author_username
FROM entries e JOIN users u ON u.id = e.user_id
WHERE (sqlc.narg('scope')::entry_scope IS NULL OR e.scope = sqlc.narg('scope'))
  AND (sqlc.narg('entry_type')::entry_type IS NULL OR e.entry_type = sqlc.narg('entry_type'))
  AND (sqlc.narg('tag')::text IS NULL OR sqlc.narg('tag') = ANY(e.tags))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR e.created_at >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR e.created_at < sqlc.narg('to_date'))
  AND (sqlc.narg('q')::text IS NULL OR to_tsvector('spanish', e.content) @@ websearch_to_tsquery('spanish', sqlc.narg('q')))
ORDER BY e.created_at DESC
LIMIT sqlc.arg('page_size') OFFSET sqlc.arg('page_offset');

-- name: CountEntries :one
SELECT count(*) FROM entries e
WHERE (sqlc.narg('scope')::entry_scope IS NULL OR e.scope = sqlc.narg('scope'))
  AND (sqlc.narg('entry_type')::entry_type IS NULL OR e.entry_type = sqlc.narg('entry_type'))
  AND (sqlc.narg('tag')::text IS NULL OR sqlc.narg('tag') = ANY(e.tags))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR e.created_at >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR e.created_at < sqlc.narg('to_date'))
  AND (sqlc.narg('q')::text IS NULL OR to_tsvector('spanish', e.content) @@ websearch_to_tsquery('spanish', sqlc.narg('q')));

-- name: ListEntriesForExport :many
-- GET /api/entries/export — mismos filtros que ListEntries, sin paginar.
SELECT e.*, u.username AS author_username
FROM entries e JOIN users u ON u.id = e.user_id
WHERE (sqlc.narg('scope')::entry_scope IS NULL OR e.scope = sqlc.narg('scope'))
  AND (sqlc.narg('entry_type')::entry_type IS NULL OR e.entry_type = sqlc.narg('entry_type'))
  AND (sqlc.narg('tag')::text IS NULL OR sqlc.narg('tag') = ANY(e.tags))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR e.created_at >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR e.created_at < sqlc.narg('to_date'))
  AND (sqlc.narg('q')::text IS NULL OR to_tsvector('spanish', e.content) @@ websearch_to_tsquery('spanish', sqlc.narg('q')))
ORDER BY e.created_at DESC;

-- name: PatchEntry :one
UPDATE entries SET
  scope = COALESCE(sqlc.narg('scope'), scope),
  content = COALESCE(sqlc.narg('content'), content),
  tags = COALESCE(sqlc.narg('tags')::text[], tags),
  service_id = COALESCE(sqlc.narg('service_id'), service_id),
  asset_id = COALESCE(sqlc.narg('asset_id'), asset_id),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteEntry :one
-- Borrado real (no soft-delete, HU-7g) — RETURNING para el snapshot de auditoría.
DELETE FROM entries WHERE id = $1 RETURNING *;

-- name: BulkPatchEntries :execrows
-- PATCH /api/entries/bulk (admin, HU-7g) — reclasificación masiva.
UPDATE entries SET
  scope = COALESCE(sqlc.narg('scope'), scope),
  tags = COALESCE(sqlc.narg('tags')::text[], tags),
  updated_at = now()
WHERE id = ANY(sqlc.arg('ids')::uuid[]);
