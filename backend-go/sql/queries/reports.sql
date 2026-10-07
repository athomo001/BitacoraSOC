-- ===== Reportes (comentario del dueño #10) =====

-- name: InsertReportHistory :one
INSERT INTO report_history (kind, title, subject, organization_id, service_id, recipients, cc_recipients, html, payload, status, error, sent_by, sent_by_username)
VALUES (sqlc.arg('kind'), sqlc.arg('title'), sqlc.arg('subject'), sqlc.narg('organization_id'), sqlc.narg('service_id'), sqlc.arg('recipients'), sqlc.arg('cc_recipients'),
  sqlc.arg('html'), sqlc.narg('payload'), sqlc.arg('status'), sqlc.narg('error'), sqlc.narg('sent_by'), sqlc.arg('sent_by_username'))
RETURNING id, created_at;

-- name: ListReportHistory :many
-- Sin el html (pesa): la lista del historial.
SELECT h.id, h.kind, h.title, h.subject, h.organization_id, o.name AS organization_name, h.recipients, h.cc_recipients,
  h.status, h.error, h.sent_by_username, h.created_at, (h.payload IS NOT NULL)::boolean AS reusable
FROM report_history h LEFT JOIN organizations o ON o.id = h.organization_id
WHERE (sqlc.narg('kind')::text IS NULL OR h.kind = sqlc.narg('kind'))
ORDER BY h.created_at DESC
LIMIT sqlc.arg('max_rows') OFFSET sqlc.arg('skip_rows');

-- name: CountReportHistory :one
SELECT count(*) FROM report_history WHERE (sqlc.narg('kind')::text IS NULL OR kind = sqlc.narg('kind'));

-- name: GetReportHistory :one
SELECT h.*, o.name AS organization_name FROM report_history h LEFT JOIN organizations o ON o.id = h.organization_id WHERE h.id = $1;

-- name: DeleteReportHistory :execrows
DELETE FROM report_history WHERE id = $1;

-- name: ListEmailDomainSources :many
-- Correos conocidos para los dominios permitidos (getValidSOCDomains del
-- legacy): usuarios en claro; los de contactos van cifrados y se descifran
-- en Go.
SELECT email::text AS value, false AS encrypted FROM users WHERE email IS NOT NULL AND email <> ''
UNION ALL
SELECT cc.value_encrypted AS value, true AS encrypted FROM contact_channels cc WHERE cc.channel_type = 'email';

-- name: ListEscalationEmailsForOrganization :many
-- Para/CC propuestos: los correos de los integrantes del primer paso del
-- escalamiento de cada servicio del cliente (como el legacy proponía los
-- PARA/CC del cliente).
SELECT DISTINCT tm.recipient_type::text AS recipient_type, cc.value_encrypted
FROM services s
JOIN escalation_policies p ON p.service_id = s.id AND p.active
JOIN escalation_steps st ON st.policy_id = p.id AND st.step_order = (SELECT min(x.step_order) FROM escalation_steps x WHERE x.policy_id = p.id)
JOIN team_members tm ON tm.team_id = st.team_id AND tm.active
JOIN contact_channels cc ON cc.contact_id = tm.contact_id AND cc.channel_type = 'email'
WHERE s.organization_id = $1 AND (sqlc.narg('service_id')::uuid IS NULL OR s.id = sqlc.narg('service_id'));

-- ===== Avisos por cliente =====

-- name: ListClientAlertRules :many
SELECT r.*, o.name AS organization_name FROM client_alert_rules r JOIN organizations o ON o.id = r.organization_id
WHERE (sqlc.narg('organization_id')::uuid IS NULL OR r.organization_id = sqlc.narg('organization_id'))
ORDER BY o.name, r.priority, r.name;

-- name: ListActiveClientAlertRules :many
SELECT r.*, o.name AS organization_name FROM client_alert_rules r JOIN organizations o ON o.id = r.organization_id
WHERE r.enabled AND r.organization_id = $1 ORDER BY r.priority, r.name;

-- name: GetClientAlertRule :one
SELECT * FROM client_alert_rules WHERE id = $1;

-- name: CreateClientAlertRule :one
INSERT INTO client_alert_rules (organization_id, name, enabled, contexts, timezone, priority, valid_from, valid_to, holiday_dates, time_windows, channels, message, requires_ack, updated_by)
VALUES (sqlc.arg('organization_id'), sqlc.arg('name'), sqlc.arg('enabled'), sqlc.arg('contexts'), sqlc.arg('timezone'), sqlc.arg('priority'), sqlc.narg('valid_from'), sqlc.narg('valid_to'),
  sqlc.arg('holiday_dates'), sqlc.arg('time_windows'), sqlc.arg('channels'), sqlc.arg('message'), sqlc.arg('requires_ack'), sqlc.narg('updated_by'))
RETURNING *;

-- name: UpdateClientAlertRule :one
UPDATE client_alert_rules SET organization_id = sqlc.arg('organization_id'), name = sqlc.arg('name'), enabled = sqlc.arg('enabled'), contexts = sqlc.arg('contexts'),
  timezone = sqlc.arg('timezone'), priority = sqlc.arg('priority'), valid_from = sqlc.narg('valid_from'), valid_to = sqlc.narg('valid_to'),
  holiday_dates = sqlc.arg('holiday_dates'), time_windows = sqlc.arg('time_windows'), channels = sqlc.arg('channels'), message = sqlc.arg('message'),
  requires_ack = sqlc.arg('requires_ack'), updated_by = sqlc.narg('updated_by'), updated_at = now()
WHERE id = sqlc.arg('id') RETURNING *;

-- name: DeleteClientAlertRule :execrows
DELETE FROM client_alert_rules WHERE id = $1;

-- name: AckClientAlert :exec
INSERT INTO client_alert_acks (rule_id, user_id, occurrence_key, context) VALUES ($1, $2, $3, $4)
ON CONFLICT (rule_id, user_id, occurrence_key, context) DO NOTHING;

-- name: HasClientAlertAck :one
SELECT EXISTS (SELECT 1 FROM client_alert_acks WHERE rule_id = $1 AND user_id = $2 AND occurrence_key = $3 AND context = $4);

-- ===== Tipos de operación del informe de incidente =====

-- name: ListReportOperationTypes :many
SELECT * FROM report_operation_types ORDER BY name;

-- name: CreateReportOperationType :one
INSERT INTO report_operation_types (name, info_default, enabled) VALUES ($1, $2, $3) RETURNING *;

-- name: UpdateReportOperationType :one
UPDATE report_operation_types SET name = $2, info_default = $3, enabled = $4, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteReportOperationType :execrows
DELETE FROM report_operation_types WHERE id = $1;

-- ===== Eventos del informe de incidente (catalogEvents del legacy) =====

-- name: SuggestReportEvents :many
-- Sugerencias al escribir: lo que empieza igual primero, luego lo que lo
-- contiene (nombre o categoría); sin tildes no hace falta porque el legacy
-- tampoco los normalizaba y el texto se escribe como en el catálogo.
SELECT * FROM report_events
WHERE enabled
  AND (name ILIKE '%' || sqlc.arg('q')::text || '%' OR parent ILIKE '%' || sqlc.arg('q')::text || '%')
ORDER BY (lower(name) LIKE lower(sqlc.arg('q')::text) || '%') DESC, length(name), name
LIMIT sqlc.arg('lim')::int;

-- name: ListReportEvents :many
SELECT * FROM report_events
WHERE (sqlc.arg('q')::text = '' OR name ILIKE '%' || sqlc.arg('q')::text || '%' OR parent ILIKE '%' || sqlc.arg('q')::text || '%')
ORDER BY name
LIMIT sqlc.arg('lim')::int OFFSET sqlc.arg('off')::int;

-- name: CountReportEvents :one
SELECT count(*) FROM report_events
WHERE (sqlc.arg('q')::text = '' OR name ILIKE '%' || sqlc.arg('q')::text || '%' OR parent ILIKE '%' || sqlc.arg('q')::text || '%');

-- name: CreateReportEvent :one
INSERT INTO report_events (name, parent, description, motivo_default, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateReportEvent :one
UPDATE report_events SET name = $2, parent = $3, description = $4, motivo_default = $5, enabled = $6, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteReportEvent :execrows
DELETE FROM report_events WHERE id = $1;
