ALTER TABLE ticket_comments DROP COLUMN origin;
DROP INDEX IF EXISTS idx_tickets_parent;
ALTER TABLE tickets
  DROP CONSTRAINT chk_ticket_merged_self,
  DROP CONSTRAINT chk_ticket_parent_self,
  DROP COLUMN merged_into_id,
  DROP COLUMN parent_id;
