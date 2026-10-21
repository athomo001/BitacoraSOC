-- Reenvío de eventos a un SIEM y API de integraciones (spec/19, 10b).

-- ===== Destinos del reenvío =====

-- name: ListForwardDestinations :many
-- Con sus cifras: enviados hoy, perdidos en 7 días y lo que espera en cola.
SELECT d.*,
  COALESCE((SELECT s.sent FROM forward_stats s WHERE s.destination_id = d.id AND s.day = sqlc.arg('today')::date), 0)::int AS sent_today,
  COALESCE((SELECT sum(s.lost) FROM forward_stats s WHERE s.destination_id = d.id AND s.day > sqlc.arg('today')::date - 7), 0)::int AS lost_week,
  (SELECT count(*) FROM forward_outbox o WHERE d.enabled AND o.id > d.cursor_id AND (
     (o.grp = 'audit' AND d.send_audit AND (CASE o.level WHEN 'info' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END) >= (CASE d.audit_level WHEN 'info' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END))
     OR (o.grp = 'entries' AND d.send_entries) OR (o.grp = 'escalation' AND d.send_escalation) OR (o.grp = 'tickets' AND d.send_tickets)))::int AS pending
FROM forward_destinations d
ORDER BY d.created_at;

-- name: GetForwardDestination :one
SELECT * FROM forward_destinations WHERE id = $1;

-- name: CreateForwardDestination :one
-- Parte desde el último evento de la cola: no recibe lo anterior a crearse.
INSERT INTO forward_destinations (name, enabled, transport, host, port, url, format, batch, send_audit, audit_level,
  send_entries, send_escalation, send_tickets, ca_cert, client_cert, client_key_encrypted, header_names, headers_encrypted, cursor_id, created_by)
VALUES (sqlc.arg('name'), sqlc.arg('enabled'), sqlc.arg('transport'), sqlc.narg('host'), sqlc.narg('port'), sqlc.narg('url'), sqlc.arg('format'), sqlc.arg('batch'),
  sqlc.arg('send_audit'), sqlc.arg('audit_level'), sqlc.arg('send_entries'), sqlc.arg('send_escalation'), sqlc.arg('send_tickets'),
  sqlc.narg('ca_cert'), sqlc.narg('client_cert'), sqlc.narg('client_key_encrypted'), sqlc.arg('header_names'), sqlc.narg('headers_encrypted'),
  (SELECT COALESCE(max(fo.id), 0) FROM forward_outbox fo), sqlc.narg('created_by'))
RETURNING *;

-- name: UpdateForwardDestination :one
-- Al encenderlo de nuevo parte desde ahora (lo de antes ya no se manda) y
-- se borra el estado de falla.
UPDATE forward_destinations d SET
  name = sqlc.arg('name'), transport = sqlc.arg('transport'), host = sqlc.narg('host'), port = sqlc.narg('port'), url = sqlc.narg('url'),
  format = sqlc.arg('format'), batch = sqlc.arg('batch'), send_audit = sqlc.arg('send_audit'), audit_level = sqlc.arg('audit_level'),
  send_entries = sqlc.arg('send_entries'), send_escalation = sqlc.arg('send_escalation'), send_tickets = sqlc.arg('send_tickets'),
  ca_cert = sqlc.narg('ca_cert'), client_cert = sqlc.narg('client_cert'), client_key_encrypted = sqlc.narg('client_key_encrypted'),
  header_names = sqlc.arg('header_names'), headers_encrypted = sqlc.narg('headers_encrypted'),
  cursor_id = CASE WHEN sqlc.arg('enabled')::boolean AND NOT d.enabled THEN (SELECT COALESCE(max(fo.id), 0) FROM forward_outbox fo) ELSE d.cursor_id END,
  failures = CASE WHEN sqlc.arg('enabled')::boolean THEN d.failures ELSE 0 END,
  failing_since = CASE WHEN sqlc.arg('enabled')::boolean THEN d.failing_since END,
  down_alerted = CASE WHEN sqlc.arg('enabled')::boolean THEN d.down_alerted ELSE false END,
  next_attempt_at = NULL,
  enabled = sqlc.arg('enabled'), updated_at = now()
WHERE d.id = sqlc.arg('id')
RETURNING *;

-- name: DeleteForwardDestination :execrows
DELETE FROM forward_destinations WHERE id = $1;

