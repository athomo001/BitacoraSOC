DROP INDEX IF EXISTS idx_tickets_requested_area;
DROP INDEX IF EXISTS idx_tickets_area;
ALTER TABLE tickets DROP COLUMN requested_area_id, DROP COLUMN area_id;
