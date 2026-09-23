-- name: ListLogSources :many
SELECT * FROM catalog_log_sources
WHERE (sqlc.narg('category')::text IS NULL OR category = sqlc.narg('category'))
  AND (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY display_name;

-- name: CreateLogSource :one
INSERT INTO catalog_log_sources (code, display_name, category, default_parser)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdateLogSource :one
UPDATE catalog_log_sources SET
  display_name = COALESCE(sqlc.narg('display_name'), display_name),
  category = COALESCE(sqlc.narg('category'), category),
  default_parser = COALESCE(sqlc.narg('default_parser'), default_parser),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1
RETURNING *;
