-- Flujos entre áreas (spec/16 §6.1, 9.7, 000044): una tarea de la Agenda con
-- pasos en orden, cada uno de un área. Cada paso es una agenda_task.

-- name: CreateAgendaFlow :one
INSERT INTO agenda_flows (name, organization_id, recurrence, created_by) VALUES ($1, $2, $3, $4) RETURNING id;

-- name: UpdateAgendaFlow :exec
UPDATE agenda_flows SET name = $2, organization_id = $3, recurrence = $4, updated_at = now() WHERE id = $1;

-- name: SetAgendaFlowActive :execrows
UPDATE agenda_flows SET active = $2, updated_at = now() WHERE id = $1;

-- name: ListAgendaFlows :many
-- paused: su cliente está desactivado (como las tareas).
SELECT f.id, f.name, f.organization_id, COALESCE(o.name, '')::text AS organization_name,
  (o.id IS NOT NULL AND NOT o.active)::bool AS paused, f.recurrence, f.active, f.created_by,
  COALESCE(NULLIF(c.full_name, ''), c.username, '')::text AS created_by_name, f.created_at
FROM agenda_flows f
LEFT JOIN organizations o ON o.id = f.organization_id
LEFT JOIN users c ON c.id = f.created_by
WHERE (f.active OR sqlc.arg('include_inactive')::bool)
ORDER BY f.name;

-- name: CreateAgendaFlowStep :one
INSERT INTO agenda_tasks (name, description, area_id, organization_id, assignee_kind, assignee_user_id,
  assignee_level_id, assignee_team_id, recurrence, warn_days, steps, doc_url, created_by,
  flow_id, flow_position, flow_after, flow_days)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
RETURNING id;

-- name: UpdateAgendaFlowStep :exec
UPDATE agenda_tasks SET name = $2, description = $3, area_id = $4, organization_id = $5, assignee_kind = $6,
  assignee_user_id = $7, assignee_level_id = $8, assignee_team_id = $9, recurrence = $10, warn_days = $11,
  steps = $12, doc_url = $13, flow_after = $14, flow_days = $15, updated_at = now()
WHERE id = $1;

-- name: DeactivateFlowStepsFrom :execrows
-- Al quitar pasos del final de un flujo (quedan con su historial).
UPDATE agenda_tasks SET active = false, updated_at = now()
WHERE flow_id = $1 AND flow_position >= sqlc.arg('from_position')::int AND active;

-- name: DeactivateFlowSteps :execrows
UPDATE agenda_tasks SET active = false, updated_at = now() WHERE flow_id = $1 AND active;

-- name: InsertAgendaFlowRun :one
-- Una vuelta del flujo por fecha de inicio. Sin fila: ya existía.
INSERT INTO agenda_flow_runs (flow_id, start_date) VALUES ($1, $2)
ON CONFLICT (flow_id, start_date) DO NOTHING
RETURNING id;

-- name: InsertFlowOccurrence :execrows
INSERT INTO agenda_occurrences (task_id, due_date, status, user_id, offered_level_id, flow_run_id)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (task_id, flow_run_id) WHERE flow_run_id IS NOT NULL DO NOTHING;

-- name: ListFlowRuns :many
-- Las vueltas que empiezan desde una fecha, más las que siguen abiertas.
SELECT r.id, r.flow_id, r.start_date,
  EXISTS (SELECT 1 FROM agenda_occurrences o WHERE o.flow_run_id = r.id AND o.status IN ('pending', 'waiting'))::bool AS open
FROM agenda_flow_runs r
WHERE r.start_date >= sqlc.arg('from_day')::date
   OR EXISTS (SELECT 1 FROM agenda_occurrences o WHERE o.flow_run_id = r.id AND o.status IN ('pending', 'waiting'))
ORDER BY r.flow_id, r.start_date;

-- name: ListFlowRunOccurrences :many
SELECT o.id, o.task_id, o.flow_run_id, o.due_date, o.status, o.user_id,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name,
  COALESCE(l.name, '')::text AS offered_level_name, o.closed_at
FROM agenda_occurrences o
LEFT JOIN users u ON u.id = o.user_id
LEFT JOIN levels l ON l.id = o.offered_level_id
WHERE o.flow_run_id = ANY(sqlc.arg('run_ids')::uuid[]);

-- name: ReleaseFlowStep :execrows
-- El paso que esperaba al anterior empieza: recibe su vencimiento.
UPDATE agenda_occurrences SET status = 'pending', due_date = sqlc.arg('due_date')::date, updated_at = now()
WHERE task_id = $1 AND flow_run_id = $2 AND status = 'waiting';

-- name: DeleteFutureUntouchedRuns :execrows
-- Al editar un flujo, las vueltas que todavía no empiezan y nadie tocó se rehacen.
DELETE FROM agenda_flow_runs r
WHERE r.flow_id = $1 AND r.start_date >= sqlc.arg('from_day')::date
  AND NOT EXISTS (SELECT 1 FROM agenda_occurrences o WHERE o.flow_run_id = r.id
                  AND (o.status IN ('done', 'skipped') OR cardinality(o.steps_done) > 0));
