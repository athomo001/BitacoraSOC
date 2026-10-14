-- Áreas y niveles (000033, spec/16 §3).

-- name: ListAreas :many
SELECT * FROM areas ORDER BY sort_order, name;

-- name: ListLevels :many
SELECT * FROM levels ORDER BY rank, name;

-- name: ListGroupAreaCodes :many
-- Las áreas de varios grupos de una vez (para listarlos sin N consultas).
SELECT pa.permission_group_id, a.code
FROM permission_group_areas pa JOIN areas a ON a.id = pa.area_id
WHERE pa.permission_group_id = ANY(sqlc.arg('group_ids')::uuid[])
ORDER BY a.sort_order, a.name;

-- name: ClearGroupAreas :exec
DELETE FROM permission_group_areas WHERE permission_group_id = $1;

-- name: AddGroupAreasByCode :execrows
INSERT INTO permission_group_areas (permission_group_id, area_id)
SELECT sqlc.arg('group_id'), a.id FROM areas a WHERE a.code = ANY(sqlc.arg('codes')::text[])
ON CONFLICT DO NOTHING;

-- name: ListUserAreaCodes :many
-- Las áreas que ve un usuario: la unión de las de sus grupos activos.
SELECT DISTINCT a.code
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
JOIN areas a ON a.id = pa.area_id
WHERE upg.user_id = $1;

-- ===== Administración → Áreas y niveles (spec/16, 9b) =====

-- name: ListAreasWithUsage :many
SELECT a.*, (SELECT count(*) FROM permission_group_areas pa WHERE pa.area_id = a.id)::int AS group_count
FROM areas a ORDER BY a.sort_order, a.name;

-- name: CreateArea :one
INSERT INTO areas (code, name, sort_order)
VALUES (sqlc.arg('code'), sqlc.arg('name'), (SELECT COALESCE(max(sort_order), 0) + 10 FROM areas))
RETURNING *;

-- name: UpdateArea :one
UPDATE areas SET
  name = COALESCE(sqlc.narg('name'), name),
  active = COALESCE(sqlc.narg('active'), active),
  default_profile = COALESCE(sqlc.narg('default_profile'), default_profile)
WHERE code = sqlc.arg('code')
RETURNING *;

-- name: ListLevelsWithUsage :many
SELECT l.*, (SELECT count(*) FROM permission_groups g WHERE g.level_id = l.id)::int AS group_count
FROM levels l ORDER BY l.rank, l.name;

-- name: CreateLevel :one
INSERT INTO levels (code, name, rank)
VALUES (sqlc.arg('code'), sqlc.arg('name'), (SELECT COALESCE(max(rank), 0) + 1 FROM levels))
RETURNING *;

-- name: RenameLevel :one
UPDATE levels SET name = sqlc.arg('name') WHERE id = sqlc.arg('id') RETURNING *;

-- name: SetLevelRank :execrows
UPDATE levels SET rank = sqlc.arg('rank') WHERE id = sqlc.arg('id');

-- name: ListUserModuleAreaCodes :many
-- Las áreas que abren SOC/NOC (Bitácora, Turnos, Escalamiento, Reportes):
-- solo las de grupos con perfil Operativo (spec/16 §3.2, 9c). Un Resolutor o
-- un grupo de Gestión con el área SOC ve sus datos, no la bitácora.
SELECT DISTINCT a.code
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active AND pg.profile = 'operativo'
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
JOIN areas a ON a.id = pa.area_id
WHERE upg.user_id = $1;

-- name: ListUserProfiles :many
SELECT DISTINCT pg.profile
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
WHERE upg.user_id = $1;
