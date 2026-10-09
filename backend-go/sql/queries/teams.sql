-- name: ListTeamGroups :many
SELECT * FROM team_groups
WHERE (sqlc.narg('client_id')::uuid IS NULL OR client_id = sqlc.narg('client_id'))
  AND (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY name;

-- name: CreateTeamGroup :one
INSERT INTO team_groups (name, slug, client_id) VALUES ($1, $2, $3) RETURNING *;

-- name: ListTeams :many
-- Los grupos de un paso de escalamiento (kind 'step', 000030) son parte de
-- su política: no se listan salvo que se pidan con kind=step. Cada equipo
-- trae qué lo usa, para avisar antes de borrar.
SELECT t.*, o.name AS organization_name, COALESCE(o.active, true) AS organization_active,
  (SELECT count(*) FROM team_members m WHERE m.team_id = t.id AND m.active)::int AS member_count,
  COALESCE((SELECT string_agg(COALESCE(sv.name || ' · ' || so.name, sv.name, a.name, u.name, 'política') || ' #' || st.step_order, ', ' ORDER BY st.step_order)
    FROM escalation_steps st JOIN escalation_policies p ON p.id = st.policy_id
    LEFT JOIN services sv ON sv.id = p.service_id LEFT JOIN organizations so ON so.id = sv.organization_id
    LEFT JOIN assets a ON a.id = p.asset_id LEFT JOIN territorial_units u ON u.id = p.territorial_unit_id
    WHERE st.team_id = t.id), '')::text AS used_in_steps,
  (SELECT count(*) FROM raci_assignments ra WHERE ra.team_id = t.id)::int AS raci_count,
  (SELECT count(*) FROM rotation_slots rs JOIN rotation_cycles rc ON rc.id = rs.cycle_id WHERE rc.team_id = t.id)::int AS guard_count,
  (SELECT count(*) FROM tickets tk WHERE tk.assigned_team_id = t.id)::int AS ticket_count
FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
WHERE (sqlc.narg('kind')::text IS NULL OR t.kind = sqlc.narg('kind'))
  AND (t.kind <> 'step' OR sqlc.narg('kind')::text = 'step')
  AND (sqlc.narg('organization_id')::uuid IS NULL OR t.organization_id = sqlc.narg('organization_id'))
  AND (sqlc.narg('team_group_id')::uuid IS NULL OR t.team_group_id = sqlc.narg('team_group_id'))
  AND (sqlc.narg('audience')::team_audience IS NULL OR t.audience = sqlc.narg('audience'))
  AND (sqlc.narg('active')::boolean IS NULL OR t.active = sqlc.narg('active'))
ORDER BY t.name;

-- name: GetTeam :one
SELECT * FROM teams WHERE id = $1;

-- name: CreateTeam :one
INSERT INTO teams (name, slug, kind, organization_id, team_group_id, audience)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdateTeam :one
UPDATE teams SET
  name = COALESCE(sqlc.narg('name'), name),
  kind = COALESCE(sqlc.narg('kind'), kind),
  organization_id = COALESCE(sqlc.narg('organization_id'), organization_id),
  team_group_id = COALESCE(sqlc.narg('team_group_id'), team_group_id),
  audience = COALESCE(sqlc.narg('audience'), audience),
  active = COALESCE(sqlc.narg('active'), active)
WHERE id = $1
RETURNING *;

-- name: ListTeamMembers :many
-- Un miembro es un usuario interno O un contacto del directorio (CHECK
-- exactamente uno): se devuelve el nombre de cualquiera de los dos.
SELECT m.*, COALESCE(u.username, c.name, 'Pool ' || p.name, '')::text AS display_name
FROM team_members m
LEFT JOIN users u ON u.id = m.user_id
LEFT JOIN contacts c ON c.id = m.contact_id
LEFT JOIN escalation_pools p ON p.id = m.pool_id
WHERE m.team_id = $1 AND m.active
ORDER BY m.priority, display_name;

-- name: AddTeamMember :one
INSERT INTO team_members (team_id, user_id, contact_id, recipient_type, role_in_team, priority, pool_id)
VALUES ($1, $2, $3, $4, $5, $6, sqlc.narg('pool_id')) RETURNING *;

-- name: RemoveTeamMember :execrows
DELETE FROM team_members WHERE id = $1 AND team_id = $2;

-- name: ListTeamCoverage :many
SELECT tc.team_id, tc.territorial_unit_id, tc.priority, tu.name, tu.code, tu.kind
FROM team_coverage tc JOIN territorial_units tu ON tu.id = tc.territorial_unit_id
WHERE tc.team_id = $1
ORDER BY tc.priority, tu.path;

-- name: UpsertTeamCoverage :one
INSERT INTO team_coverage (team_id, territorial_unit_id, priority) VALUES ($1, $2, $3)
ON CONFLICT (team_id, territorial_unit_id) DO UPDATE SET priority = EXCLUDED.priority
RETURNING *;

-- name: RemoveTeamCoverage :execrows
DELETE FROM team_coverage WHERE team_id = $1 AND territorial_unit_id = $2;

-- name: SetTeamsActive :execrows
-- Activar o desactivar a mano anula lo que hizo la organización.
UPDATE teams SET active = sqlc.arg('active'), deactivated_by_org = false
WHERE id = ANY(sqlc.arg('ids')::uuid[]) AND kind <> 'step';

-- name: DeactivateOrganizationTeams :execrows
UPDATE teams SET active = false, deactivated_by_org = true
WHERE organization_id = $1 AND active AND kind <> 'step';

-- name: ReactivateOrganizationTeams :execrows
UPDATE teams SET active = true, deactivated_by_org = false
WHERE organization_id = $1 AND deactivated_by_org;

-- Borrado en cascada (decisión del dueño 2026-10-07): todo lo que cuelga del
-- equipo se va, menos los contactos del Directorio; los tickets quedan sin
-- equipo asignado. Se ejecutan en este orden dentro de una transacción.

-- name: UnassignTeamTickets :execrows
UPDATE tickets SET assigned_team_id = NULL, updated_at = now() WHERE assigned_team_id = ANY(sqlc.arg('ids')::uuid[]);

-- name: DeleteStepsOfTeams :many
DELETE FROM escalation_steps WHERE team_id = ANY(sqlc.arg('ids')::uuid[]) RETURNING policy_id;

-- name: DeleteRaciOfTeams :execrows
DELETE FROM raci_assignments WHERE team_id = ANY(sqlc.arg('ids')::uuid[]);

-- name: DeleteTeamGuards :exec
-- Guardias de esos equipos: reemplazos, turnos y ciclos (los turnos de
-- trabajo enlazados quedan sin ciclo).
WITH cycles AS (SELECT id FROM rotation_cycles WHERE team_id = ANY(sqlc.arg('ids')::uuid[])),
members AS (SELECT id FROM team_members WHERE team_id = ANY(sqlc.arg('ids')::uuid[])),
unlink AS (UPDATE work_shifts SET rotation_cycle_id = NULL WHERE rotation_cycle_id IN (SELECT id FROM cycles)),
overrides AS (DELETE FROM rotation_overrides WHERE cycle_id IN (SELECT id FROM cycles)
  OR original_team_member_id IN (SELECT id FROM members) OR replacement_team_member_id IN (SELECT id FROM members)),
slots AS (DELETE FROM rotation_slots WHERE cycle_id IN (SELECT id FROM cycles) OR team_member_id IN (SELECT id FROM members))
SELECT 1;

-- name: DeleteTeamCycles :exec
DELETE FROM rotation_cycles WHERE team_id = ANY(sqlc.arg('ids')::uuid[]);

-- name: DeleteTeams :execrows
DELETE FROM teams WHERE id = ANY(sqlc.arg('ids')::uuid[]);
