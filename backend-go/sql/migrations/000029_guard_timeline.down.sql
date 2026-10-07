ALTER TABLE rotation_cycles DROP COLUMN must_be_covered;
DROP INDEX IF EXISTS idx_rotation_slots_range;
ALTER TABLE rotation_slots
  DROP CONSTRAINT chk_rotation_slot_range,
  DROP COLUMN ends_at,
  DROP COLUMN starts_at;
