-- Departamentos (spec/16 §3.5.1, 000060).

-- name: ListDepartments :many
SELECT d.id, d.name, d.sort_order,
  COALESCE((SELECT array_agg(a.code ORDER BY a.sort_order, a.name) FROM areas a WHERE a.department_id = d.id), '{}')::text[] AS area_codes,
  COALESCE((SELECT array_agg(a.code ORDER BY a.sort_order, a.name) FROM areas a WHERE a.department_id = d.id AND a.shares_team), '{}')::text[] AS shared_codes,
  COALESCE((SELECT pg.id FROM permission_groups pg WHERE pg.department_id = d.id), '00000000-0000-0000-0000-000000000000')::uuid AS lead_group_id
FROM departments d
ORDER BY d.sort_order, d.name;

-- name: ListDepartmentLeads :many
-- La gente del grupo de jefatura de cada departamento.
SELECT pg.department_id::uuid AS department_id, u.id AS user_id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS name
FROM permission_groups pg
JOIN user_permission_groups upg ON upg.permission_group_id = pg.id
JOIN users u ON u.id = upg.user_id AND u.active
WHERE pg.department_id IS NOT NULL
ORDER BY 3;

-- name: CreateDepartment :one
INSERT INTO departments (name, sort_order)
VALUES ($1, COALESCE((SELECT max(sort_order) + 1 FROM departments), 0))
RETURNING id, name, sort_order, created_at;

-- name: CreateDepartmentLeadGroup :one
-- El grupo de jefatura que la app mantiene para el departamento.
INSERT INTO permission_groups (code, name, capabilities, profile, department_id)
VALUES ($1, $2, '{area:lead}', 'resolutor', $3)
RETURNING id;

-- name: RenameDepartment :exec
UPDATE departments SET name = $2 WHERE id = $1;

-- name: RenameDepartmentLeadGroup :exec
UPDATE permission_groups SET name = $2 WHERE department_id = $1;

-- name: DeleteDepartment :exec
-- Sus áreas quedan sin departamento (ON DELETE SET NULL) y su grupo de
-- jefatura se borra (ON DELETE CASCADE).
DELETE FROM departments WHERE id = $1;

-- name: ClearDepartmentAreas :exec
UPDATE areas SET department_id = NULL, shares_team = false WHERE department_id = $1;

-- name: SetAreasDepartment :exec
UPDATE areas SET department_id = sqlc.arg('department_id')::uuid WHERE code = ANY(sqlc.arg('codes')::text[]);

-- name: SetSharedAreas :exec
-- Marca qué áreas del departamento comparten equipo.
UPDATE areas SET shares_team = (code = ANY(sqlc.arg('codes')::text[])) WHERE department_id = sqlc.arg('department_id')::uuid;

-- name: SyncDepartmentLeadAreas :exec
-- El grupo de jefatura del departamento queda con todas sus áreas.
WITH g AS (SELECT id FROM permission_groups WHERE department_id = sqlc.arg('department_id')::uuid),
del AS (
  DELETE FROM permission_group_areas pa USING g
  WHERE pa.permission_group_id = g.id AND pa.area_id NOT IN (SELECT id FROM areas WHERE department_id = sqlc.arg('department_id')::uuid)
)
INSERT INTO permission_group_areas (permission_group_id, area_id)
SELECT g.id, a.id FROM g, areas a WHERE a.department_id = sqlc.arg('department_id')::uuid
ON CONFLICT DO NOTHING;

-- name: ClearGroupMembers :exec
DELETE FROM user_permission_groups WHERE permission_group_id = $1;

-- name: ListSharedSets :many
-- Las áreas que comparten equipo, por departamento (solo los de dos o más).
SELECT department_id::uuid AS department_id, array_agg(code ORDER BY code)::text[] AS codes
FROM areas
WHERE shares_team AND department_id IS NOT NULL AND active
GROUP BY department_id
HAVING count(*) > 1;

-- name: ListSharedAreaMembers :many
-- Quienes están en alguna de esas áreas (por cualquier grupo activo).
SELECT DISTINCT upg.user_id
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active AND pg.department_id IS NULL
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
JOIN areas a ON a.id = pa.area_id
WHERE a.code = ANY(sqlc.arg('codes')::text[]);

-- name: ListManagementScopes :many
SELECT user_id, department_id, area_id FROM management_scopes;

-- name: ListManagementScopeAreas :many
-- Las áreas que ve una CSM con alcance (por sus departamentos o áreas).
SELECT DISTINCT a.id FROM management_scopes s
JOIN areas a ON a.id = s.area_id OR a.department_id = s.department_id
WHERE s.user_id = $1;

-- name: AddManagementScope :exec
INSERT INTO management_scopes (user_id, department_id, area_id) VALUES ($1, $2, $3);

-- name: ListMarkedCSMs :many
-- Las personas activas marcadas como CSM (capacidad csm, en su panel).
SELECT DISTINCT u.id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS name
FROM users u
JOIN user_permission_groups upg ON upg.user_id = u.id
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active AND 'csm' = ANY(pg.capabilities)
WHERE u.active
ORDER BY 2;

-- name: ClearDepartmentScopes :exec
-- Las CSM asignadas a un departamento (al departamento entero o a sus áreas).
DELETE FROM management_scopes s WHERE s.department_id = $1 OR s.area_id IN (SELECT a.id FROM areas a WHERE a.department_id = $1);

-- name: DeleteAreaScopes :exec
-- Un área que deja su departamento deja también sus CSM.
DELETE FROM management_scopes WHERE area_id = ANY(sqlc.arg('area_ids')::uuid[]);

-- name: ListClientsWithTicketsInAreas :many
-- Los clientes que atienden esas áreas (tienen tickets en ellas): los que ve
-- una CSM con alcance, además de los suyos.
SELECT DISTINCT t.client_id FROM tickets t WHERE t.area_id = ANY(sqlc.arg('area_ids')::uuid[]);
