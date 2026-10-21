-- Agenda (spec/16 §4.3, 9.3, 000041).

-- name: GetAgendaSettings :one
SELECT work_days, to_char(day_start, 'HH24:MI')::text AS day_start, to_char(day_end, 'HH24:MI')::text AS day_end,
  timezone, holiday_country
FROM agenda_settings WHERE id;

-- name: UpdateAgendaSettings :exec
UPDATE agenda_settings SET work_days = sqlc.arg('work_days')::int[], day_start = sqlc.arg('day_start')::text::time,
  day_end = sqlc.arg('day_end')::text::time, updated_at = now()
WHERE id;

-- name: ListHolidaysBetween :many
SELECT day, name, source FROM holidays WHERE day BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date ORDER BY day;

-- name: UpsertHoliday :exec
INSERT INTO holidays (day, name, source) VALUES ($1, $2, 'manual')
ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name;

-- name: ImportHoliday :execrows
-- Importar no pisa lo que el admin ya cargó a mano.
INSERT INTO holidays (day, name, source) VALUES ($1, $2, 'import') ON CONFLICT (day) DO NOTHING;

-- name: DeleteHoliday :execrows
DELETE FROM holidays WHERE day = $1;

-- name: ListUserAgendaGroups :many
-- Los grupos activos de una persona con su área, nivel (y su rango) y perfil:
-- deciden qué ve en la Agenda y a quién puede asignar.
SELECT pg.profile, pa.area_id, pg.level_id, COALESCE(l.rank, 0)::int AS level_rank,
  ('area:lead' = ANY(pg.capabilities))::bool AS is_lead
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
LEFT JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
LEFT JOIN levels l ON l.id = pg.level_id
WHERE upg.user_id = $1;

-- name: ListAreaPeopleLevels :many
-- Las personas activas de cada área con su nivel en ella (una fila por área y nivel).
SELECT DISTINCT pa.area_id, u.id AS user_id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS name,
  pg.level_id, COALESCE(l.rank, 0)::int AS level_rank
FROM users u
JOIN user_permission_groups upg ON upg.user_id = u.id
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
LEFT JOIN levels l ON l.id = pg.level_id
WHERE u.active
ORDER BY 3;

-- name: ListAgendaGuards :many
-- Las guardias (equipos de guardia) activas con su área.
SELECT id, name, area_id FROM teams WHERE kind = 'oncall' AND active AND area_id IS NOT NULL ORDER BY name;