-- name: ListForwardSubscriptions :many
-- Qué grupos pide algún destino encendido: sin destinos, no se encola nada.
SELECT send_audit, audit_level, send_entries, send_escalation, send_tickets FROM forward_destinations WHERE enabled;

-- name: ListDueForwardDestinations :many
SELECT id FROM forward_destinations
WHERE enabled AND (next_attempt_at IS NULL OR next_attempt_at <= now()) AND (lease_until IS NULL OR lease_until < now());

-- name: AcquireForwardLease :one
-- Un solo nodo envía cada destino (spec/09): el préstamo dura 30 s y el
-- otro nodo lo respeta.
UPDATE forward_destinations SET lease_until = now() + interval '30 seconds', lease_owner = sqlc.arg('owner')
WHERE id = sqlc.arg('id') AND enabled AND (next_attempt_at IS NULL OR next_attempt_at <= now())
  AND (lease_until IS NULL OR lease_until < now() OR lease_owner = sqlc.arg('owner'))
RETURNING *;

-- name: ReleaseForwardLease :exec
UPDATE forward_destinations SET lease_until = NULL, lease_owner = NULL WHERE id = sqlc.arg('id') AND lease_owner = sqlc.arg('owner');

-- name: ListForwardBatch :many
SELECT o.* FROM forward_outbox o
WHERE o.id > sqlc.arg('cursor_id') AND (
  (o.grp = 'audit' AND sqlc.arg('send_audit')::boolean AND (CASE o.level WHEN 'info' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END) >= sqlc.arg('min_rank')::int)
  OR (o.grp = 'entries' AND sqlc.arg('send_entries')::boolean)
  OR (o.grp = 'escalation' AND sqlc.arg('send_escalation')::boolean)
  OR (o.grp = 'tickets' AND sqlc.arg('send_tickets')::boolean))
ORDER BY o.id
LIMIT sqlc.arg('max_rows');

-- name: ExpiredForwardEvents :one
-- Lo que lleva más de 7 días esperando se da por perdido: cuántos y hasta
-- dónde avanza el cursor.
SELECT count(*)::int AS lost, COALESCE(max(o.id), 0)::bigint AS last_id FROM forward_outbox o
WHERE o.id > sqlc.arg('cursor_id') AND o.created_at < now() - interval '7 days' AND (
  (o.grp = 'audit' AND sqlc.arg('send_audit')::boolean AND (CASE o.level WHEN 'info' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END) >= sqlc.arg('min_rank')::int)
  OR (o.grp = 'entries' AND sqlc.arg('send_entries')::boolean)
  OR (o.grp = 'escalation' AND sqlc.arg('send_escalation')::boolean)
  OR (o.grp = 'tickets' AND sqlc.arg('send_tickets')::boolean));

-- name: AdvanceForwardCursor :exec
UPDATE forward_destinations SET cursor_id = GREATEST(cursor_id, sqlc.arg('cursor_id')) WHERE id = sqlc.arg('id');

-- name: MarkForwardSent :one
-- Devuelve si estaba caído y ya se había avisado, para avisar que volvió.
UPDATE forward_destinations d SET cursor_id = GREATEST(d.cursor_id, sqlc.arg('cursor_id')), last_sent_at = now(),
  failures = 0, failing_since = NULL, next_attempt_at = NULL, down_alerted = false, last_error = NULL
FROM (SELECT p.down_alerted AS was_alerted FROM forward_destinations p WHERE p.id = sqlc.arg('id')) prev
WHERE d.id = sqlc.arg('id')
RETURNING prev.was_alerted;

-- name: MarkForwardFailed :one
UPDATE forward_destinations SET failures = failures + 1, failing_since = COALESCE(failing_since, now()),
  last_error = sqlc.arg('error'), last_error_at = now(), next_attempt_at = sqlc.arg('next_attempt_at')
WHERE id = sqlc.arg('id')
RETURNING failing_since, down_alerted;

-- name: SetForwardDownAlerted :exec
UPDATE forward_destinations SET down_alerted = true WHERE id = $1;

-- name: AddForwardStats :exec
INSERT INTO forward_stats (destination_id, day, sent, lost) VALUES (sqlc.arg('id'), sqlc.arg('day'), sqlc.arg('sent'), sqlc.arg('lost'))
ON CONFLICT (destination_id, day) DO UPDATE SET sent = forward_stats.sent + EXCLUDED.sent, lost = forward_stats.lost + EXCLUDED.lost;

-- name: InsertForwardEvent :exec
INSERT INTO forward_outbox (grp, level, event, payload) VALUES ($1, $2, $3, $4);

