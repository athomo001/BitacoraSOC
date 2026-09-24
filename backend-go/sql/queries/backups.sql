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