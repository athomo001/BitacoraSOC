-- Borrar y unir áreas (pedido del dueño 2026-10-22, spec/16 §3.3.3): un área
-- vacía se borra; una con gente o datos se une a otra (todo pasa al destino) y
-- queda vacía para borrarla.

-- name: AreaUsage :one
-- Lo que tiene un área: su gente (sin contar la jefatura de un departamento)
-- y sus datos.
SELECT
  (SELECT count(DISTINCT upg.user_id) FROM user_permission_groups upg
     JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active AND pg.department_id IS NULL
     JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
     WHERE pa.area_id = sqlc.arg('area_id')::uuid)::int AS people,
  (SELECT count(*) FROM tickets WHERE area_id = sqlc.arg('area_id')::uuid OR requested_area_id = sqlc.arg('area_id')::uuid)::int AS tickets,
  (SELECT count(*) FROM assets WHERE area_id = sqlc.arg('area_id')::uuid)::int AS assets,
  (SELECT count(*) FROM teams WHERE area_id = sqlc.arg('area_id')::uuid)::int AS teams,
  (SELECT count(*) FROM escalation_policies WHERE area_id = sqlc.arg('area_id')::uuid)::int AS policies,
  (SELECT count(*) FROM agenda_tasks WHERE area_id = sqlc.arg('area_id')::uuid)::int AS tasks,
  (SELECT count(*) FROM goals WHERE area_id = sqlc.arg('area_id')::uuid)::int AS goals,
  ((SELECT count(*) FROM maintenance_windows WHERE area_id = sqlc.arg('area_id')::uuid)
    + (SELECT count(*) FROM maintenance_window_series WHERE area_id = sqlc.arg('area_id')::uuid))::int AS windows,
  ((SELECT count(*) FROM asset_responsibles WHERE area_id = sqlc.arg('area_id')::uuid)
    + (SELECT count(*) FROM playbook_items WHERE area_id = sqlc.arg('area_id')::uuid)
    + (SELECT count(*) FROM api_keys WHERE area_id = sqlc.arg('area_id')::uuid)
    + (SELECT count(*) FROM glpi_config WHERE area_id = sqlc.arg('area_id')::uuid)
    + (SELECT count(*) FROM public_share_links WHERE sqlc.arg('area_id')::uuid = ANY(area_ids)))::int AS other;

-- name: MoveAreaData :exec
-- Pasa todos los datos de un área a otra (la gente se mueve aparte, con su
-- nivel). Las fotos del Resumen mensual del destino se rehacen al abrirlas.
WITH t AS (
  UPDATE tickets SET
    area_id = CASE WHEN area_id = sqlc.arg('from_id')::uuid THEN sqlc.arg('to_id')::uuid ELSE area_id END,
    requested_area_id = CASE WHEN requested_area_id = sqlc.arg('from_id')::uuid THEN sqlc.arg('to_id')::uuid ELSE requested_area_id END
  WHERE area_id = sqlc.arg('from_id')::uuid OR requested_area_id = sqlc.arg('from_id')::uuid
), a AS (UPDATE assets SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), tm AS (UPDATE teams SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), ep AS (UPDATE escalation_policies SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), mw AS (UPDATE maintenance_windows SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), ms AS (UPDATE maintenance_window_series SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), ar AS (UPDATE asset_responsibles SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), ag AS (UPDATE agenda_tasks SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), go AS (UPDATE goals SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), pi AS (UPDATE playbook_items SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), ak AS (UPDATE api_keys SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), gc AS (UPDATE glpi_config SET area_id = sqlc.arg('to_id')::uuid WHERE area_id = sqlc.arg('from_id')::uuid
), pl AS (
  UPDATE public_share_links SET area_ids = ARRAY(SELECT DISTINCT unnest(array_replace(area_ids, sqlc.arg('from_id')::uuid, sqlc.arg('to_id')::uuid)))
  WHERE sqlc.arg('from_id')::uuid = ANY(area_ids)
), sc AS (
  INSERT INTO management_scopes (user_id, area_id)
  SELECT user_id, sqlc.arg('to_id')::uuid FROM management_scopes WHERE area_id = sqlc.arg('from_id')::uuid
  ON CONFLICT DO NOTHING
)
DELETE FROM monthly_summaries WHERE area_id IN (sqlc.arg('from_id')::uuid, sqlc.arg('to_id')::uuid);

-- name: MoveAreaGroups :exec
-- Los grupos hechos a mano que incluían el área origen pasan a incluir el
-- destino; los automáticos del origen que quedaron sin gente se borran.
WITH moved AS (
  INSERT INTO permission_group_areas (permission_group_id, area_id)
  SELECT pa.permission_group_id, sqlc.arg('to_id')::uuid FROM permission_group_areas pa
  JOIN permission_groups pg ON pg.id = pa.permission_group_id AND pg.department_id IS NULL
  WHERE pa.area_id = sqlc.arg('from_id')::uuid
    AND EXISTS (SELECT 1 FROM user_permission_groups upg WHERE upg.permission_group_id = pa.permission_group_id)
  ON CONFLICT DO NOTHING
)
DELETE FROM permission_groups pg
WHERE pg.department_id IS NULL
  AND EXISTS (SELECT 1 FROM permission_group_areas pa WHERE pa.permission_group_id = pg.id AND pa.area_id = sqlc.arg('from_id')::uuid)
  AND NOT EXISTS (SELECT 1 FROM permission_group_areas pa WHERE pa.permission_group_id = pg.id AND pa.area_id <> sqlc.arg('from_id')::uuid)
  AND NOT EXISTS (SELECT 1 FROM user_permission_groups upg WHERE upg.permission_group_id = pg.id);

-- name: DeleteEmptyAreaGroups :exec
-- Antes de borrar un área vacía: sus grupos automáticos (solo esa área y sin gente).
DELETE FROM permission_groups pg
WHERE pg.department_id IS NULL
  AND EXISTS (SELECT 1 FROM permission_group_areas pa WHERE pa.permission_group_id = pg.id AND pa.area_id = $1)
  AND NOT EXISTS (SELECT 1 FROM permission_group_areas pa WHERE pa.permission_group_id = pg.id AND pa.area_id <> $1)
  AND NOT EXISTS (SELECT 1 FROM user_permission_groups upg WHERE upg.permission_group_id = pg.id);

-- name: ClearAreaShare :exec
UPDATE areas SET shares_team = false WHERE id = $1;

-- name: DeleteArea :exec
DELETE FROM areas WHERE id = $1 AND NOT is_system;
