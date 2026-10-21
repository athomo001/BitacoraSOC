-- Importación desde GLPI (spec/16 §5.1, 9.6, 000043).

-- name: GetGlpiConfig :one
SELECT * FROM glpi_config WHERE id;

-- name: UpdateGlpiConfig :exec
UPDATE glpi_config SET api_url = sqlc.arg('api_url'), app_token_encrypted = sqlc.narg('app_token_encrypted'),
  user_token_encrypted = sqlc.narg('user_token_encrypted'), verify_tls = sqlc.arg('verify_tls'),
  timeout_seconds = sqlc.arg('timeout_seconds'), import_computers = sqlc.arg('import_computers'),
  import_network = sqlc.arg('import_network'), area_id = sqlc.narg('area_id'),
  computer_types = sqlc.arg('computer_types'), entities = sqlc.arg('entities'), auto_mode = sqlc.arg('auto_mode'),
  updated_at = now()
WHERE id;

-- name: RecordGlpiTest :exec
UPDATE glpi_config SET last_test_at = now(), last_test_ok = sqlc.arg('ok'), last_test = sqlc.arg('result') WHERE id;

-- name: MarkGlpiAutoRun :exec
UPDATE glpi_config SET last_auto_at = sqlc.arg('at') WHERE id;

-- name: MarkGlpiFailureNotified :exec
UPDATE glpi_config SET last_failure_notified_on = sqlc.arg('day') WHERE id;

-- name: CreateGlpiRun :one
INSERT INTO glpi_import_runs (trigger, user_id) VALUES (sqlc.arg('trigger'), sqlc.narg('user_id')) RETURNING id;

-- name: FinishGlpiRun :exec
UPDATE glpi_import_runs SET finished_at = now(), ok = sqlc.arg('ok'), created = sqlc.arg('created'), updated = sqlc.arg('updated'),
  deactivated = sqlc.arg('deactivated'), reactivated = sqlc.arg('reactivated'), skipped = sqlc.arg('skipped'),
  unchanged = sqlc.arg('unchanged'), held_back = sqlc.arg('held_back'), message = sqlc.arg('message')
WHERE id = sqlc.arg('id');

-- name: ListGlpiRuns :many
SELECT r.*, COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name
FROM glpi_import_runs r
LEFT JOIN users u ON u.id = r.user_id
ORDER BY r.started_at DESC
LIMIT 20;

-- name: ListGlpiLinkedAssets :many
-- Los equipos que vienen de GLPI (activos o no).
SELECT id, code, name, active, glpi_itemtype::text AS glpi_itemtype, glpi_id::int AS glpi_id, glpi_removed_at
FROM assets WHERE glpi_id IS NOT NULL;

-- name: ListAssetsBySerial :many
-- Equipos creados en la app (sin vínculo con GLPI) con alguna de estas series.
SELECT id, code, name, serial::text AS serial FROM assets
WHERE glpi_id IS NULL AND serial IS NOT NULL AND lower(serial) = ANY(sqlc.arg('serials')::text[]);

-- name: SetAssetGlpiLink :exec
UPDATE assets SET glpi_itemtype = sqlc.arg('glpi_itemtype'), glpi_id = sqlc.arg('glpi_id'), glpi_removed_at = NULL, updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SetAssetGlpiRemoved :exec
-- removed=true: dado de baja porque desapareció de GLPI; false: volvió.
UPDATE assets SET active = NOT sqlc.arg('removed')::bool,
  glpi_removed_at = CASE WHEN sqlc.arg('removed')::bool THEN now() ELSE NULL END, updated_at = now()
WHERE id = sqlc.arg('id');

-- name: AssetCodeTaken :one
SELECT EXISTS (SELECT 1 FROM assets WHERE code = $1);

-- ===== Tickets de GLPI en la Ticketera (10d.1, spec/18, 000050) =====

-- name: UpdateGlpiTicketsConfig :exec
-- reset_cursor: cambiaron las entidades o los grupos; la próxima corrida
-- vuelve a hacer la primera carga (no duplica: glpi_id es único).
UPDATE glpi_config SET tickets_enabled = sqlc.arg('tickets_enabled'), tickets_every = sqlc.arg('tickets_every'),
  tickets_since_days = sqlc.arg('tickets_since_days'), ticket_entities = sqlc.arg('ticket_entities'),
  group_areas = sqlc.arg('group_areas'), entities = sqlc.arg('entities'),
  tickets_cursor = CASE WHEN sqlc.arg('reset_cursor')::bool THEN NULL ELSE tickets_cursor END,
  updated_at = now()
