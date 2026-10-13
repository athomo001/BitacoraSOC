-- OL era "Charla/Capacitación" en el legacy: una condición de una persona en
-- uno o más días, no una guardia. El ETL anterior la cargó como el equipo
-- "Guardia OL" con su ciclo semanal. Cada tramo pasa a ser días
-- 'training' en Dotación (hora de Santiago; si termina antes del mediodía
-- de otro día, ese último día no cuenta, como el CSV) y el equipo se borra.
-- Un día ya marcado con otra condición que no sea "En Oficina" se respeta.
DO $$
DECLARE
  ol_team UUID;
BEGIN
  SELECT id INTO ol_team FROM teams WHERE name = 'Guardia OL' AND kind = 'oncall';
  IF ol_team IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO work_shift_assignments (user_id, assigned_date, condition, notes)
  SELECT DISTINCT tm.user_id, d::date, 'training'::telework_condition, 'Legacy (OL)'
  FROM rotation_slots s
  JOIN rotation_cycles c ON c.id = s.cycle_id
  JOIN team_members tm ON tm.id = s.team_member_id
  CROSS JOIN LATERAL (
    SELECT (s.starts_at AT TIME ZONE 'America/Santiago') AS a, (s.ends_at AT TIME ZONE 'America/Santiago') AS b
  ) l
  CROSS JOIN LATERAL generate_series(
    l.a::date,
    CASE WHEN l.b::date > l.a::date AND l.b::time < '12:00' THEN l.b::date - 1 ELSE l.b::date END,
    interval '1 day'
  ) d
  WHERE c.team_id = ol_team AND tm.user_id IS NOT NULL
  ON CONFLICT (user_id, assigned_date) DO UPDATE SET condition = EXCLUDED.condition, notes = EXCLUDED.notes
    WHERE work_shift_assignments.condition = 'office';

  DELETE FROM rotation_overrides WHERE cycle_id IN (SELECT id FROM rotation_cycles WHERE team_id = ol_team);
  UPDATE work_shifts SET rotation_cycle_id = NULL WHERE rotation_cycle_id IN (SELECT id FROM rotation_cycles WHERE team_id = ol_team);
  DELETE FROM rotation_cycles WHERE team_id = ol_team; -- arrastra sus tramos
  DELETE FROM teams WHERE id = ol_team
    AND NOT EXISTS (SELECT 1 FROM raci_assignments WHERE team_id = ol_team)
    AND NOT EXISTS (SELECT 1 FROM escalation_steps WHERE team_id = ol_team)
    AND NOT EXISTS (SELECT 1 FROM tickets WHERE assigned_team_id = ol_team);
END $$;
