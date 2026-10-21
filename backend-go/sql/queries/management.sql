-- Gestión CSM (spec/16 §4.4, 9.4, 000051).

-- name: GetManagementSettings :one
SELECT * FROM management_settings WHERE id;

-- name: UpdateManagementSettings :exec
UPDATE management_settings SET sla_target = sqlc.arg('sla_target'), updated_at = now() WHERE id;

-- ===== Cartera =====

-- name: ListManagementClients :many
-- Los clientes con lo que hace falta para el semáforo (§4.4.1): tickets
-- abiertos y fuera de SLA (en cualquier área), acciones atrasadas (las
-- claves aparte), último contacto (Reunión, Comité o Contacto hechos) y la
-- próxima acción. late_before: una pendiente con fecha anterior está
-- atrasada (hoy, o mañana si ya terminó el horario hábil).
SELECT o.id, o.name, o.active, o.csm_user_id, COALESCE(NULLIF(cu.full_name, ''), cu.username, '')::text AS csm_name,
  o.service_start_date, o.renewal_date, o.sla_target, o.created_at,
  (SELECT count(*) FROM tickets t WHERE t.client_id = o.id AND t.status NOT IN ('resolved', 'closed', 'cancelled')
     AND t.merged_into_id IS NULL AND NOT t.glpi_deleted)::int AS open_tickets,
  (SELECT count(*) FROM tickets t WHERE t.client_id = o.id AND t.status NOT IN ('resolved', 'closed', 'cancelled')
     AND t.merged_into_id IS NULL AND NOT t.glpi_deleted AND t.sla_on_hold_since IS NULL
     AND t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds) < sqlc.arg('now')::timestamptz)::int AS breached_tickets,
  COALESCE((SELECT t.ticket_number FROM tickets t WHERE t.client_id = o.id AND t.status NOT IN ('resolved', 'closed', 'cancelled')
     AND t.merged_into_id IS NULL AND NOT t.glpi_deleted AND t.sla_on_hold_since IS NULL
     AND t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds) < sqlc.arg('now')::timestamptz
     ORDER BY t.sla_resolution_due_at LIMIT 1), '')::text AS breached_first,
  (SELECT count(*) FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND k.active AND oc.status = 'pending' AND oc.due_date < sqlc.arg('late_before')::date)::int AS late_actions,
  (SELECT count(*) FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND k.active AND k.is_key AND oc.status = 'pending' AND oc.due_date < sqlc.arg('late_before')::date)::int AS key_late,
  COALESCE((SELECT k.name FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND k.active AND k.is_key AND oc.status = 'pending' AND oc.due_date < sqlc.arg('late_before')::date
     ORDER BY oc.due_date LIMIT 1), '')::text AS key_late_first,
  (SELECT max(oc.closed_at) FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND oc.status = 'done' AND k.action_kind IN ('meeting', 'committee', 'contact'))::timestamptz AS last_contact_at,
  COALESCE((SELECT k.action_kind FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND oc.status = 'done' AND k.action_kind IN ('meeting', 'committee', 'contact')
     ORDER BY oc.closed_at DESC LIMIT 1), '')::text AS last_contact_kind,
  (SELECT max(oc.closed_at) FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND oc.status = 'done' AND k.action_kind IN ('meeting', 'committee'))::timestamptz AS last_meeting_at,
  COALESCE((SELECT k.action_kind FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND oc.status = 'done' AND k.action_kind IN ('meeting', 'committee')
     ORDER BY oc.closed_at DESC LIMIT 1), '')::text AS last_meeting_kind,
  COALESCE((SELECT k.name FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND k.active AND oc.status = 'pending' AND oc.due_date >= sqlc.arg('late_before')::date
     ORDER BY oc.due_date, k.name LIMIT 1), '')::text AS next_action_name,
  (SELECT min(oc.due_date) FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
     WHERE k.organization_id = o.id AND k.active AND oc.status = 'pending' AND oc.due_date >= sqlc.arg('late_before')::date)::date AS next_action_due
FROM clients c
JOIN organizations o ON o.id = c.id
LEFT JOIN users cu ON cu.id = o.csm_user_id
WHERE sqlc.narg('client_id')::uuid IS NULL OR o.id = sqlc.narg('client_id')::uuid
ORDER BY o.name;

