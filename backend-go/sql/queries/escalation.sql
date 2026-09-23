-- ===== Servicios (módulo SOC) =====

-- name: ListServices :many
SELECT s.*, o.name AS organization_name FROM services s JOIN organizations o ON o.id = s.organization_id
WHERE (sqlc.narg('organization_id')::uuid IS NULL OR s.organization_id = sqlc.narg('organization_id'))
  AND (sqlc.narg('active')::boolean IS NULL OR s.active = sqlc.narg('active'))
ORDER BY o.name, s.name;

-- name: GetService :one
SELECT * FROM services WHERE id = $1;

-- name: CreateService :one
INSERT INTO services (organization_id, name, code) VALUES ($1, $2, $3) RETURNING *;

-- name: UpdateService :one
UPDATE services SET
  name = COALESCE(sqlc.narg('name'), name),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1 RETURNING *;

-- ===== Políticas y pasos =====

-- name: ListPolicies :many
SELECT * FROM escalation_policies
WHERE (sqlc.narg('service_id')::uuid IS NULL OR service_id = sqlc.narg('service_id'))
  AND (sqlc.narg('asset_id')::uuid IS NULL OR asset_id = sqlc.narg('asset_id'))
  AND (sqlc.narg('territorial_unit_id')::uuid IS NULL OR territorial_unit_id = sqlc.narg('territorial_unit_id'))
ORDER BY id;

-- name: GetPolicy :one
SELECT * FROM escalation_policies WHERE id = $1;

-- name: CreatePolicy :one
INSERT INTO escalation_policies (service_id, asset_id, territorial_unit_id) VALUES ($1, $2, $3) RETURNING *;

-- name: DeletePolicy :execrows
DELETE FROM escalation_policies WHERE id = $1;

-- name: ListPolicySteps :many
SELECT st.*, t.name AS team_name FROM escalation_steps st JOIN teams t ON t.id = st.team_id
WHERE st.policy_id = ANY(sqlc.arg('policy_ids')::uuid[])
ORDER BY st.policy_id, st.step_order;

-- name: AddPolicyStep :one
INSERT INTO escalation_steps (policy_id, step_order, team_id, mode, wait_before_escalate_minutes)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: DeletePolicyStep :execrows
DELETE FROM escalation_steps WHERE policy_id = $1 AND step_order = $2;

-- ===== Resolución =====

-- name: FindPolicyByService :one
SELECT id FROM escalation_policies WHERE service_id = $1 AND active;

-- name: FindPolicyByAsset :one
SELECT id FROM escalation_policies WHERE asset_id = $1 AND active;

-- name: GetAssetForResolve :one
SELECT a.id, a.name, a.territorial_unit_id FROM assets a WHERE a.id = $1 AND a.active;

-- name: ListUnitAncestors :many
-- Camino desde la unidad hacia la raíz (ltree @>), de la más específica a la
-- menos: es el orden en que se busca política o cobertura (HU-1).
SELECT anc.id, anc.name, anc.code, anc.kind, nlevel(anc.path)::int AS depth
FROM territorial_units u
JOIN territorial_units anc ON anc.path @> u.path
WHERE u.id = $1 AND anc.active
ORDER BY nlevel(anc.path) DESC;

-- name: ListPoliciesForUnits :many
SELECT id, territorial_unit_id FROM escalation_policies
WHERE active AND territorial_unit_id = ANY(sqlc.arg('unit_ids')::uuid[]);

-- name: ListCoverageForUnits :many
SELECT tc.team_id, tc.territorial_unit_id, tc.priority
FROM team_coverage tc JOIN teams t ON t.id = tc.team_id
WHERE t.active AND tc.territorial_unit_id = ANY(sqlc.arg('unit_ids')::uuid[])
ORDER BY tc.priority;

-- name: ListTeamsForResolve :many
SELECT t.id, t.name, t.kind, t.audience, o.name AS organization_name, o.type AS organization_type
FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
WHERE t.id = ANY(sqlc.arg('team_ids')::uuid[]);

-- name: ListMembersForTeams :many
-- Miembros activos de los equipos a resolver, con lo que la tarjeta necesita
-- mostrar: nombre, especialidad (solo contactos), rol y prioridad.
SELECT m.id, m.team_id, m.user_id, m.contact_id, m.recipient_type, m.role_in_team, m.priority,
  COALESCE(c.name, u.username, '')::text AS name,
  c.specialty, c.position, co.name AS contact_organization_name
