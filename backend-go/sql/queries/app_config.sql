-- name: GetAppConfig :one
SELECT * FROM app_config WHERE id = true;

-- name: EnsureAppConfigRow :exec
-- app_config es singleton pero no viene precargado por la migración inicial
-- (03-esquema-db.sql no tiene un INSERT semilla) — GET /api/setup/status
-- necesita una fila para leer, así que se asegura antes de leer si todavía
-- no existe, con los defaults de la propia tabla.
INSERT INTO app_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- name: CompleteSetup :one
-- Qué módulos quedan encendidos lo guarda SetModuleFlags.
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

-- name: GetModuleFlags :one
-- Los módulos SOC y NOC de la instalación (000036). Distintos de las áreas.
SELECT soc_module_enabled, noc_module_enabled FROM app_config WHERE id = true;

-- name: SetModuleFlags :exec
UPDATE app_config SET soc_module_enabled = sqlc.arg('soc'), noc_module_enabled = sqlc.arg('noc'), updated_at = now() WHERE id = true;

-- name: GetMapTiles :one
-- Fondo del Mapa (000037).
SELECT map_tiles_mode, map_tiles_url FROM app_config WHERE id = true;

-- name: SetMapTiles :exec
UPDATE app_config SET map_tiles_mode = sqlc.arg('mode'), map_tiles_url = sqlc.arg('url'), updated_at = now() WHERE id = true;
