-- Complementos (spec/11-complementos.md, Fase 13b).

-- name: ListComplements :many
SELECT * FROM complements ORDER BY name;

-- name: ListVisibleComplementCandidates :many
-- Activos o en mantenimiento; la visibilidad por rol y grupo se filtra en Go.
SELECT * FROM complements WHERE status <> 'disabled' ORDER BY name;

-- name: GetComplementBySlug :one
SELECT * FROM complements WHERE slug = $1;

-- name: CreateComplement :one
INSERT INTO complements (
  slug, name, description, icon, source_type, status, entry_path, base_url, internal_base_url, health_path,
  scopes, allowed_collections, connect_hosts, visible_roles, visible_permission_group_ids, created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING *;

-- name: UpdateComplement :one
-- Ficha del complemento: todo lo editable de una vez (el handler mezcla lo
-- que llega con lo guardado).
UPDATE complements SET
  name = $2, description = $3, icon = $4, status = $5, entry_path = $6, base_url = $7, internal_base_url = $8,
  health_path = $9, scopes = $10, allowed_collections = $11, connect_hosts = $12, visible_roles = $13,
  visible_permission_group_ids = $14, updated_at = now()
WHERE slug = $1
RETURNING *;

-- name: SetComplementToken :exec
UPDATE complements SET token_hash = $2, token_issued_at = now(), updated_at = now() WHERE slug = $1;

-- name: SetComplementArtifact :exec
UPDATE complements SET artifact_sha256 = $2, artifact_bytes = $3, artifact_files = $4, published_at = now(), updated_at = now()
WHERE id = $1;

-- name: DeleteComplementFiles :exec
DELETE FROM complement_files WHERE complement_id = $1;

-- name: InsertComplementFile :exec
INSERT INTO complement_files (complement_id, path, content_type, sha256, content) VALUES ($1, $2, $3, $4, $5);

-- name: GetComplementFile :one
SELECT f.content_type, f.sha256, f.content
FROM complement_files f JOIN complements c ON c.id = f.complement_id
WHERE c.slug = $1 AND f.path = $2;

-- name: CountComplementFiles :one
SELECT count(*)::int FROM complement_files WHERE complement_id = $1;

-- name: CountComplementEntries :one
SELECT count(*)::int FROM entries WHERE owner_complement_id = $1;

-- name: DeleteComplement :execrows
-- Archivos y storage caen por CASCADE; las entradas quedan (FK en NULL) con
-- su owner_complement_name.
DELETE FROM complements WHERE id = $1;

-- name: CreateComplementUpload :one
INSERT INTO complement_uploads (filename, analysis, content, uploaded_by) VALUES ($1, $2, $3, $4)
RETURNING id, filename, analysis, created_at, expires_at;

-- name: GetComplementUpload :one
SELECT * FROM complement_uploads WHERE id = $1 AND expires_at > now();

-- name: DeleteComplementUpload :exec
DELETE FROM complement_uploads WHERE id = $1;

-- name: DeleteExpiredComplementUploads :execrows
DELETE FROM complement_uploads WHERE expires_at <= now();

-- name: ClaimComplementTicket :execrows
-- Un enlace de un solo uso: 0 filas = ya se usó.
INSERT INTO token_denylist (jti, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING;

-- name: GetComplementStorage :one
SELECT * FROM complement_storage WHERE complement_id = $1 AND key = $2;

-- name: ListComplementStorage :many
SELECT * FROM complement_storage
WHERE complement_id = $1 AND (sqlc.narg('key')::text IS NULL OR key = sqlc.narg('key'))
ORDER BY updated_at DESC
LIMIT 200;

-- name: UpsertComplementStorage :one
INSERT INTO complement_storage (complement_id, key, value, updated_by_user_id, updated_via)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (complement_id, key) DO UPDATE SET
  value = EXCLUDED.value, updated_by_user_id = EXCLUDED.updated_by_user_id,
  updated_via = EXCLUDED.updated_via, updated_at = now()
RETURNING *;

-- name: CreateComplementEntry :one
-- Entrada creada por un complemento (Runtime API o CREATE_ENTRY del iframe).
INSERT INTO entries (user_id, entry_type, scope, content, tags, owner_complement_id, owner_complement_name)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListRecentEntriesForComplement :many
-- Runtime API query-general?collection=entries: lo más reciente, sin adjuntos.
SELECT e.id, e.entry_type, e.scope, e.content, e.tags, e.created_at, u.username AS author_username, e.owner_complement_name
FROM entries e JOIN users u ON u.id = e.user_id
ORDER BY e.created_at DESC
LIMIT $1;

-- name: ListRecentAuditForComplement :many
SELECT id, timestamp, event, level, actor_username, success, reason
FROM audit_log
ORDER BY timestamp DESC
LIMIT $1;
