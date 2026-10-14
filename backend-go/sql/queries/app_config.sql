-- name: GetAppConfig :one
SELECT * FROM app_config WHERE id = true;

-- name: EnsureAppConfigRow :exec
-- app_config es singleton pero no viene precargado por la migración inicial
-- (03-esquema-db.sql no tiene un INSERT semilla) — GET /api/setup/status
-- necesita una fila para leer, así que se asegura antes de leer si todavía
-- no existe, con los defaults de la propia tabla.
INSERT INTO app_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- name: CompleteSetup :one
-- Qué áreas quedan activas lo guarda SetAreaActiveByCode (000033).
UPDATE app_config SET
  setup_completed_at = now(),
  updated_at = now()
WHERE id = true
RETURNING *;

-- name: MergeTerritorialLabels :one
-- PATCH /api/config/territorial-labels — merge parcial (jsonb ||): solo pisa
-- los niveles que vienen en el request, el resto queda como estaba.
UPDATE app_config SET
  territorial_kind_labels = territorial_kind_labels || sqlc.arg('labels')::jsonb,
  updated_at = now()
WHERE id = true
RETURNING territorial_kind_labels;
