-- name: ListSystemFeatures :many
SELECT * FROM system_features ORDER BY code;

-- name: UpdateSystemFeature :one
UPDATE system_features SET
  is_enabled = $2,
  config_payload = COALESCE(sqlc.narg('config_payload'), config_payload),
  updated_by = $3,
  updated_at = now()
WHERE code = $1
RETURNING *;
