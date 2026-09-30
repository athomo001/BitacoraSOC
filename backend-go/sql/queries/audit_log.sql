-- name: InsertAuditLog :exec
INSERT INTO audit_log (
  id, event, level, actor_user_id, actor_username, actor_role,
  request_id, request_ip, request_path, request_method,
  user_agent, device_fingerprint, ip_changed, previous_ip,
  success, reason, source, source_id, metadata
) VALUES (
  $19, $1, $2, $3, $4, $5,
  $6, $7, $8, $9,
  $10, $11, $12, $13,
  $14, $15, $16, $17, $18
);


-- Los tres comparten el mismo filtro (GET /api/audit-logs y su /export):
--   events  dominios o eventos exactos: ["auth","setup"] trae auth.login.fail, setup.bootstrap…
--   level   info | warn | error
--   success true = resultado OK, false = fallo
--   q       texto libre sobre actor, IP, ruta, evento y motivo (ya escapado para LIKE)
-- Más reciente primero.

-- name: ListAuditLogs :many
SELECT * FROM audit_log
WHERE (sqlc.narg('events')::text[] IS NULL
       OR EXISTS (SELECT 1 FROM unnest(sqlc.narg('events')::text[]) AS p(prefix) WHERE event = p.prefix OR starts_with(event, p.prefix || '.')))
  AND (sqlc.narg('level')::text IS NULL OR level = sqlc.narg('level'))
  AND (sqlc.narg('success')::boolean IS NULL OR success = sqlc.narg('success'))
  AND (sqlc.narg('actor_user_id')::uuid IS NULL OR actor_user_id = sqlc.narg('actor_user_id'))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR "timestamp" >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR "timestamp" < sqlc.narg('to_date'))
  AND (sqlc.narg('q')::text IS NULL
       OR actor_username ILIKE '%' || sqlc.narg('q') || '%'
       OR request_ip ILIKE '%' || sqlc.narg('q') || '%'
       OR request_path ILIKE '%' || sqlc.narg('q') || '%'
       OR event ILIKE '%' || sqlc.narg('q') || '%'
       OR reason ILIKE '%' || sqlc.narg('q') || '%')
ORDER BY "timestamp" DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: CountAuditLogs :one
SELECT count(*) FROM audit_log
WHERE (sqlc.narg('events')::text[] IS NULL
       OR EXISTS (SELECT 1 FROM unnest(sqlc.narg('events')::text[]) AS p(prefix) WHERE event = p.prefix OR starts_with(event, p.prefix || '.')))
  AND (sqlc.narg('level')::text IS NULL OR level = sqlc.narg('level'))
  AND (sqlc.narg('success')::boolean IS NULL OR success = sqlc.narg('success'))
  AND (sqlc.narg('actor_user_id')::uuid IS NULL OR actor_user_id = sqlc.narg('actor_user_id'))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR "timestamp" >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR "timestamp" < sqlc.narg('to_date'))
  AND (sqlc.narg('q')::text IS NULL
       OR actor_username ILIKE '%' || sqlc.narg('q') || '%'
       OR request_ip ILIKE '%' || sqlc.narg('q') || '%'
       OR request_path ILIKE '%' || sqlc.narg('q') || '%'
       OR event ILIKE '%' || sqlc.narg('q') || '%'
       OR reason ILIKE '%' || sqlc.narg('q') || '%');

-- name: ListAuditLogsForExport :many
SELECT * FROM audit_log
WHERE (sqlc.narg('events')::text[] IS NULL
       OR EXISTS (SELECT 1 FROM unnest(sqlc.narg('events')::text[]) AS p(prefix) WHERE event = p.prefix OR starts_with(event, p.prefix || '.')))
  AND (sqlc.narg('level')::text IS NULL OR level = sqlc.narg('level'))
  AND (sqlc.narg('success')::boolean IS NULL OR success = sqlc.narg('success'))
  AND (sqlc.narg('actor_user_id')::uuid IS NULL OR actor_user_id = sqlc.narg('actor_user_id'))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR "timestamp" >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR "timestamp" < sqlc.narg('to_date'))
  AND (sqlc.narg('q')::text IS NULL
       OR actor_username ILIKE '%' || sqlc.narg('q') || '%'
       OR request_ip ILIKE '%' || sqlc.narg('q') || '%'
       OR request_path ILIKE '%' || sqlc.narg('q') || '%'
       OR event ILIKE '%' || sqlc.narg('q') || '%'
       OR reason ILIKE '%' || sqlc.narg('q') || '%')
ORDER BY "timestamp" DESC;
