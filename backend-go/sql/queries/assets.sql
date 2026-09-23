-- ip_address es INET: se lee y escribe como texto (::text / ::inet) para que
-- el tipo Go sea string y Postgres valide el formato (IPv4/IPv6) al insertar.

-- name: ListAssets :many
SELECT a.id, a.type, a.name, a.code, COALESCE(host(a.ip_address), '')::text AS ip_address, a.metadata,
  a.address, a.latitude, a.longitude, a.territorial_unit_id, a.client_id,
  a.contractor_id, a.log_source_id, a.parent_asset_id, a.active
FROM assets a
WHERE (sqlc.narg('territorial_unit_id')::uuid IS NULL OR a.territorial_unit_id = sqlc.narg('territorial_unit_id'))
  AND (sqlc.narg('client_id')::uuid IS NULL OR a.client_id = sqlc.narg('client_id'))
  AND (sqlc.narg('contractor_id')::uuid IS NULL OR a.contractor_id = sqlc.narg('contractor_id'))
  AND (sqlc.narg('type')::asset_type IS NULL OR a.type = sqlc.narg('type'))
ORDER BY a.name;

-- name: GetAsset :one
SELECT a.id, a.type, a.name, a.code, COALESCE(host(a.ip_address), '')::text AS ip_address, a.metadata,
  a.address, a.latitude, a.longitude, a.territorial_unit_id, a.client_id,
  a.contractor_id, a.log_source_id, a.parent_asset_id, a.active
FROM assets a WHERE a.id = $1;

-- name: AssetIPTaken :one
-- 409 de spec/04-contratos-api.md: la IP de un activo es su identidad operativa.
SELECT EXISTS (
  SELECT 1 FROM assets
  WHERE ip_address = sqlc.arg('ip')::text::inet AND id <> sqlc.arg('except_id')::uuid
) AS taken;

-- name: CreateAsset :one
INSERT INTO assets (type, name, code, ip_address, metadata, address, latitude, longitude,
  territorial_unit_id, client_id, contractor_id, log_source_id, parent_asset_id)
VALUES (sqlc.arg('type'), sqlc.arg('name'), sqlc.arg('code'), sqlc.narg('ip_address')::text::inet,
  sqlc.arg('metadata'), sqlc.narg('address'), sqlc.narg('latitude'), sqlc.narg('longitude'),
  sqlc.arg('territorial_unit_id'), sqlc.narg('client_id'), sqlc.narg('contractor_id'),
  sqlc.narg('log_source_id'), sqlc.narg('parent_asset_id'))
RETURNING id;

-- name: UpdateAsset :execrows
UPDATE assets SET
  name = COALESCE(sqlc.narg('name'), name),
  ip_address = COALESCE(sqlc.narg('ip_address')::text::inet, ip_address),
  metadata = COALESCE(sqlc.narg('metadata'), metadata),
  address = COALESCE(sqlc.narg('address'), address),
  latitude = COALESCE(sqlc.narg('latitude'), latitude),
  longitude = COALESCE(sqlc.narg('longitude'), longitude),
  client_id = COALESCE(sqlc.narg('client_id'), client_id),
  contractor_id = COALESCE(sqlc.narg('contractor_id'), contractor_id),
  log_source_id = COALESCE(sqlc.narg('log_source_id'), log_source_id),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = sqlc.arg('id');