-- name: UpdateClientManagement :execrows
UPDATE organizations SET csm_user_id = sqlc.narg('csm_user_id'), service_start_date = sqlc.narg('service_start_date'),
  renewal_date = sqlc.narg('renewal_date'), sla_target = sqlc.narg('sla_target')
WHERE id = sqlc.arg('id') AND archived_at IS NULL;

-- name: ListCSMUsers :many
-- Quién puede quedar a cargo de una cuenta: el perfil Gestión (y el admin).
SELECT DISTINCT u.id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS name
FROM users u
LEFT JOIN user_permission_groups upg ON upg.user_id = u.id
LEFT JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
WHERE u.active AND (pg.profile = 'gestion' OR u.role = 'admin')
ORDER BY 2;

-- name: ListClientOpenTickets :many
SELECT sqlc.embed(t), a.name AS area_name
FROM tickets t
JOIN areas a ON a.id = t.area_id
WHERE t.client_id = $1 AND t.status NOT IN ('resolved', 'closed', 'cancelled') AND t.merged_into_id IS NULL AND NOT t.glpi_deleted
ORDER BY t.priority, t.created_at;

-- name: ListClientActions :many
-- Las acciones pendientes del cliente (también las atrasadas), con quién la tiene.
SELECT oc.id, oc.task_id, oc.due_date, oc.status, k.name, k.action_kind, k.is_key, k.ticket_id,
  COALESCE(tk.ticket_number, '')::text AS ticket_number, k.assignee_kind,
  COALESCE(NULLIF(hu.full_name, ''), hu.username, '')::text AS holder_name,
  COALESCE(NULLIF(au.full_name, ''), au.username, '')::text AS assignee_user_name,
  COALESCE(l.name, ol.name, '')::text AS level_name, a.name AS area_name, COALESCE(tm.name, '')::text AS team_name
FROM agenda_occurrences oc
JOIN agenda_tasks k ON k.id = oc.task_id
JOIN areas a ON a.id = k.area_id
LEFT JOIN tickets tk ON tk.id = k.ticket_id
LEFT JOIN users hu ON hu.id = oc.user_id
LEFT JOIN users au ON au.id = k.assignee_user_id
LEFT JOIN levels l ON l.id = k.assignee_level_id
LEFT JOIN levels ol ON ol.id = oc.offered_level_id
LEFT JOIN teams tm ON tm.id = k.assignee_team_id
WHERE k.organization_id = $1 AND k.active AND oc.status = 'pending'
ORDER BY oc.due_date, k.name
LIMIT 60;

-- name: ListTicketActions :many
-- Acciones de seguimiento de un ticket (panel de la Ticketera).
SELECT oc.id, oc.task_id, oc.due_date, oc.status, oc.closed_at, k.name, k.action_kind, k.is_key,
  COALESCE(NULLIF(hu.full_name, ''), hu.username, NULLIF(au.full_name, ''), au.username, l.name, tm.name, '')::text AS who
FROM agenda_tasks k
JOIN agenda_occurrences oc ON oc.task_id = k.id
LEFT JOIN users hu ON hu.id = oc.user_id
LEFT JOIN users au ON au.id = k.assignee_user_id
LEFT JOIN levels l ON l.id = k.assignee_level_id
LEFT JOIN teams tm ON tm.id = k.assignee_team_id
WHERE k.ticket_id = $1 AND k.active
ORDER BY oc.due_date DESC
LIMIT 20;

-- name: ListClientReports :many
SELECT id, kind, title, created_at FROM report_history
WHERE organization_id = $1 AND status <> 'failed'
ORDER BY created_at DESC LIMIT 5;

