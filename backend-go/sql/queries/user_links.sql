-- Usuarios bloqueados y eliminados (decisión del dueño, 2026-10-21): al
-- bloquear, la persona desaparece de guardias, escalamiento y pools, y antes
-- la app avisa lo que tiene a su nombre; eliminar borra de verdad solo a quien
-- no tiene historial (si no, queda bloqueado).

-- name: ListUserLinks :many
-- Lo que una persona tiene a su nombre y habría que reasignar al bloquearla.
SELECT x.kind::text AS kind, x.label::text AS label, x.detail::text AS detail FROM (
  SELECT 1 AS ord, 'guard' AS kind, t.name AS label,
    (SELECT count(*) FROM rotation_slots s WHERE s.team_member_id = m.id AND s.ends_at > now())::text AS detail
  FROM team_members m JOIN teams t ON t.id = m.team_id AND t.active
  WHERE m.user_id = $1 AND m.active AND t.kind = 'oncall'
  UNION ALL
  SELECT DISTINCT 2, 'escalation', COALESCE(NULLIF(st.title, ''), t.name), ''
  FROM team_members m JOIN teams t ON t.id = m.team_id AND t.active
  LEFT JOIN escalation_steps st ON st.team_id = t.id
  WHERE m.user_id = $1 AND m.active AND t.kind <> 'oncall'
  UNION ALL
  SELECT 3, 'pool', p.name, '' FROM escalation_pool_members pm JOIN escalation_pools p ON p.id = pm.pool_id AND p.active WHERE pm.user_id = $1
  UNION ALL
  SELECT 4, 'shift', w.name, '' FROM work_shift_members wm JOIN work_shifts w ON w.id = wm.work_shift_id AND w.active
  WHERE wm.user_id = $1 AND wm.active
  UNION ALL
  SELECT 5, 'client', o.name, '' FROM organizations o WHERE o.csm_user_id = $1 AND o.active
  UNION ALL
  SELECT 6, 'ticket', t.ticket_number || ' · ' || t.title, '' FROM tickets t
  WHERE t.assigned_user_id = $1 AND t.status NOT IN ('resolved', 'closed')
  UNION ALL
  SELECT 7, 'task', k.name, '' FROM agenda_tasks k WHERE k.assignee_user_id = $1 AND k.active
  UNION ALL
  SELECT 8, 'goal', g.name, '' FROM goals g WHERE (g.person_user_id = $1 OR g.owner_user_id = $1) AND g.completed_at IS NULL
  UNION ALL
  SELECT 9, 'asset', a.name, '' FROM asset_responsibles r JOIN assets a ON a.id = r.asset_id AND a.active WHERE r.user_id = $1
) x
ORDER BY x.ord, x.label;

-- name: ListBlockedTeamMembers :many
-- De estos integrantes, los que son un usuario bloqueado (no están de guardia).
SELECT m.id FROM team_members m JOIN users u ON u.id = m.user_id
WHERE NOT u.active AND m.id = ANY(sqlc.arg('ids')::uuid[]);

-- name: DeleteUserForever :execrows
-- Solo funciona si no tiene historial: entradas, tickets, Auditoría y el
-- resto lo referencian sin ON DELETE y la base lo rechaza.
DELETE FROM users WHERE id = $1;

-- name: DeleteBareTeamMemberships :exec
-- Al eliminar: las membresías en equipos sin turnos ni reemplazos no son
-- historial y se van con la persona (las que tienen turnos sí lo son).
DELETE FROM team_members m WHERE m.user_id = $1
  AND NOT EXISTS (SELECT 1 FROM rotation_slots s WHERE s.team_member_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM rotation_overrides o WHERE o.original_team_member_id = m.id OR o.replacement_team_member_id = m.id);
