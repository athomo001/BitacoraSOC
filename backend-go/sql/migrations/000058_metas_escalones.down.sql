DROP TABLE IF EXISTS goal_person_rules;
ALTER TABLE goals DROP COLUMN outcome, DROP COLUMN outcome_reason, DROP COLUMN outcome_at, DROP COLUMN outcome_by;
-- La terciaria no existía: pasa a secundaria.
UPDATE goals SET bonus_rank = 'secondary' WHERE bonus_rank = 'tertiary';
ALTER TABLE goals DROP CONSTRAINT goals_bonus_rank_check;
ALTER TABLE goals ADD CONSTRAINT goals_bonus_rank_check CHECK (bonus_rank IN ('primary', 'secondary'));