-- name: ListClientTimeline :many
-- Línea de tiempo del cliente: tickets, acciones, envíos, metas y plantillas.
SELECT x.at::timestamptz AS at, x.kind::text AS kind, x.title::text AS title, x.detail::text AS detail
FROM (
  SELECT t.created_at AS at, 'ticket_open' AS kind, t.ticket_number || ' · ' || t.title AS title,
    a.name || ', ' || upper(substr(t.priority::text, 1, 2)) AS detail
  FROM tickets t JOIN areas a ON a.id = t.area_id
  WHERE t.client_id = sqlc.arg('client_id') AND NOT t.glpi_deleted
  UNION ALL
  SELECT t.resolved_at, 'ticket_resolved', t.ticket_number || ' · ' || t.title, a.name
  FROM tickets t JOIN areas a ON a.id = t.area_id
  WHERE t.client_id = sqlc.arg('client_id') AND t.resolved_at IS NOT NULL AND NOT t.glpi_deleted
  UNION ALL
  SELECT oc.closed_at, CASE WHEN oc.status = 'done' THEN 'action_done' ELSE 'action_skipped' END, k.name,
    COALESCE(NULLIF(cb.full_name, ''), cb.username, '') || CASE WHEN k.action_kind IS NOT NULL THEN '|' || k.action_kind ELSE '' END
  FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id LEFT JOIN users cb ON cb.id = oc.closed_by
  WHERE k.organization_id = sqlc.arg('client_id') AND oc.status IN ('done', 'skipped') AND oc.closed_at IS NOT NULL
  UNION ALL
  SELECT r.created_at, 'report_' || r.kind, r.title, r.sent_by_username
  FROM report_history r WHERE r.organization_id = sqlc.arg('client_id') AND r.status <> 'failed'
  UNION ALL
  SELECT e.created_at, 'goal', g.name, e.text
  FROM goal_events e JOIN goals g ON g.id = e.goal_id WHERE g.client_id = sqlc.arg('client_id')
  UNION ALL
  SELECT pa.applied_at, 'playbook', p.name, COALESCE(NULLIF(u.full_name, ''), u.username, '')
  FROM playbook_applications pa JOIN playbooks p ON p.id = pa.playbook_id LEFT JOIN users u ON u.id = pa.applied_by
  WHERE pa.client_id = sqlc.arg('client_id')
) x
ORDER BY x.at DESC
LIMIT 60;

-- ===== Indicadores (§4.4.8) =====

-- name: TicketPeriodStats :many
-- Por cliente o por área (by = 'area'): resueltos y en SLA del período,
-- creados y tiempos medios de 1.ª respuesta y resolución.
SELECT (CASE WHEN sqlc.arg('by')::text = 'area' THEN t.area_id ELSE t.client_id END)::uuid AS key_id,
  count(*) FILTER (WHERE t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz)::int AS resolved,
  count(*) FILTER (WHERE t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz
    AND t.sla_resolution_due_at IS NOT NULL)::int AS with_sla,
  count(*) FILTER (WHERE t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz
    AND t.sla_resolution_due_at IS NOT NULL
    AND t.resolved_at <= t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds))::int AS in_sla,
  count(*) FILTER (WHERE t.created_at >= sqlc.arg('from_at')::timestamptz AND t.created_at < sqlc.arg('to_at')::timestamptz)::int AS created,
  COALESCE(avg(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))) FILTER (
    WHERE t.created_at >= sqlc.arg('from_at')::timestamptz AND t.created_at < sqlc.arg('to_at')::timestamptz
      AND t.first_responded_at IS NOT NULL AND t.first_responded_at >= t.created_at), 0)::float8 AS avg_response_secs,
  COALESCE(avg(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))) FILTER (
    WHERE t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz
      AND t.resolved_at >= t.created_at), 0)::float8 AS avg_resolution_secs
FROM tickets t
WHERE t.merged_into_id IS NULL AND NOT t.glpi_deleted
  AND (t.resolved_at >= sqlc.arg('from_at')::timestamptz OR t.created_at >= sqlc.arg('from_at')::timestamptz)
GROUP BY 1;

-- name: TicketSLAByMonth :many
-- Tendencia: cumplimiento del SLA mes a mes (meses en la zona del área).
SELECT (CASE WHEN sqlc.arg('by')::text = 'area' THEN t.area_id ELSE t.client_id END)::uuid AS key_id,
  to_char(t.resolved_at AT TIME ZONE sqlc.arg('tz')::text, 'YYYY-MM')::text AS month,
  count(*)::int AS with_sla,
  count(*) FILTER (WHERE t.resolved_at <= t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds))::int AS in_sla
FROM tickets t
WHERE t.merged_into_id IS NULL AND NOT t.glpi_deleted AND t.sla_resolution_due_at IS NOT NULL
  AND t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz
GROUP BY 1, 2;

-- name: OpenBreachedTickets :many
-- Atrasos abiertos: tickets abiertos fuera de SLA, por cliente o por área.
SELECT (CASE WHEN sqlc.arg('by')::text = 'area' THEN t.area_id ELSE t.client_id END)::uuid AS key_id, count(*)::int AS breached
FROM tickets t
WHERE t.status NOT IN ('resolved', 'closed', 'cancelled') AND t.merged_into_id IS NULL AND NOT t.glpi_deleted
  AND t.sla_on_hold_since IS NULL AND t.sla_resolution_due_at + make_interval(secs => t.sla_paused_seconds) < sqlc.arg('now')::timestamptz
