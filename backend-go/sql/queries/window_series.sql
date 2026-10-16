-- Ventanas de mantenimiento que se repiten (spec/16 §6.1, 9.7, 000044).

-- name: CreateWindowSeries :one
INSERT INTO maintenance_window_series (service_id, asset_id, territorial_unit_id, organization_id, area_id, team_id,
  title, notes, suppress_notifications, priority, rule, valid_from, valid_to, timezone, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *;

-- name: UpdateWindowSeries :one
UPDATE maintenance_window_series SET title = $2, notes = $3, suppress_notifications = $4, rule = $5,
  valid_from = $6, valid_to = $7, updated_at = now()
WHERE id = $1 AND active RETURNING *;

-- name: DeactivateWindowSeries :execrows
UPDATE maintenance_window_series SET active = false, updated_at = now() WHERE id = $1 AND active;

-- name: ListWindowSeries :many
-- Las series activas con el nombre de a qué aplican.
SELECT ws.id, ws.service_id, ws.asset_id, ws.territorial_unit_id, ws.organization_id, ws.area_id, ws.team_id,
  ws.title, ws.notes, ws.suppress_notifications, ws.priority, ws.rule, ws.valid_from, ws.valid_to, ws.timezone,
  ws.created_by, ws.created_at,
  COALESCE(s.name, a.name, tu.name, o.name, ar.name, t.name, '')::text AS target_name
FROM maintenance_window_series ws
LEFT JOIN services s ON s.id = ws.service_id
LEFT JOIN assets a ON a.id = ws.asset_id
LEFT JOIN territorial_units tu ON tu.id = ws.territorial_unit_id
LEFT JOIN organizations o ON o.id = ws.organization_id
LEFT JOIN areas ar ON ar.id = ws.area_id
LEFT JOIN teams t ON t.id = ws.team_id
WHERE ws.active
ORDER BY ws.title;

-- name: InsertSeriesWindow :execrows
-- Una ventana de la serie por día. En feriado se crea inactiva (holiday_name).
INSERT INTO maintenance_windows (service_id, asset_id, territorial_unit_id, organization_id, area_id, team_id,
  title, notes, starts_at, ends_at, suppress_notifications, priority, created_by, active, series_id, series_day,
  holiday_name, notified_start, notified_end)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $9 <= now(), $10 <= now())
ON CONFLICT (series_id, series_day) WHERE series_id IS NOT NULL DO NOTHING;

-- name: DeleteFutureSeriesWindows :execrows
-- Al cambiar o borrar la serie: las que no empezaron (y nadie aprobó en feriado) se rehacen.
DELETE FROM maintenance_windows
WHERE series_id = $1 AND starts_at > now() AND closed_at IS NULL AND approved_by IS NULL;

-- name: ListSeriesWindows :many
-- Las próximas ventanas de las series, también las saltadas y las de feriado.
SELECT w.id, w.series_id, w.series_day, w.starts_at, w.ends_at, w.active, w.holiday_name, w.approved_at,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS approved_by_name
FROM maintenance_windows w
LEFT JOIN users u ON u.id = w.approved_by
WHERE w.series_id = ANY(sqlc.arg('series_ids')::uuid[]) AND w.ends_at > now() AND w.closed_at IS NULL
ORDER BY w.starts_at;

-- name: SetSeriesWindowState :one
-- Saltar o volver a aplicar una vez; aplicar igual en feriado (queda quién) o quitarlo.
UPDATE maintenance_windows SET active = sqlc.arg('active')::bool,
  approved_by = sqlc.narg('approved_by')::uuid,
  approved_at = CASE WHEN sqlc.narg('approved_by')::uuid IS NULL THEN NULL ELSE now() END
WHERE id = $1 AND series_id IS NOT NULL AND starts_at > now() AND closed_at IS NULL
RETURNING *;

-- name: GetSeriesWindow :one
SELECT * FROM maintenance_windows WHERE id = $1 AND series_id IS NOT NULL;
