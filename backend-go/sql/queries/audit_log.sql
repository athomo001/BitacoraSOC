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

-- name: ListAuditLogs :many
-- GET /api/audit-logs — paginado simple, más reciente primero.
SELECT * FROM audit_log
ORDER BY "timestamp" DESC
LIMIT $1 OFFSET $2;

-- name: CountAuditLogs :one
SELECT count(*) FROM audit_log;