GROUP BY 1;

-- name: ClientResolvedIncidents :many
-- Exportar resumen: incidentes resueltos del cliente en el período, por área y prioridad.
SELECT a.name AS area_name, t.priority, count(*)::int AS resolved
FROM tickets t JOIN areas a ON a.id = t.area_id
WHERE t.client_id = sqlc.arg('client_id') AND t.ticket_type = 'incident' AND t.merged_into_id IS NULL AND NOT t.glpi_deleted
  AND t.resolved_at >= sqlc.arg('from_at')::timestamptz AND t.resolved_at < sqlc.arg('to_at')::timestamptz
GROUP BY a.name, a.sort_order, t.priority
ORDER BY a.sort_order, a.name, t.priority;

-- name: ListAgendaOccurrencesForStats :many
-- Tareas a tiempo: las ocurrencias de un rango con el cliente y el área de su tarea.
SELECT oc.due_date, oc.status, oc.closed_at, k.organization_id, k.area_id
FROM agenda_occurrences oc JOIN agenda_tasks k ON k.id = oc.task_id
WHERE oc.status IN ('pending', 'done', 'skipped')
  AND ((oc.due_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date)
    OR (oc.status = 'pending' AND oc.due_date < sqlc.arg('from_day')::date));

-- ===== Metas (§4.4.5) =====

-- name: CreateGoal :one
INSERT INTO goals (name, scope, client_id, area_id, person_user_id, person_name, person_email, owner_user_id, kind, bonus_rank, due_date,
  estimate_biz_days, evidence_required, created_by)
VALUES (sqlc.arg('name'), sqlc.arg('scope'), sqlc.narg('client_id'), sqlc.narg('area_id'), sqlc.narg('person_user_id'),
  sqlc.narg('person_name'), sqlc.narg('person_email'),
  sqlc.narg('owner_user_id'), sqlc.narg('kind'), sqlc.narg('bonus_rank'), sqlc.arg('due_date'), sqlc.narg('estimate_biz_days'),
  sqlc.arg('evidence_required'), sqlc.narg('created_by'))
RETURNING id;

-- name: UpdateGoal :exec
UPDATE goals SET name = sqlc.arg('name'), area_id = CASE WHEN scope = 'client' THEN sqlc.narg('area_id') ELSE area_id END,
  owner_user_id = sqlc.narg('owner_user_id'), kind = sqlc.narg('kind'), bonus_rank = sqlc.narg('bonus_rank'),
  due_date = sqlc.arg('due_date'), estimate_biz_days = sqlc.narg('estimate_biz_days'),
  evidence_required = sqlc.arg('evidence_required'), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: DeleteGoal :execrows
DELETE FROM goals WHERE id = $1;

-- name: ListGoals :many
-- Las metas con los nombres que muestra la pantalla y su avance.
SELECT g.*, COALESCE(o.name, '')::text AS client_name, COALESCE(a.name, '')::text AS area_name,
  COALESCE(NULLIF(pu.full_name, ''), pu.username, g.person_name, '')::text AS person_display,
  COALESCE(NULLIF(ou.full_name, ''), ou.username, '')::text AS owner_name,
  COALESCE(NULLIF(cu.full_name, ''), cu.username, '')::text AS created_by_name,
  COALESCE(NULLIF(fu.full_name, ''), fu.username, '')::text AS confirmed_by_name,
  (SELECT count(*) FROM goal_milestones m WHERE m.goal_id = g.id)::int AS milestones,
  (SELECT count(*) FROM goal_milestones m WHERE m.goal_id = g.id AND m.done_at IS NOT NULL)::int AS milestones_done,
  (SELECT count(*) FROM goal_evidence e WHERE e.goal_id = g.id)::int AS evidence_count,
  COALESCE(rl.rule, 'all')::text AS person_rule
