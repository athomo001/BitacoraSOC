-- Usuarios por área y nivel (2026-10-13): la persona se ubica en cada área
-- con un nivel; los grupos («Infra N1», «Jefatura Infra», «Directorio:
-- escribir») se arman solos.

-- name: ListUserGroupShapes :many
-- Los grupos activos de la persona con su forma: áreas, nivel y capacidades.
SELECT pg.id, pg.name, pg.level_id, pg.capabilities,
  COALESCE(array_agg(a.code ORDER BY a.code) FILTER (WHERE a.code IS NOT NULL), '{}')::text[] AS area_codes
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
LEFT JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
LEFT JOIN areas a ON a.id = pa.area_id
WHERE upg.user_id = $1
GROUP BY pg.id
ORDER BY pg.name;

-- name: FindShapedGroup :one
-- Un grupo activo con exactamente esa forma: un área (o ninguna), ese nivel
-- (o ninguno) y esas capacidades. El más antiguo, si hubiera varios.
SELECT pg.id FROM permission_groups pg
WHERE pg.active
  AND pg.level_id IS NOT DISTINCT FROM sqlc.narg('level_id')::uuid
  AND pg.capabilities @> sqlc.arg('capabilities')::text[] AND pg.capabilities <@ sqlc.arg('capabilities')::text[]
  AND COALESCE((SELECT array_agg(a.code ORDER BY a.code) FROM permission_group_areas pa JOIN areas a ON a.id = pa.area_id
                WHERE pa.permission_group_id = pg.id), '{}')::text[] = sqlc.arg('area_codes')::text[]
ORDER BY pg.created_at
LIMIT 1;

-- name: GroupCodeTaken :one
SELECT EXISTS (SELECT 1 FROM permission_groups WHERE code = $1);