-- name: PurgeForwardOutbox :execrows
-- Lo que ya pasaron todos los destinos encendidos, y lo de más de 7 días.
DELETE FROM forward_outbox
WHERE created_at < now() - interval '7 days'
   OR id <= COALESCE((SELECT min(fd.cursor_id) FROM forward_destinations fd WHERE fd.enabled), (SELECT max(fo.id) FROM forward_outbox fo));

-- name: PurgeForwardStats :exec
DELETE FROM forward_stats WHERE day < CURRENT_DATE - 30;

-- ===== Llaves de la API =====

-- name: CreateAPIKey :one
INSERT INTO api_keys (name, description, key_prefix, key_hash, scopes, client_ids, area_id, expires_at, created_by)
VALUES (sqlc.arg('name'), sqlc.arg('description'), sqlc.arg('key_prefix'), sqlc.arg('key_hash'), sqlc.arg('scopes'),
  sqlc.narg('client_ids'), sqlc.narg('area_id'), sqlc.narg('expires_at'), sqlc.arg('created_by'))
RETURNING *;

-- name: ListAPIKeys :many
SELECT k.*, COALESCE(u.username, '')::text AS created_by_name, COALESCE(rb.username, '')::text AS revoked_by_name,
  COALESCE(a.name, '')::text AS area_name,
  (SELECT count(*) FROM api_key_requests r WHERE r.api_key_id = k.id AND r.created_at > now() - interval '7 days')::int AS calls_week
FROM api_keys k
LEFT JOIN users u ON u.id = k.created_by
LEFT JOIN users rb ON rb.id = k.revoked_by
LEFT JOIN areas a ON a.id = k.area_id
ORDER BY k.active DESC, k.created_at DESC;

-- name: GetAPIKey :one
SELECT * FROM api_keys WHERE id = $1;

-- name: GetAPIKeyForAuth :one
-- La llave con su creador: si la persona se dio de baja, la llave no vale.
SELECT k.*, COALESCE(u.username, '')::text AS creator_username, COALESCE(u.role::text, '')::text AS creator_role,
  COALESCE(u.active, false) AS creator_active
FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
WHERE k.key_prefix = $1;

-- name: RevokeAPIKey :one
UPDATE api_keys SET active = false, revoked_at = now(), revoked_by = sqlc.narg('revoked_by'), revoke_reason = sqlc.narg('reason')
WHERE id = sqlc.arg('id') AND active
RETURNING *;

-- name: TouchAPIKey :exec
UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '30 seconds');

-- name: InsertAPIKeyRequest :exec
INSERT INTO api_key_requests (api_key_id, key_prefix, method, path, scope, status, latency_ms, ip, note)
VALUES (sqlc.narg('api_key_id'), sqlc.narg('key_prefix'), sqlc.arg('method'), sqlc.arg('path'), sqlc.narg('scope'), sqlc.arg('status'),
  sqlc.arg('latency_ms'), sqlc.narg('ip'), sqlc.narg('note'));

-- name: ListAPIKeyRequests :many
SELECT * FROM api_key_requests WHERE api_key_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50;

-- name: PurgeAPIKeyRequests :execrows
DELETE FROM api_key_requests WHERE created_at < now() - interval '90 days';

