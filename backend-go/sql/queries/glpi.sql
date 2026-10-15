-- Importación desde GLPI (spec/16 §5.1, 9.6, 000043).

-- name: GetGlpiConfig :one
SELECT * FROM glpi_config WHERE id;

-- name: UpdateGlpiConfig :exec
UPDATE glpi_config SET api_url = sqlc.arg('api_url'), app_token_encrypted = sqlc.narg('app_token_encrypted'),
  user_token_encrypted = sqlc.narg('user_token_encrypted'), verify_tls = sqlc.arg('verify_tls'),
  timeout_seconds = sqlc.arg('timeout_seconds'), import_computers = sqlc.arg('import_computers'),
  import_network = sqlc.arg('import_network'), area_id = sqlc.narg('area_id'),
  computer_types = sqlc.arg('computer_types'), entities = sqlc.arg('entities'), auto_mode = sqlc.arg('auto_mode'),
  updated_at = now()
WHERE id;

-- name: RecordGlpiTest :exec
UPDATE glpi_config SET last_test_at = now(), last_test_ok = sqlc.arg('ok'), last_test = sqlc.arg('result') WHERE id;

-- name: MarkGlpiAutoRun :exec
UPDATE glpi_config SET last_auto_at = sqlc.arg('at') WHERE id;

-- name: MarkGlpiFailureNotified :exec
UPDATE glpi_config SET last_failure_notified_on = sqlc.arg('day') WHERE id;

-- name: CreateGlpiRun :one
INSERT INTO glpi_import_runs (trigger, user_id) VALUES (sqlc.arg('trigger'), sqlc.narg('user_id')) RETURNING id;

-- name: FinishGlpiRun :exec
UPDATE glpi_import_runs SET finished_at = now(), ok = sqlc.arg('ok'), created = sqlc.arg('created'), updated = sqlc.arg('updated'),
  deactivated = sqlc.arg('deactivated'), reactivated = sqlc.arg('reactivated'), skipped = sqlc.arg('skipped'),
  unchanged = sqlc.arg('unchanged'), held_back = sqlc.arg('held_back'), message = sqlc.arg('message')
WHERE id = sqlc.arg('id');

-- name: ListGlpiRuns :many
SELECT r.*, COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name
FROM glpi_import_runs r
LEFT JOIN users u ON u.id = r.user_id
ORDER BY r.started_at DESC
LIMIT 20;

-- name: ListGlpiLinkedAssets :many
-- Los equipos que vienen de GLPI (activos o no).
SELECT id, code, name, active, glpi_itemtype::text AS glpi_itemtype, glpi_id::int AS glpi_id, glpi_removed_at
FROM assets WHERE glpi_id IS NOT NULL;

-- name: ListAssetsBySerial :many
-- Equipos creados en la app (sin vínculo con GLPI) con alguna de estas series.
SELECT id, code, name, serial::text AS serial FROM assets
WHERE glpi_id IS NULL AND serial IS NOT NULL AND lower(serial) = ANY(sqlc.arg('serials')::text[]);

-- name: SetAssetGlpiLink :exec
UPDATE assets SET glpi_itemtype = sqlc.arg('glpi_itemtype'), glpi_id = sqlc.arg('glpi_id'), glpi_removed_at = NULL, updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SetAssetGlpiRemoved :exec
-- removed=true: dado de baja porque desapareció de GLPI; false: volvió.
UPDATE assets SET active = NOT sqlc.arg('removed')::bool,
  glpi_removed_at = CASE WHEN sqlc.arg('removed')::bool THEN now() ELSE NULL END, updated_at = now()
WHERE id = sqlc.arg('id');

-- name: AssetCodeTaken :one
SELECT EXISTS (SELECT 1 FROM assets WHERE code = $1);