WHERE id;

-- name: SetGlpiTicketsCursor :exec
UPDATE glpi_config SET tickets_cursor = sqlc.narg('cursor') WHERE id;

-- name: MarkGlpiTicketsAutoRun :exec
UPDATE glpi_config SET tickets_last_auto_at = sqlc.arg('at') WHERE id;

-- name: MarkGlpiTicketsFailureNotified :exec
UPDATE glpi_config SET tickets_failure_notified_on = sqlc.arg('day') WHERE id;

-- name: CreateGlpiTicketRun :one
-- clock_timestamp: la hora real aunque la corrida vaya dentro de una transacción.
INSERT INTO glpi_ticket_runs (trigger, user_id, first_load, started_at) VALUES (sqlc.arg('trigger'), sqlc.narg('user_id'), sqlc.arg('first_load'), clock_timestamp()) RETURNING id;

-- name: FinishGlpiTicketRun :exec
UPDATE glpi_ticket_runs SET finished_at = clock_timestamp(), ok = sqlc.arg('ok'), created = sqlc.arg('created'), updated = sqlc.arg('updated'),
  skipped = sqlc.arg('skipped'), deleted = sqlc.arg('deleted'), message = sqlc.arg('message')
WHERE id = sqlc.arg('id');

-- name: ListGlpiTicketRuns :many
SELECT r.*, COALESCE(NULLIF(u.full_name, ''), u.username, '')::text AS user_name
FROM glpi_ticket_runs r
LEFT JOIN users u ON u.id = r.user_id
ORDER BY r.started_at DESC
LIMIT 20;

-- name: RecentGlpiTicketAutoRuns :many
-- Para avisar solo de errores repetidos: el resultado de las últimas automáticas.
SELECT ok FROM glpi_ticket_runs WHERE trigger = 'auto' AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 3;

-- name: GetGlpiTicketState :one
SELECT id, glpi_date_mod, glpi_linked_only, glpi_deleted, area_id FROM tickets WHERE glpi_id = $1;

-- name: UpsertGlpiTicket :one
-- GLPI manda: cada corrida deja el ticket como está en GLPI. Sin enlace
-- público; el número es GLPI-<id>.
INSERT INTO tickets (ticket_number, ticket_type, scope, client_id, assigned_user_id, status, impact, urgency, priority, title, description,
  sla_response_due_at, sla_resolution_due_at, sla_on_hold_since, first_responded_at, resolved_at, closed_at, created_at, updated_at,
  area_id, requested_area_id, public_tracking_enabled, source, glpi_id, glpi_date_mod, glpi_synced_at, glpi_deleted, glpi_linked_only,
  glpi_group_id, glpi_group_name, glpi_technician)
VALUES ('GLPI-' || sqlc.arg('glpi_id')::int, sqlc.arg('ticket_type'), sqlc.arg('scope'), sqlc.arg('client_id'), sqlc.narg('assigned_user_id'),
  sqlc.arg('status'), sqlc.arg('impact'), sqlc.arg('urgency'), sqlc.arg('priority'), sqlc.arg('title'), sqlc.arg('description'),
  sqlc.narg('sla_response_due_at'), sqlc.narg('sla_resolution_due_at'), sqlc.narg('sla_on_hold_since'), sqlc.narg('first_responded_at'),
  sqlc.narg('resolved_at'), sqlc.narg('closed_at'), sqlc.arg('created_at'), sqlc.arg('updated_at'),
  sqlc.arg('area_id'), sqlc.arg('area_id'), false, 'glpi', sqlc.arg('glpi_id')::int, sqlc.arg('glpi_date_mod'), now(), sqlc.arg('glpi_deleted'),
  sqlc.arg('glpi_linked_only'), sqlc.narg('glpi_group_id'), sqlc.narg('glpi_group_name'), sqlc.narg('glpi_technician'))
