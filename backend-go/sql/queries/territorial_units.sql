-- name: ListTerritorialUnits :many
-- GET /api/territorial-units — ?parentId= devuelve un nivel (hijos directos);
-- sin parentId devuelve el árbol completo aplanado, ordenado por path (el
-- frontend lo indenta por nlevel sin reconstruir nada). child_count deja al
-- frontend saber si un nodo es expandible sin pedir otro nivel a ciegas.
SELECT tu.*,
  (SELECT count(*) FROM territorial_units c WHERE c.parent_id = tu.id)::int AS child_count
FROM territorial_units tu
WHERE (sqlc.narg('parent_id')::uuid IS NULL OR tu.parent_id = sqlc.narg('parent_id'))
  AND (sqlc.narg('active')::boolean IS NULL OR tu.active = sqlc.narg('active'))
ORDER BY tu.path
LIMIT sqlc.arg('page_size') OFFSET sqlc.arg('page_offset');

-- name: CountTerritorialUnits :one
SELECT count(*) FROM territorial_units
WHERE (sqlc.narg('parent_id')::uuid IS NULL OR parent_id = sqlc.narg('parent_id'))
  AND (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'));

-- name: GetTerritorialUnit :one
SELECT * FROM territorial_units WHERE id = $1;

-- name: GetTerritorialUnitPathByCodeForUpdate :one
-- Lock de la fila antes del upsert del import: si el code ya existía con
-- otro path (el dataset lo movió de padre), hay que reubicar sus
-- descendientes con el path viejo — ver RebaseTerritorialSubtree.
SELECT path FROM territorial_units WHERE code = $1 FOR UPDATE;

-- name: CreateTerritorialUnit :one
INSERT INTO territorial_units (parent_id, kind, name, code, path, address, latitude, longitude)
VALUES ($1, $2, $3, $4, sqlc.arg('path')::ltree, $5, $6, $7)
RETURNING *;

-- name: UpsertTerritorialUnit :one
-- POST /api/territorial-units/import — upsert por code (idempotente). No
-- toca `active` ni `address`: si el admin desactivó o completó a mano una
-- fila importada, reimportar el dataset no se lo pisa (HU-TERR-3). Las
-- coordenadas solo se actualizan si el import trae un valor, nunca se
-- borran por venir vacías. `xmax = 0` distingue insert de update.
INSERT INTO territorial_units (parent_id, kind, name, code, path, latitude, longitude)
VALUES ($1, $2, $3, $4, sqlc.arg('path')::ltree, $5, $6)
ON CONFLICT (code) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  kind = EXCLUDED.kind,
  name = EXCLUDED.name,
  path = EXCLUDED.path,
  latitude = COALESCE(EXCLUDED.latitude, territorial_units.latitude),
  longitude = COALESCE(EXCLUDED.longitude, territorial_units.longitude)
RETURNING id, path, (xmax = 0)::boolean AS inserted;

-- name: RebaseTerritorialSubtree :exec
-- Reubica los descendientes de un nodo cuyo path cambió (reimport que lo
-- movió de padre) — incluidos los sitios agregados a mano que el dataset
-- no conoce y por lo tanto no vuelve a upsertear.
UPDATE territorial_units
SET path = sqlc.arg('new_path')::ltree || subpath(path, nlevel(sqlc.arg('old_path')::ltree))
WHERE path <@ sqlc.arg('old_path')::ltree AND path <> sqlc.arg('old_path')::ltree;

-- name: UpdateTerritorialUnit :one
-- PATCH /api/territorial-units/:id — correcciones manuales (HU-TERR-3). No
-- permite cambiar code/kind/parent: eso reescribiría el árbol y es
-- administración fina fuera del alcance de la Fase 5.
UPDATE territorial_units SET
  name = COALESCE(sqlc.narg('name'), name),
  address = COALESCE(sqlc.narg('address'), address),
  latitude = COALESCE(sqlc.narg('latitude'), latitude),
  longitude = COALESCE(sqlc.narg('longitude'), longitude),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1
RETURNING *;