-- name: ClaimIdempotency :execrows
INSERT INTO api_idempotency (api_key_id, idem_key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: GetIdempotency :one
SELECT * FROM api_idempotency WHERE api_key_id = $1 AND idem_key = $2;

-- name: FinishIdempotency :exec
UPDATE api_idempotency SET status = sqlc.arg('status'), body = sqlc.arg('body') WHERE api_key_id = sqlc.arg('api_key_id') AND idem_key = sqlc.arg('idem_key');

-- name: DeleteIdempotency :exec
DELETE FROM api_idempotency WHERE api_key_id = $1 AND idem_key = $2;

-- name: PurgeIdempotency :execrows
DELETE FROM api_idempotency WHERE created_at < now() - interval '24 hours';

-- ===== API de integraciones: datos =====

-- name: ListEntriesForAPI :many
-- Entradas de la Bitácora para una llave: de sus clientes (NULL = todos;
-- el cliente sale del servicio, del activo o de la etiqueta cliente:X),
-- más nuevas primero, paginadas por (fecha, id).
SELECT e.*, u.username AS author_username,
  COALESCE(COALESCE(so.id, ac.id, tc.id)::text, '')::text AS client_id, COALESCE(so.name, ac.name, tc.name, '')::text AS client_name
FROM entries e
JOIN users u ON u.id = e.user_id
LEFT JOIN services sv ON sv.id = e.service_id
LEFT JOIN organizations so ON so.id = sv.organization_id
LEFT JOIN assets ast ON ast.id = e.asset_id
LEFT JOIN organizations ac ON ac.id = ast.client_id
LEFT JOIN LATERAL (SELECT o.id, o.name FROM organizations o, unnest(e.tags) t WHERE lower(t) = lower('cliente:' || o.name) LIMIT 1) tc ON true
WHERE (sqlc.narg('id')::uuid IS NULL OR e.id = sqlc.narg('id'))
  AND (sqlc.narg('client_ids')::uuid[] IS NULL OR COALESCE(so.id, ac.id, tc.id) = ANY(sqlc.narg('client_ids')::uuid[]))
  AND (sqlc.narg('client_id')::uuid IS NULL OR COALESCE(so.id, ac.id, tc.id) = sqlc.narg('client_id'))
  AND (sqlc.narg('since')::timestamptz IS NULL OR e.created_at >= sqlc.narg('since'))
  AND (sqlc.narg('before_at')::timestamptz IS NULL OR (e.created_at, e.id) < (sqlc.narg('before_at')::timestamptz, sqlc.narg('before_id')::uuid))
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg('max_rows');

-- name: CreateAPIEntry :one
INSERT INTO entries (user_id, entry_type, scope, content, tags, service_id, api_key_id, api_key_name)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: FindClientForAPI :one
-- Un cliente activo por id o por nombre (sin distinguir mayúsculas).
SELECT id, name FROM organizations
WHERE type = 'client' AND active AND (id::text = sqlc.arg('ref')::text OR lower(name) = lower(sqlc.arg('ref')::text))
LIMIT 1;

-- name: ListClientServiceIDs :many
SELECT id FROM services WHERE organization_id = $1 AND active ORDER BY name;

-- name: ListTicketsForAPI :many
SELECT t.*, o.name AS client_name, a.code AS area_code, a.name AS area_name
FROM tickets t
JOIN organizations o ON o.id = t.client_id
JOIN areas a ON a.id = t.area_id
WHERE t.merged_into_id IS NULL
  AND (sqlc.narg('client_ids')::uuid[] IS NULL OR t.client_id = ANY(sqlc.narg('client_ids')::uuid[]))
  AND (sqlc.narg('client_id')::uuid IS NULL OR t.client_id = sqlc.narg('client_id'))
  AND (sqlc.narg('status')::text IS NULL OR t.status::text = sqlc.narg('status'))
  AND (sqlc.narg('since')::timestamptz IS NULL OR t.updated_at >= sqlc.narg('since'))
  AND (sqlc.narg('before_at')::timestamptz IS NULL OR (t.created_at, t.id) < (sqlc.narg('before_at')::timestamptz, sqlc.narg('before_id')::uuid))
ORDER BY t.created_at DESC, t.id DESC
LIMIT sqlc.arg('max_rows');

-- name: SetTicketAPIKey :exec
UPDATE tickets SET api_key_id = $2, api_key_name = $3 WHERE id = $1;

-- name: ListOnCallTeams :many
-- Las guardias con un ciclo de rotación activo (lo que resuelve quién está
-- de guardia ahora), con su cliente si es de uno.
SELECT DISTINCT t.id, t.name, t.organization_id, COALESCE(o.name, '')::text AS organization_name
FROM teams t
JOIN rotation_cycles rc ON rc.team_id = t.id AND rc.active
LEFT JOIN organizations o ON o.id = t.organization_id
ORDER BY t.name;

-- name: GetTicketBrief :one
-- Lo que lleva un evento de la Ticketera al SIEM.
SELECT t.id, t.ticket_number, t.title, t.status::text AS status, t.priority::text AS priority, t.ticket_type::text AS ticket_type,
  t.source, t.client_id, o.name AS client_name, a.name AS area_name, COALESCE(u.username, '')::text AS assignee, t.sla_resolution_due_at
FROM tickets t
JOIN organizations o ON o.id = t.client_id
JOIN areas a ON a.id = t.area_id
LEFT JOIN users u ON u.id = t.assigned_user_id
WHERE t.id = $1;

-- name: ListActiveClientNames :many
SELECT id, name FROM organizations WHERE type = 'client' AND active ORDER BY name;
