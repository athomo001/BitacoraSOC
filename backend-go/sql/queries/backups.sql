-- name: CreateBackupRun :one
INSERT INTO backup_runs (kind, window_from, window_to, triggered_by)
VALUES ($1, sqlc.narg('window_from'), sqlc.narg('window_to'), $2) RETURNING *;

-- name: MarkBackupRun :one
UPDATE backup_runs SET records_count=$2, finished_at=now(), status=$3, file_path=sqlc.narg('file_path'), file_size_bytes=sqlc.narg('file_size_bytes'), checksum_sha256=sqlc.narg('checksum_sha256'), error_message=sqlc.narg('error_message') WHERE id=$1 RETURNING *;

-- name: ListBackupRuns :many
SELECT * FROM backup_runs WHERE (sqlc.narg('kind')::backup_kind IS NULL OR kind=sqlc.narg('kind')) ORDER BY started_at DESC LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountBackupRuns :one
SELECT count(*) FROM backup_runs WHERE (sqlc.narg('kind')::backup_kind IS NULL OR kind=sqlc.narg('kind'));

-- name: GetBackupRun :one
SELECT * FROM backup_runs WHERE id=$1;

-- name: DeleteBackupRun :one
DELETE FROM backup_runs WHERE id=$1 RETURNING *;
-- name: CreateBackupRunWithSource :one
INSERT INTO backup_runs (kind, trigger_source, triggered_by)
VALUES ($1, $2, sqlc.narg('triggered_by')) RETURNING *;

-- name: GetBackupConfig :one
SELECT * FROM backup_config WHERE id;

-- name: UpdateBackupConfig :one
UPDATE backup_config SET
  enabled = $1, interval_days = $2, run_at = $3, timezone = $4, retention_days = $5,
  destination_type = $6, destination_path = sqlc.narg('destination_path'),
  passphrase_encrypted = COALESCE(sqlc.narg('passphrase_encrypted'), passphrase_encrypted),
  next_run_at = sqlc.narg('next_run_at'), updated_by = sqlc.narg('updated_by'), updated_at = now()
WHERE id RETURNING *;

-- name: MarkBackupConfigRun :exec
UPDATE backup_config SET last_run_at = sqlc.narg('last_run_at'), last_status = $1, last_message = sqlc.narg('last_message'),
  next_run_at = COALESCE(sqlc.narg('next_run_at'), next_run_at)
WHERE id;

-- name: ListExpiredAutoBackups :many
-- Copias automáticas fuera de la retención: el planificador las borra (archivo y fila).
SELECT * FROM backup_runs WHERE trigger_source = 'auto' AND started_at < $1;
