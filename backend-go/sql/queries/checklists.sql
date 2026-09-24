-- name: GetActiveChecklistTemplate :one
SELECT * FROM checklist_templates WHERE id = $1 AND is_active = true;

-- name: ListActiveChecklistTemplates :many
SELECT * FROM checklist_templates WHERE is_active = true ORDER BY name;

-- name: ListChecklistItems :many
SELECT * FROM checklist_items WHERE template_id = $1 ORDER BY item_order, id;

-- name: CreateShiftCheck :one
INSERT INTO shift_checks (checklist_template_id, user_id, work_shift_id, check_type, check_date, has_red_services)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: CreateShiftCheckService :one
INSERT INTO shift_check_services (shift_check_id, checklist_item_id, service_title, status, is_computed, observation, correlated_from_service_id)
VALUES ($1, sqlc.narg('checklist_item_id'), $2, $3, $4, sqlc.narg('observation'), sqlc.narg('correlated_from_service_id')) RETURNING *;

-- name: CreateChecklistEntry :one
INSERT INTO entries (user_id, entry_type, scope, content, tags, work_shift_id)
VALUES ($1, 'checklist', 'general', $2, $3, $4) RETURNING *;

-- name: ListShiftCheckServices :many
SELECT * FROM shift_check_services WHERE shift_check_id = $1 ORDER BY id;

-- name: LinkCorrelatedShiftCheckService :one
UPDATE shift_check_services SET correlated_from_service_id = $2 WHERE id = $1 RETURNING *;

-- name: ListShiftChecks :many
SELECT * FROM shift_checks
WHERE (sqlc.narg('work_shift_id')::uuid IS NULL OR work_shift_id = sqlc.narg('work_shift_id'))
  AND (sqlc.narg('from_date')::timestamptz IS NULL OR check_date >= sqlc.narg('from_date'))
  AND (sqlc.narg('to_date')::timestamptz IS NULL OR check_date < sqlc.narg('to_date'))
ORDER BY check_date DESC LIMIT sqlc.arg('page_size') OFFSET sqlc.arg('page_offset');

-- name: GetLatestShiftCheck :one
SELECT * FROM shift_checks WHERE work_shift_id = $1 ORDER BY check_date DESC LIMIT 1;

-- name: GetShiftCheck :one
SELECT * FROM shift_checks WHERE id = $1;

-- name: CountEntriesInWindow :one
SELECT count(*) FROM entries WHERE created_at >= $1 AND created_at < $2;

-- name: CountIncidentEntriesInWindow :one
SELECT count(*) FROM entries WHERE entry_type = 'incidente' AND created_at >= $1 AND created_at < $2;

-- name: CountResolvedTicketsInWindow :one
SELECT count(*) FROM tickets WHERE status IN ('resolved', 'closed') AND resolved_at >= $1 AND resolved_at < $2;

-- name: CountSLABreachesInWindow :one
SELECT count(*) FROM tickets WHERE sla_resolution_due_at IS NOT NULL AND resolved_at > sla_resolution_due_at + make_interval(secs => sla_paused_seconds) AND resolved_at >= $1 AND resolved_at < $2;

-- name: CreateShiftClosure :one
INSERT INTO shift_closures (user_id, shift_start_at, shift_end_at, closure_check_id, total_entries, total_incidents, services_down, observations, pending_for_next_shift, tickets_resolved_count, sla_breaches_count)
VALUES ($1, $2, $3, $4, $5, $6, $7, sqlc.narg('observations'), sqlc.narg('pending_for_next_shift'), $8, $9) RETURNING *;

-- name: MarkShiftClosureSent :exec
UPDATE shift_closures SET sent_via = $2, sent_status = $3, sent_error = sqlc.narg('sent_error'), sent_at = CASE WHEN $3 = 'success' THEN now() ELSE sent_at END WHERE id = $1;

-- name: GetShiftClosure :one
SELECT * FROM shift_closures WHERE id = $1;

-- name: GetLatestShiftClosure :one
SELECT * FROM shift_closures ORDER BY shift_end_at DESC LIMIT 1;

-- name: AcknowledgeShiftClosure :one
UPDATE shift_closures SET acknowledged_by = $2, acknowledged_at = $3 WHERE id = $1 AND acknowledged_at IS NULL RETURNING *;

-- name: ListUpcomingMaintenanceWindows :many
SELECT * FROM maintenance_windows
WHERE active = true AND ends_at > $1 AND starts_at <= $2
ORDER BY starts_at ASC;

-- name: ListHandoverOnCall :many
SELECT DISTINCT ON (t.id) t.id AS team_id, t.name AS team_name,
  COALESCE(u.username, c.name, '')::text AS on_call_member
FROM teams t
JOIN rotation_cycles rc ON rc.team_id = t.id AND rc.active = true
JOIN rotation_slots rs ON rs.cycle_id = rc.id
  AND rs.week_start_date <= sqlc.arg('today')::date
  AND rs.week_end_date >= sqlc.arg('today')::date
  AND rs.is_paused = false
JOIN team_members tm ON tm.id = rs.team_member_id AND tm.active = true
LEFT JOIN users u ON u.id = tm.user_id
LEFT JOIN contacts c ON c.id = tm.contact_id
WHERE t.active = true
  AND (sqlc.narg('team_id')::uuid IS NULL OR t.id = sqlc.narg('team_id'))
ORDER BY t.id, tm.priority DESC, tm.id;