FROM team_members m
LEFT JOIN contacts c ON c.id = m.contact_id AND c.active
LEFT JOIN users u ON u.id = m.user_id AND u.active
LEFT JOIN organizations co ON co.id = c.organization_id
WHERE m.active AND m.team_id = ANY(sqlc.arg('team_ids')::uuid[])
  AND (c.id IS NOT NULL OR u.id IS NOT NULL)
ORDER BY m.team_id, m.priority;

-- name: ListChannelsForUsers :many
SELECT * FROM contact_channels
WHERE active AND user_id = ANY(sqlc.arg('user_ids')::uuid[])
ORDER BY preferred DESC, channel_type, id;

-- ===== Intentos (inmutables, ver migración 000004) =====

-- name: InsertActionLog :one
INSERT INTO escalation_action_logs (entry_id, policy_id, step_order, contact_id, channel_type, result, notes, operator_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: ListActionLogs :many
SELECT l.*, u.username AS operator_username, c.name AS contact_name
FROM escalation_action_logs l
JOIN users u ON u.id = l.operator_id
LEFT JOIN contacts c ON c.id = l.contact_id
WHERE (sqlc.narg('policy_id')::uuid IS NULL OR l.policy_id = sqlc.narg('policy_id'))
  AND (sqlc.narg('entry_id')::uuid IS NULL OR l.entry_id = sqlc.narg('entry_id'))
  AND (sqlc.narg('since')::timestamptz IS NULL OR l.created_at >= sqlc.narg('since'))
ORDER BY l.created_at DESC
LIMIT sqlc.arg('max_rows');

-- name: ListTriedContactsForStep :many
-- Quiénes ya se intentaron en este paso durante el incidente en curso (desde
-- "since"), para que el modo sequential llame al siguiente y no repita.
SELECT DISTINCT contact_id FROM escalation_action_logs
WHERE policy_id = $1 AND step_order = $2 AND contact_id IS NOT NULL AND created_at >= sqlc.arg('since');

-- ===== Ventanas de mantenimiento =====

-- name: ListMaintenanceWindows :many
SELECT * FROM maintenance_windows
WHERE (sqlc.narg('service_id')::uuid IS NULL OR service_id = sqlc.narg('service_id'))
  AND (sqlc.narg('asset_id')::uuid IS NULL OR asset_id = sqlc.narg('asset_id'))
  AND (sqlc.narg('territorial_unit_id')::uuid IS NULL OR territorial_unit_id = sqlc.narg('territorial_unit_id'))
  AND (sqlc.narg('only_current')::boolean IS NOT TRUE OR (active AND now() >= starts_at AND now() < ends_at))
ORDER BY starts_at DESC;

-- name: CreateMaintenanceWindow :one
INSERT INTO maintenance_windows (service_id, asset_id, territorial_unit_id, title, notes, starts_at, ends_at, suppress_notifications, priority, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: DeactivateMaintenanceWindow :execrows
UPDATE maintenance_windows SET active = false WHERE id = $1 AND active;

-- name: ListWindowsForScope :many
-- Candidatas para notify: ventanas activas del servicio, del activo, o de
-- cualquier unidad del camino territorial (un mantenimiento sobre toda la
-- zona Calama también cubre a sus routers).
SELECT * FROM maintenance_windows
WHERE active AND ends_at > now()
  AND (service_id = sqlc.narg('service_id')
       OR asset_id = sqlc.narg('asset_id')
       OR territorial_unit_id = ANY(sqlc.arg('unit_ids')::uuid[]));

-- ===== RACI (solo dato en esta fase, sin UI) =====

-- name: ListRaciAssignments :many
SELECT r.*, t.name AS team_name FROM raci_assignments r JOIN teams t ON t.id = r.team_id
WHERE r.active
  AND (sqlc.narg('client_id')::uuid IS NULL OR r.client_id = sqlc.narg('client_id'))
  AND (sqlc.narg('service_id')::uuid IS NULL OR r.service_id = sqlc.narg('service_id'))
ORDER BY r.topic, r.role;

-- name: CreateRaciAssignment :one
INSERT INTO raci_assignments (client_id, service_id, asset_id, topic, role, team_id)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