ON CONFLICT (glpi_id) WHERE glpi_id IS NOT NULL DO UPDATE SET
  ticket_type = EXCLUDED.ticket_type, scope = EXCLUDED.scope, client_id = EXCLUDED.client_id, assigned_user_id = EXCLUDED.assigned_user_id,
  status = EXCLUDED.status, impact = EXCLUDED.impact, urgency = EXCLUDED.urgency, priority = EXCLUDED.priority,
  title = EXCLUDED.title, description = EXCLUDED.description,
  sla_response_due_at = EXCLUDED.sla_response_due_at, sla_resolution_due_at = EXCLUDED.sla_resolution_due_at,
  sla_on_hold_since = EXCLUDED.sla_on_hold_since, first_responded_at = EXCLUDED.first_responded_at,
  resolved_at = EXCLUDED.resolved_at, closed_at = EXCLUDED.closed_at, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
  area_id = EXCLUDED.area_id, requested_area_id = EXCLUDED.requested_area_id,
  glpi_date_mod = EXCLUDED.glpi_date_mod, glpi_synced_at = now(), glpi_deleted = EXCLUDED.glpi_deleted,
  glpi_linked_only = EXCLUDED.glpi_linked_only, glpi_group_id = EXCLUDED.glpi_group_id,
  glpi_group_name = EXCLUDED.glpi_group_name, glpi_technician = EXCLUDED.glpi_technician
RETURNING id, (xmax = 0)::bool AS inserted;

-- name: UpsertGlpiTicketComment :exec
INSERT INTO ticket_comments (ticket_id, user_id, author_name, content, is_public, origin, glpi_id, glpi_kind, glpi_time_seconds, created_at)
VALUES (sqlc.arg('ticket_id'), sqlc.narg('user_id'), sqlc.arg('author_name'), sqlc.arg('content'), sqlc.arg('is_public'), '',
  sqlc.arg('glpi_id')::int, sqlc.arg('glpi_kind')::text, sqlc.narg('glpi_time_seconds'), sqlc.arg('created_at'))
ON CONFLICT (ticket_id, glpi_kind, glpi_id) WHERE glpi_id IS NOT NULL DO UPDATE SET
  user_id = EXCLUDED.user_id, author_name = EXCLUDED.author_name, content = EXCLUDED.content, is_public = EXCLUDED.is_public,
  glpi_time_seconds = EXCLUDED.glpi_time_seconds, created_at = EXCLUDED.created_at;

-- name: DeleteGlpiTicketCommentsExcept :exec
-- Lo que se borró en GLPI también sale de la app (keep: «followup:12», «task:7»…).
DELETE FROM ticket_comments
WHERE ticket_id = sqlc.arg('ticket_id') AND glpi_id IS NOT NULL
  AND NOT ((glpi_kind || ':' || glpi_id) = ANY(sqlc.arg('keep')::text[]));

-- name: MarkGlpiTicketDeleted :execrows
UPDATE tickets SET glpi_deleted = true, glpi_synced_at = now(), updated_at = now() WHERE glpi_id = $1 AND NOT glpi_deleted;

-- name: ListGlpiHandLinks :many
-- Números de GLPI enlazados a mano en la Bitácora o en Escalamiento, con
-- quien los enlazó primero (su área es la del ticket si no entra por grupo).
SELECT DISTINCT ON (x.glpi_id) x.glpi_id::int AS glpi_id, x.user_id::uuid AS user_id
FROM (
  SELECT e.glpi_ticket_id::int AS glpi_id, e.user_id, COALESCE(e.glpi_linked_at, e.created_at) AS at
  FROM entries e WHERE e.glpi_ticket_id ~ '^[0-9]{1,9}$'
  UNION ALL
  SELECT i.glpi_ticket::int, i.opened_by, i.opened_at
  FROM escalation_incidents i WHERE i.glpi_ticket ~ '^[0-9]{1,9}$'
) x
ORDER BY x.glpi_id, x.at;

-- name: ListOpenGlpiLinkedOnly :many
-- Los que llegaron solo por un enlace a mano: no los ve la búsqueda por
-- entidad, así que cada corrida los vuelve a leer mientras sigan abiertos.
SELECT glpi_id::int AS glpi_id FROM tickets
WHERE source = 'glpi' AND glpi_linked_only AND NOT glpi_deleted AND status NOT IN ('closed', 'cancelled');

-- name: CountOpenGlpiTicketsByGroup :many
SELECT glpi_group_id::int AS group_id, count(*)::int AS open_count FROM tickets
WHERE source = 'glpi' AND glpi_group_id IS NOT NULL AND NOT glpi_deleted AND status NOT IN ('resolved', 'closed', 'cancelled')
GROUP BY glpi_group_id;

-- name: ListUsersByEmails :many
-- El técnico de GLPI es la persona de la app con el mismo correo.
SELECT id, lower(email)::text AS email, username FROM users WHERE active AND lower(email) = ANY(sqlc.arg('emails')::text[]);