FROM goals g
LEFT JOIN organizations o ON o.id = g.client_id
LEFT JOIN areas a ON a.id = g.area_id
LEFT JOIN users pu ON pu.id = g.person_user_id
LEFT JOIN users ou ON ou.id = g.owner_user_id
LEFT JOIN users cu ON cu.id = g.created_by
LEFT JOIN users fu ON fu.id = g.confirmed_by
LEFT JOIN goal_person_rules rl ON rl.user_id = g.person_user_id
WHERE (sqlc.narg('goal_id')::uuid IS NULL OR g.id = sqlc.narg('goal_id')::uuid)
  AND (sqlc.narg('client_id')::uuid IS NULL OR g.client_id = sqlc.narg('client_id')::uuid)
  AND (sqlc.narg('person_id')::uuid IS NULL OR g.person_user_id = sqlc.narg('person_id')::uuid)
ORDER BY g.due_date, g.name;

-- name: ListGoalMilestones :many
SELECT m.*, COALESCE(t.ticket_number, '')::text AS ticket_number, COALESCE(t.status::text, '')::text AS ticket_status,
  COALESCE(ta.name, '')::text AS ticket_area, COALESCE(k.name, '')::text AS task_name, COALESCE(ka.name, '')::text AS task_area,
  (SELECT min(oc.due_date) FROM agenda_occurrences oc WHERE oc.task_id = k.id AND oc.status = 'pending')::date AS task_next_due
FROM goal_milestones m
LEFT JOIN tickets t ON t.id = m.ticket_id
LEFT JOIN areas ta ON ta.id = t.area_id
LEFT JOIN agenda_tasks k ON k.id = m.agenda_task_id
LEFT JOIN areas ka ON ka.id = k.area_id
WHERE m.goal_id = ANY(sqlc.arg('goal_ids')::uuid[])
ORDER BY m.goal_id, m.position, m.created_at;

-- name: CreateGoalMilestone :one
INSERT INTO goal_milestones (goal_id, position, name, ticket_id, agenda_task_id)
VALUES (sqlc.arg('goal_id'), COALESCE((SELECT max(position) + 1 FROM goal_milestones WHERE goal_id = sqlc.arg('goal_id')), 0),
  sqlc.arg('name'), sqlc.narg('ticket_id'), sqlc.narg('agenda_task_id'))
RETURNING id;

-- name: UpdateGoalMilestone :execrows
-- Cambiar el enlace deja el hito sin marcar (se vuelve a calcular).
UPDATE goal_milestones SET name = sqlc.arg('name'), ticket_id = sqlc.narg('ticket_id'), agenda_task_id = sqlc.narg('agenda_task_id'),
  done_at = CASE WHEN ticket_id IS DISTINCT FROM sqlc.narg('ticket_id') OR agenda_task_id IS DISTINCT FROM sqlc.narg('agenda_task_id') THEN NULL ELSE done_at END,
  done_by = CASE WHEN ticket_id IS DISTINCT FROM sqlc.narg('ticket_id') OR agenda_task_id IS DISTINCT FROM sqlc.narg('agenda_task_id') THEN NULL ELSE done_by END,
  done_by_name = CASE WHEN ticket_id IS DISTINCT FROM sqlc.narg('ticket_id') OR agenda_task_id IS DISTINCT FROM sqlc.narg('agenda_task_id') THEN NULL ELSE done_by_name END,
  done_source = CASE WHEN ticket_id IS DISTINCT FROM sqlc.narg('ticket_id') OR agenda_task_id IS DISTINCT FROM sqlc.narg('agenda_task_id') THEN NULL ELSE done_source END
WHERE id = sqlc.arg('id') AND goal_id = sqlc.arg('goal_id');

-- name: DeleteGoalMilestone :execrows
DELETE FROM goal_milestones WHERE id = $1 AND goal_id = $2;

-- name: SetGoalMilestoneDone :execrows
-- A mano (solo los que no tienen enlace: esos se marcan solos).
UPDATE goal_milestones SET done_at = sqlc.narg('done_at'), done_by = sqlc.narg('done_by'), done_by_name = sqlc.narg('done_by_name'),
  done_source = CASE WHEN sqlc.narg('done_at')::timestamptz IS NULL THEN NULL ELSE 'manual' END
WHERE id = sqlc.arg('id') AND goal_id = sqlc.arg('goal_id') AND ticket_id IS NULL AND agenda_task_id IS NULL;

-- name: SyncMilestonesFromTickets :many
-- El ticket enlazado se resolvió: el hito se marca solo, con quién lo resolvió.
UPDATE goal_milestones m SET done_at = COALESCE(t.resolved_at, t.closed_at, now()), done_source = 'ticket', done_by = t.assigned_user_id,
  done_by_name = COALESCE(NULLIF(u.full_name, ''), u.username, t.glpi_technician, '')