-- name: CreateAgendaTask :one
-- action_kind, is_key, ticket_id: acciones de la Gestión CSM (000051).
INSERT INTO agenda_tasks (name, description, area_id, organization_id, assignee_kind, assignee_user_id,
  assignee_level_id, assignee_team_id, recurrence, warn_days, steps, doc_url, report_kind, created_by,
  action_kind, is_key, ticket_id, playbook_application_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
RETURNING id;

-- name: UpdateAgendaTask :exec
UPDATE agenda_tasks SET name = $2, description = $3, area_id = $4, organization_id = $5, assignee_kind = $6,
  assignee_user_id = $7, assignee_level_id = $8, assignee_team_id = $9, recurrence = $10, warn_days = $11,
  steps = $12, doc_url = $13, report_kind = $14, action_kind = $15, is_key = $16, ticket_id = $17, updated_at = now()
WHERE id = $1;

-- name: SetAgendaTaskActive :execrows
UPDATE agenda_tasks SET active = $2, updated_at = now() WHERE id = $1;

-- name: ListAgendaTasks :many
-- Las tareas con los nombres que muestra la pantalla. paused: su cliente
-- está desactivado (las recurrentes se pausan y vuelven al reactivarlo).
SELECT t.id, t.name, t.description, t.area_id, a.name AS area_name, t.organization_id,
  COALESCE(o.name, '')::text AS organization_name, (o.id IS NOT NULL AND NOT o.active)::bool AS paused,
  t.assignee_kind, t.assignee_user_id, COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS assignee_user_name,
  t.assignee_level_id, COALESCE(l.name, '')::text AS assignee_level_name, COALESCE(l.rank, 0)::int AS assignee_level_rank,
  t.assignee_team_id, COALESCE(tm.name, '')::text AS assignee_team_name,
  t.recurrence, t.warn_days, t.steps, t.doc_url, t.report_kind, t.active,
  t.created_by, COALESCE(NULLIF(c.full_name, ''), c.username, '')::text AS created_by_name, t.created_at,
  t.flow_id, t.flow_position, t.flow_after, t.flow_days,
  t.action_kind, t.is_key, t.ticket_id, COALESCE(tk.ticket_number, '')::text AS ticket_number, t.playbook_application_id
FROM agenda_tasks t
JOIN areas a ON a.id = t.area_id
LEFT JOIN tickets tk ON tk.id = t.ticket_id
LEFT JOIN organizations o ON o.id = t.organization_id
LEFT JOIN users u ON u.id = t.assignee_user_id
LEFT JOIN levels l ON l.id = t.assignee_level_id
LEFT JOIN teams tm ON tm.id = t.assignee_team_id
LEFT JOIN users c ON c.id = t.created_by
WHERE (t.active OR sqlc.arg('include_inactive')::bool)
ORDER BY t.name;

-- name: InsertAgendaOccurrence :execrows
INSERT INTO agenda_occurrences (task_id, due_date, moved_from, user_id, offered_level_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (task_id, due_date) WHERE flow_run_id IS NULL DO NOTHING;

-- name: DeleteFutureUntouchedOccurrences :execrows
-- Al cambiar la recurrencia o el responsable, las pendientes desde hoy que
-- nadie empezó se rehacen con la regla nueva. keep_taken: al cambiar
-- feriados u horario se respetan las que alguien ya tomó o le traspasaron.
-- Las de un flujo (9.7) no se rehacen: nacen con su vuelta.
DELETE FROM agenda_occurrences o
USING agenda_tasks t
WHERE t.id = o.task_id AND o.task_id = sqlc.arg('task_id') AND o.status = 'pending' AND o.flow_run_id IS NULL
  AND o.due_date >= sqlc.arg('from_day')::date AND cardinality(o.steps_done) = 0
  AND (NOT sqlc.arg('keep_taken')::bool
       OR (o.absent_user_id IS NULL AND (o.user_id IS NULL OR o.user_id IS NOT DISTINCT FROM t.assignee_user_id)));

-- name: ListAgendaOccurrences :many
-- Las ocurrencias de un rango (las pendientes atrasadas y los pasos de un
-- flujo en espera siempre, aunque sean anteriores), con quién la tiene y el
-- nivel al que se ofrece.
SELECT o.id, o.task_id, o.due_date, o.moved_from, o.status, o.user_id,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name,
  o.offered_level_id, COALESCE(l.name, '')::text AS offered_level_name, COALESCE(l.rank, 0)::int AS offered_level_rank,
  o.absent_user_id, COALESCE(NULLIF(ab.full_name, ''), ab.username, '')::text AS absent_user_name,
  o.steps_done, o.note, o.link, o.skip_reason, o.closed_by, COALESCE(NULLIF(cb.full_name, ''), cb.username, '')::text AS closed_by_name,
  o.closed_at, o.report_history_id, o.flow_run_id
FROM agenda_occurrences o
JOIN agenda_tasks t ON t.id = o.task_id
LEFT JOIN users u ON u.id = o.user_id
LEFT JOIN levels l ON l.id = o.offered_level_id
LEFT JOIN users ab ON ab.id = o.absent_user_id
LEFT JOIN users cb ON cb.id = o.closed_by
WHERE (o.due_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date)
   OR (o.status IN ('pending', 'waiting') AND o.due_date < sqlc.arg('from_day')::date AND sqlc.arg('with_late')::bool)
ORDER BY o.due_date, t.name;

-- name: GetAgendaOccurrence :one
SELECT o.id, o.task_id, o.due_date, o.status, o.user_id, o.offered_level_id, o.steps_done, o.flow_run_id
FROM agenda_occurrences o WHERE o.id = $1;

-- name: SetOccurrenceHolder :exec
UPDATE agenda_occurrences SET user_id = $2, offered_level_id = $3, absent_user_id = $4, updated_at = now()
WHERE id = $1 AND status = 'pending';

-- name: SetOccurrenceSteps :exec
UPDATE agenda_occurrences SET steps_done = $2, updated_at = now() WHERE id = $1 AND status = 'pending';

-- name: CloseOccurrence :execrows
UPDATE agenda_occurrences SET status = $2, note = $3, link = $4, skip_reason = $5, closed_by = $6,
  closed_at = sqlc.arg('closed_at')::timestamptz, updated_at = now(), user_id = COALESCE(user_id, $6)
WHERE id = $1 AND status = 'pending';

-- name: ReopenOccurrence :execrows
UPDATE agenda_occurrences SET status = 'pending', note = NULL, link = NULL, skip_reason = NULL, closed_by = NULL,
  closed_at = NULL, report_history_id = NULL, updated_at = now()
WHERE id = $1 AND status <> 'pending';

-- name: CloseOccurrenceByReport :many
-- Enviar un informe de Reportes cierra la ocurrencia pendiente más antigua de
-- las tareas ligadas a ese informe y cliente, si vence dentro de 7 días (un
-- informe suelto no cierra el del mes que viene).
UPDATE agenda_occurrences ao SET status = 'done', closed_by = sqlc.arg('user_id')::uuid, closed_at = sqlc.arg('closed_at')::timestamptz,
  report_history_id = sqlc.narg('report_history_id')::uuid, user_id = COALESCE(ao.user_id, sqlc.arg('user_id')::uuid),
  note = sqlc.arg('note')::text, updated_at = now()
WHERE ao.id IN (
  SELECT DISTINCT ON (o.task_id) o.id
  FROM agenda_occurrences o
  JOIN agenda_tasks t ON t.id = o.task_id
  WHERE t.active AND t.report_kind = sqlc.arg('report_kind')::text AND t.organization_id = sqlc.arg('organization_id')::uuid
    AND o.status = 'pending' AND o.due_date <= sqlc.arg('until_day')::date
  ORDER BY o.task_id, o.due_date)
RETURNING ao.id, ao.task_id;

-- name: ListAbsences :many
-- Vacaciones y licencias de Dotación en un rango: la tarea de una persona
-- ausente vuelve a su nivel (spec/16 §4.3, "Ausencias").
SELECT user_id, assigned_date FROM work_shift_assignments
WHERE condition IN ('vacation', 'medical_leave') AND assigned_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date;

-- name: ListWorkShiftMembersForHandover :many
-- Turnos activos con sus integrantes: para proponer a quien entra al cerrar el turno.
SELECT ws.id AS shift_id, ws.name AS shift_name, to_char(ws.start_time, 'HH24:MI')::text AS start_time, ws.timezone,
  m.user_id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS user_name, m.weekdays, m.valid_from, m.valid_to
FROM work_shifts ws
JOIN work_shift_members m ON m.work_shift_id = ws.id AND m.active
JOIN users u ON u.id = m.user_id AND u.active
WHERE ws.active
ORDER BY ws.start_time, 6;
