-- Complementos (spec/11-complementos.md, Fase 13b).

-- name: ListComplements :many
SELECT * FROM complements ORDER BY name;

-- name: ListVisibleComplementCandidates :many
-- Activos o en mantenimiento; la visibilidad por rol y grupo se filtra en Go.
SELECT * FROM complements WHERE status <> 'disabled' ORDER BY name;

-- name: GetComplementBySlug :one
SELECT * FROM complements WHERE slug = $1;

-- name: GetComplementByID :one
SELECT * FROM complements WHERE id = $1;

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

-- ===== Complementos que agregan funciones (10i, spec/11 §12) =====

-- name: SetComplementManifest :one
-- Una versión nueva: lo aprobado que ya no declara se olvida en Go.
UPDATE complements SET manifest = $2, approved = $3, updated_at = now() WHERE id = $1
RETURNING *;

-- name: SetComplementApprovals :one
UPDATE complements SET approved = $2, is_house = $3, updated_at = now() WHERE id = $1
RETURNING *;

-- name: SetComplementSettings :exec
UPDATE complements SET settings = $2, secrets_encrypted = $3, updated_at = now() WHERE id = $1;

-- name: SetComplementCredentials :exec
-- La llave de integraciones y el secreto de los ganchos, cifrados; el
-- servicio los pide con su token de aplicación.
UPDATE complements SET integration_key_encrypted = $2, hook_secret_encrypted = $3 WHERE id = $1;

-- name: GetComplementAPIKey :one
SELECT * FROM api_keys WHERE complement_id = $1 AND active;

-- name: CreateComplementAPIKey :one
INSERT INTO api_keys (name, description, key_prefix, key_hash, scopes, created_by, complement_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: SetAPIKeyScopes :exec
UPDATE api_keys SET scopes = $2 WHERE id = $1;

-- name: RevokeComplementAPIKeys :exec
UPDATE api_keys SET active = false, revoked_at = now(), revoked_by = sqlc.narg('revoked_by'), revoke_reason = sqlc.narg('reason')
WHERE complement_id = sqlc.arg('complement_id') AND active;

-- name: GetComplementDestination :one
SELECT * FROM forward_destinations WHERE complement_id = $1;

-- name: UpsertComplementDestination :one
-- Destino HTTP interno del complemento con los eventos aprobados. Al crearse
-- parte desde ahora: no recibe lo de antes.
INSERT INTO forward_destinations (name, enabled, transport, url, format, batch, send_audit, audit_level,
  send_entries, send_escalation, send_tickets, header_names, complement_id, events, hmac_secret_encrypted, cursor_id, created_by)
VALUES (sqlc.arg('name'), true, 'http', sqlc.arg('url'), 'json', false, false, 'info',
  sqlc.arg('send_entries'), sqlc.arg('send_escalation'), sqlc.arg('send_tickets'), '{}', sqlc.arg('complement_id'),
  sqlc.arg('events')::text[], sqlc.arg('hmac_secret_encrypted'), (SELECT COALESCE(max(fo.id), 0) FROM forward_outbox fo), sqlc.narg('created_by'))
ON CONFLICT (complement_id) WHERE complement_id IS NOT NULL DO UPDATE SET
  name = EXCLUDED.name, url = EXCLUDED.url, send_entries = EXCLUDED.send_entries, send_escalation = EXCLUDED.send_escalation,
  send_tickets = EXCLUDED.send_tickets, events = EXCLUDED.events, hmac_secret_encrypted = EXCLUDED.hmac_secret_encrypted,
  enabled = true, updated_at = now()
RETURNING *;

-- name: DeleteComplementDestination :exec
DELETE FROM forward_destinations WHERE complement_id = $1;

-- name: ListComplementSchedules :many
SELECT * FROM complement_schedules WHERE complement_id = $1 ORDER BY name;

-- name: UpsertComplementSchedule :exec
-- Si la tarea ya existía se queda con la próxima ejecución más cercana.
INSERT INTO complement_schedules (complement_id, name, next_run_at) VALUES ($1, $2, $3)
ON CONFLICT (complement_id, name) DO UPDATE SET next_run_at = LEAST(complement_schedules.next_run_at, EXCLUDED.next_run_at);

-- name: DeleteComplementSchedulesExcept :exec
DELETE FROM complement_schedules WHERE complement_id = sqlc.arg('complement_id') AND NOT (name = ANY(sqlc.arg('keep')::text[]));

-- name: ListDueComplementSchedules :many
SELECT s.complement_id, s.name FROM complement_schedules s JOIN complements c ON c.id = s.complement_id
WHERE s.next_run_at <= now() AND c.status = 'active' AND (s.lease_until IS NULL OR s.lease_until < now())
ORDER BY s.next_run_at
LIMIT 50;

-- name: AcquireComplementSchedule :one
-- Un solo nodo la dispara: préstamo de 2 minutos.
UPDATE complement_schedules SET lease_until = now() + interval '2 minutes', lease_owner = sqlc.arg('owner')
WHERE complement_id = sqlc.arg('complement_id') AND name = sqlc.arg('name') AND next_run_at <= now()
  AND (lease_until IS NULL OR lease_until < now())
RETURNING *;

-- name: FinishComplementSchedule :exec
UPDATE complement_schedules SET next_run_at = sqlc.arg('next_run_at'), last_run_at = now(), last_status = sqlc.arg('status'),
  lease_until = NULL, lease_owner = NULL
WHERE complement_id = sqlc.arg('complement_id') AND name = sqlc.arg('name');