FROM tickets t LEFT JOIN users u ON u.id = t.assigned_user_id
WHERE m.ticket_id = t.id AND m.done_at IS NULL AND t.status IN ('resolved', 'closed')
RETURNING m.goal_id, m.name, t.ticket_number, m.done_by_name;

-- name: UnsyncMilestonesFromTickets :many
-- El ticket se reabrió: el hito se desmarca (queda en el historial).
UPDATE goal_milestones m SET done_at = NULL, done_source = NULL, done_by = NULL, done_by_name = NULL
FROM tickets t
WHERE m.ticket_id = t.id AND m.done_source = 'ticket' AND t.status NOT IN ('resolved', 'closed')
RETURNING m.goal_id, m.name, t.ticket_number;

-- name: SyncMilestonesFromTasks :many
-- La tarea enlazada se hizo (una ocurrencia hecha después de crear el hito).
UPDATE goal_milestones m SET done_at = x.closed_at, done_source = 'task', done_by = x.closed_by,
  done_by_name = COALESCE(NULLIF(u.full_name, ''), u.username, '')
FROM (
  SELECT DISTINCT ON (oc.task_id, gm.id) gm.id AS milestone_id, oc.closed_at, oc.closed_by
  FROM goal_milestones gm JOIN agenda_occurrences oc ON oc.task_id = gm.agenda_task_id
  WHERE gm.done_at IS NULL AND oc.status = 'done' AND oc.closed_at >= gm.created_at
  ORDER BY oc.task_id, gm.id, oc.closed_at
) x
LEFT JOIN users u ON u.id = x.closed_by
WHERE m.id = x.milestone_id
RETURNING m.goal_id, m.name, (SELECT k.name FROM agenda_tasks k WHERE k.id = m.agenda_task_id)::text AS task_name, m.done_by_name;

-- name: UnsyncMilestonesFromTasks :many
-- La tarea se reabrió: el hito se desmarca.
UPDATE goal_milestones m SET done_at = NULL, done_source = NULL, done_by = NULL, done_by_name = NULL
WHERE m.done_source = 'task' AND NOT EXISTS (
  SELECT 1 FROM agenda_occurrences oc WHERE oc.task_id = m.agenda_task_id AND oc.status = 'done' AND oc.closed_at >= m.created_at)
RETURNING m.goal_id, m.name;

-- name: SetGoalRisk :exec
UPDATE goals SET manual_risk = sqlc.arg('manual_risk'), updated_at = now() WHERE id = sqlc.arg('id');

-- name: SetGoalCompleted :exec
-- completed_by NULL = se cumplió sola (con el último hito).
UPDATE goals SET completed_at = sqlc.narg('completed_at'), completed_by = sqlc.narg('completed_by'),
  confirmed_at = sqlc.narg('confirmed_at'), confirmed_by = sqlc.narg('confirmed_by'), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: ReopenGoal :exec
UPDATE goals SET due_date = sqlc.arg('due_date'), completed_at = NULL, completed_by = NULL, confirmed_at = NULL, confirmed_by = NULL,
  manual_risk = false, outcome = NULL, outcome_reason = NULL, outcome_at = NULL, outcome_by = NULL, updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SetGoalOutcome :exec
-- No lograda / no hace falta (NULL lo vuelve a abrir).
UPDATE goals SET outcome = sqlc.narg('outcome'), outcome_reason = sqlc.narg('outcome_reason'),
  outcome_at = CASE WHEN sqlc.narg('outcome')::text IS NULL THEN NULL ELSE now() END,
  outcome_by = sqlc.narg('outcome_by'), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SetGoalPersonRule :exec
INSERT INTO goal_person_rules (user_id, rule, updated_by) VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE SET rule = EXCLUDED.rule, updated_by = EXCLUDED.updated_by, updated_at = now();

-- name: DeleteGoalPersonRule :exec
DELETE FROM goal_person_rules WHERE user_id = $1;

-- name: AddGoalEvent :exec
INSERT INTO goal_events (goal_id, text, user_id) VALUES (sqlc.arg('goal_id'), sqlc.arg('text'), sqlc.narg('user_id'));

-- name: ListGoalEvents :many
SELECT e.id, e.text, e.created_at, COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name
FROM goal_events e LEFT JOIN users u ON u.id = e.user_id
WHERE e.goal_id = $1 ORDER BY e.created_at DESC LIMIT 50;

-- name: AddGoalEvidence :one
INSERT INTO goal_evidence (goal_id, file_name, mime_type, size_bytes, file_data, url, uploaded_by)
VALUES (sqlc.arg('goal_id'), sqlc.narg('file_name'), sqlc.narg('mime_type'), sqlc.narg('size_bytes'), sqlc.narg('file_data'), sqlc.narg('url'), sqlc.narg('uploaded_by'))
RETURNING id;

-- name: ListGoalEvidence :many
SELECT e.id, e.file_name, e.mime_type, e.size_bytes, e.url, e.created_at,
  COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS uploaded_by_name
FROM goal_evidence e LEFT JOIN users u ON u.id = e.uploaded_by
WHERE e.goal_id = $1 ORDER BY e.created_at DESC;

-- name: GetGoalEvidenceFile :one
SELECT id, file_name, mime_type, file_data FROM goal_evidence WHERE id = $1 AND goal_id = $2 AND file_data IS NOT NULL;

-- name: DeleteGoalEvidence :execrows
DELETE FROM goal_evidence WHERE id = $1 AND goal_id = $2;

-- name: ListLeadUserIDsOfPerson :many
-- Las jefaturas de las áreas de una persona (ven y confirman sus metas).
SELECT DISTINCT lu.user_id
FROM user_permission_groups pu
JOIN permission_groups ppg ON ppg.id = pu.permission_group_id AND ppg.active
JOIN permission_group_areas pa ON pa.permission_group_id = ppg.id
JOIN permission_group_areas la ON la.area_id = pa.area_id
JOIN permission_groups lpg ON lpg.id = la.permission_group_id AND lpg.active AND 'area:lead' = ANY(lpg.capabilities)
JOIN user_permission_groups lu ON lu.permission_group_id = lpg.id
WHERE pu.user_id = $1;

-- name: ListPersonAreaNames :many
SELECT DISTINCT a.name, a.sort_order
FROM user_permission_groups upg
JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
JOIN areas a ON a.id = pa.area_id
WHERE upg.user_id = $1
ORDER BY a.sort_order, a.name;

-- name: ListGoalPeople :many
-- A quién se le puede poner una meta: los usuarios activos con cada área y
-- nivel; quien no está en ningún área sale una vez sin área (solo lo ve el admin).
SELECT u.id, COALESCE(NULLIF(u.full_name, ''), u.username)::text AS name, COALESCE(x.area_id::text, '')::text AS area_id, COALESCE(x.area_name, '')::text AS area_name,
  COALESCE(x.level_name, '')::text AS level_name
FROM users u
LEFT JOIN (
  SELECT DISTINCT upg.user_id, a.id AS area_id, a.name AS area_name, l.name AS level_name
  FROM user_permission_groups upg
  JOIN permission_groups pg ON pg.id = upg.permission_group_id AND pg.active
  JOIN permission_group_areas pa ON pa.permission_group_id = pg.id
  JOIN areas a ON a.id = pa.area_id AND a.active
  LEFT JOIN levels l ON l.id = pg.level_id
) x ON x.user_id = u.id
WHERE u.active
ORDER BY 2, 4;

-- name: GetUserNameByEmail :one
-- Una meta escrita a mano no puede llevar el correo de alguien que ya es usuario.
SELECT id, COALESCE(NULLIF(full_name, ''), username)::text AS name FROM users WHERE lower(email) = lower(sqlc.arg('email')::text) LIMIT 1;

-- ===== Plantillas =====

-- name: ListPlaybooks :many
SELECT p.*, (SELECT count(*) FROM playbook_items i WHERE i.playbook_id = p.id)::int AS items
FROM playbooks p WHERE p.active ORDER BY (p.system_key IS NULL), p.created_at, p.name;

-- name: ListPlaybookItems :many
SELECT i.*, COALESCE(a.name, '')::text AS area_name, COALESCE(l.name, '')::text AS level_name, COALESCE(tm.name, '')::text AS team_name,
  COALESCE(a.active, true)::bool AS area_active
FROM playbook_items i
LEFT JOIN areas a ON a.id = i.area_id
LEFT JOIN levels l ON l.id = i.level_id
LEFT JOIN teams tm ON tm.id = i.team_id
WHERE i.playbook_id = ANY(sqlc.arg('playbook_ids')::uuid[])
ORDER BY i.playbook_id, i.position;

-- name: CreatePlaybook :one
INSERT INTO playbooks (name, description, anchor, created_by) VALUES ($1, $2, $3, $4) RETURNING id;

-- name: UpdatePlaybook :execrows
UPDATE playbooks SET name = $2, description = $3, anchor = CASE WHEN system_key IS NULL THEN $4 ELSE anchor END, updated_at = now()
WHERE id = $1 AND active;

-- name: DeactivatePlaybook :execrows
UPDATE playbooks SET active = false, updated_at = now() WHERE id = $1 AND system_key IS NULL;

-- name: DeletePlaybookItems :exec
DELETE FROM playbook_items WHERE playbook_id = $1;

-- name: CreatePlaybookItem :exec
INSERT INTO playbook_items (playbook_id, position, name, action_kind, is_key, assignee, area_id, level_id, team_id, offset_days, offset_unit)
VALUES (sqlc.arg('playbook_id'), sqlc.arg('position'), sqlc.arg('name'), sqlc.narg('action_kind'), sqlc.arg('is_key'), sqlc.arg('assignee'),
  sqlc.narg('area_id'), sqlc.narg('level_id'), sqlc.narg('team_id'), sqlc.arg('offset_days'), sqlc.arg('offset_unit'));

-- name: CreatePlaybookApplication :one
INSERT INTO playbook_applications (playbook_id, client_id, anchor_date, applied_by) VALUES ($1, $2, $3, $4) RETURNING id;

-- name: SetAgendaTaskApplication :exec
UPDATE agenda_tasks SET playbook_application_id = $2 WHERE id = $1;

-- name: ListClientPlaybookTasks :many
-- Las tareas que dejó cada plantilla aplicada al cliente (la de renovación
-- se muestra junto a la cuenta regresiva).
SELECT pa.id AS application_id, pa.playbook_id, p.system_key, pa.anchor_date, pa.applied_at, k.id AS task_id, k.name,
  oc.due_date, oc.status, oc.closed_at
FROM playbook_applications pa
JOIN playbooks p ON p.id = pa.playbook_id
JOIN agenda_tasks k ON k.playbook_application_id = pa.id
LEFT JOIN agenda_occurrences oc ON oc.task_id = k.id
WHERE pa.client_id = $1
ORDER BY pa.applied_at DESC, oc.due_date;

-- name: ListGoalsForAlerts :many
-- Metas sin cumplir que vencen pronto o se vencieron hace poco, con a quién
-- avisar: la persona (o el responsable) y quien la creó.
SELECT g.id, g.name, g.scope, g.due_date, g.person_user_id, g.owner_user_id, g.created_by,
  COALESCE(o.name, '')::text AS client_name, COALESCE(a.name, '')::text AS area_name
FROM goals g
LEFT JOIN organizations o ON o.id = g.client_id
LEFT JOIN areas a ON a.id = g.area_id
WHERE g.completed_at IS NULL AND g.outcome IS NULL AND g.due_date BETWEEN sqlc.arg('from_day')::date AND sqlc.arg('to_day')::date;

-- name: InsertGoalAlert :execrows
INSERT INTO goal_alerts (goal_id, alert) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: ListClientNotes :many
-- Notas internas del CSM de un cliente: las fijadas arriba, después las más nuevas.
SELECT * FROM client_notes WHERE client_id = $1 ORDER BY pinned DESC, created_at DESC;

-- name: CountClientNotes :one
SELECT count(*)::int FROM client_notes WHERE client_id = $1;

-- name: GetClientNote :one
SELECT * FROM client_notes WHERE id = $1;

-- name: CreateClientNote :one
INSERT INTO client_notes (client_id, author_id, author_name, content) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdateClientNote :one
UPDATE client_notes SET content = $2, edited_at = now() WHERE id = $1 RETURNING *;

-- name: PinClientNote :one
UPDATE client_notes SET pinned = sqlc.arg('pinned'),
  pinned_by = CASE WHEN sqlc.arg('pinned')::boolean THEN sqlc.narg('pinned_by')::uuid END,
  pinned_at = CASE WHEN sqlc.arg('pinned')::boolean THEN now() END
WHERE id = sqlc.arg('id') RETURNING *;

-- name: DeleteClientNote :execrows
DELETE FROM client_notes WHERE id = $1;
